/**
 * Vivitフェスタ クーポン 管理用スクリプト（発行・メール送信）
 *
 * Web公開はしない。スプレッドシートのメニュー「クーポン管理」から手動実行する。
 *   ① IDを発行     : email から id = SHA-256(email + SALT) を生成し coupons に書く
 *   ② メール送信   : coupons の各行の email 宛に、id付きクーポンURLを送る
 *
 * 前提：coupons シートに以下の列（ヘッダー名）があること
 *   id / amount / used / usedAt / shopId / shopName / issuedAt / email / sentAt
 *   ※ email・sentAt はこの管理機能のために追加する列。
 *   ※ 列番号は固定せずヘッダー名で特定するため、順番は自由。
 *
 * Code.gs（Webアプリ）とは独立。同じプロジェクトに追加しても、別プロジェクト
 * （SPREADSHEET_ID を設定）にしても動くよう、関数名は admin_ 接頭辞で分離している。
 */

// ===== 設定 =====
var ADMIN_CONFIG = {
  // 別プロジェクトから使う場合はクーポン用スプレッドシートのIDを設定。
  // このスプレッドシートにバインドして使うなら空のままでよい。
  SPREADSHEET_ID: '',
  COUPONS_SHEET: 'coupons',

  // ID生成のソルト。★フロント（index.html）には絶対に置かないこと。
  // これが漏れると第三者が任意メールのIDを計算できてしまう。
  SALT: '2026vivit',

  // 配布するクーポンページのURL（末尾に ?id=... を付けて送る）
  COUPON_BASE_URL: 'https://vivit-festa.sunnyspot-tokyo.co.jp/coupon-2026-summer/',

  // amount 未入力の行に補完する既定額
  DEFAULT_AMOUNT: 300,

  // メール差出人名
  MAIL_SENDER_NAME: 'Vivitフェスタ'
};

// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('クーポン管理')
    .addItem('① IDを発行（email → id）', 'fillCouponIds')
    .addItem('② クーポンメールを送信', 'sendCouponEmails')
    .addSeparator()
    .addItem('自分宛にテストメールを送る', 'sendCouponTestEmail')
    .addToUi();
}

// ===== ① ID発行 =====
// email があり id が空の行に、id = SHA-256(email + SALT) を書き込む。
// あわせて used=FALSE / amount=既定 / issuedAt=now を（空なら）補完する。
function fillCouponIds() {
  var ctx = admin_readCoupons_();
  var h = ctx.headers, sheet = ctx.sheet, values = ctx.values;
  admin_requireCols_(h, ['id', 'email']);

  // 既存IDを集めて重複発行を防ぐ
  var existingIds = {};
  for (var i = 1; i < values.length; i++) {
    var eid = String(values[i][h['id']] || '').trim();
    if (eid) existingIds[eid] = true;
  }

  var issued = 0, skipped = 0, dup = 0;
  for (var r = 1; r < values.length; r++) {
    var email = String(values[r][h['email']] || '').trim();
    var id = String(values[r][h['id']] || '').trim();
    if (!email) continue;
    if (id) { skipped++; continue; }

    var newId = admin_hashId_(email);
    if (existingIds[newId]) { dup++; continue; } // 同一メールが既に発行済み

    sheet.getRange(r + 1, h['id'] + 1).setValue(newId);
    existingIds[newId] = true;
    if (h['amount'] !== undefined && String(values[r][h['amount']] || '') === '') {
      sheet.getRange(r + 1, h['amount'] + 1).setValue(ADMIN_CONFIG.DEFAULT_AMOUNT);
    }
    if (h['used'] !== undefined && String(values[r][h['used']] || '') === '') {
      sheet.getRange(r + 1, h['used'] + 1).setValue(false);
    }
    if (h['issuedAt'] !== undefined && String(values[r][h['issuedAt']] || '') === '') {
      sheet.getRange(r + 1, h['issuedAt'] + 1).setValue(admin_nowIso_());
    }
    issued++;
  }
  SpreadsheetApp.flush();
  admin_notify_('IDを発行しました。\n\n発行: ' + issued + ' 件\n既存(id有)スキップ: ' + skipped + ' 件\n重複メールスキップ: ' + dup + ' 件');
}

// ===== ② メール送信 =====
// id と email があり、まだ送信していない（sentAt が空）行に、
// id付きクーポンURLをメール送信し、sentAt に送信日時を記録する。
function sendCouponEmails() {
  var ctx = admin_readCoupons_();
  var h = ctx.headers, sheet = ctx.sheet, values = ctx.values;
  admin_requireCols_(h, ['id', 'email', 'amount']);
  var hasSentAt = h['sentAt'] !== undefined;

  var sent = 0, skipped = 0, failed = 0, noData = 0;
  for (var r = 1; r < values.length; r++) {
    var email = String(values[r][h['email']] || '').trim();
    var id = String(values[r][h['id']] || '').trim();
    var amount = Number(values[r][h['amount']]);
    if (!email || !id) { noData++; continue; }
    if (hasSentAt && String(values[r][h['sentAt']] || '').trim()) { skipped++; continue; }

    try {
      admin_sendCouponMail_(email, id, amount);
      if (hasSentAt) sheet.getRange(r + 1, h['sentAt'] + 1).setValue(admin_nowIso_());
      sent++;
    } catch (e) {
      failed++;
    }
  }
  SpreadsheetApp.flush();

  var msg = 'クーポンメールを送信しました。\n\n送信: ' + sent + ' 件\n送信済みスキップ: ' + skipped + ' 件\n失敗: ' + failed + ' 件';
  if (noData) msg += '\nid/email未設定でスキップ: ' + noData + ' 件';
  if (!hasSentAt) msg += '\n\n⚠ sentAt列が無いため二重送信を防げません。coupons に sentAt 列の追加を推奨します。';
  msg += '\n\n（無料Gmailは1日100通、Workspaceは1日1500通が上限です）';
  admin_notify_(msg);
}

// 送信文面の確認用：自分（実行者）宛にサンプルを1通送る
function sendCouponTestEmail() {
  var me = Session.getActiveUser().getEmail();
  if (!me) { admin_notify_('実行者のメールアドレスを取得できませんでした。'); return; }
  admin_sendCouponMail_(me, 'demo', ADMIN_CONFIG.DEFAULT_AMOUNT);
  admin_notify_('テストメールを ' + me + ' 宛に送信しました。（URLの id は demo）');
}

// ===== メール本文 =====
function admin_sendCouponMail_(email, id, amount) {
  var amt = (amount === 500) ? 500 : 300;
  var url = ADMIN_CONFIG.COUPON_BASE_URL +
            (ADMIN_CONFIG.COUPON_BASE_URL.indexOf('?') >= 0 ? '&' : '?') +
            'id=' + encodeURIComponent(id);

  var subject = '【Vivitフェスタ】当日使える' + amt + '円クーポンのご案内';
  var body = [
    'Vivitフェスタ 2026 SUMMER にご登録いただきありがとうございます。',
    '当日、会場で使える' + amt + '円クーポンをお届けします。',
    '',
    '▼ あなた専用のクーポンURL',
    url,
    '',
    '当日、会場でお店の方に上の画面を見せて「このクーポンを使う」を押してください。',
    '・当日限り／1回限り使用可能です。',
    '・このURLはあなた専用です。第三者と共有しないでください。',
    '',
    '▼ 開催情報',
    '　日程：2026年8月1日（土）11:30〜17:00',
    '　会場：GOBLIN.北参道店 -ROADSIDE-（東京都渋谷区千駄ケ谷3-5-16）',
    '　入場：無料',
    '',
    '当日、会場でお会いできるのを楽しみにしています。',
    '',
    '───────────────',
    'Vivitフェスタ 運営 / 株式会社Sunny Spot',
    '───────────────'
  ].join('\n');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body,
    name: ADMIN_CONFIG.MAIL_SENDER_NAME
  });
}

// ===== ID生成 =====
// key = 小文字化・トリムした email + SALT を SHA-256 でハッシュし、16進文字列にする。
function admin_hashId_(email) {
  var key = String(email).trim().toLowerCase() + ADMIN_CONFIG.SALT;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex; // 64文字の16進文字列
}

// ===== 補助 =====
function admin_getSpreadsheet_() {
  return ADMIN_CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(ADMIN_CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function admin_readCoupons_() {
  var sheet = admin_getSpreadsheet_().getSheetByName(ADMIN_CONFIG.COUPONS_SHEET);
  if (!sheet) throw new Error('coupons シートが見つかりません');
  var values = sheet.getDataRange().getValues();
  var headers = {};
  (values[0] || []).forEach(function (name, i) { headers[String(name).trim()] = i; });
  return { sheet: sheet, headers: headers, values: values };
}

function admin_requireCols_(headers, names) {
  var missing = names.filter(function (n) { return headers[n] === undefined; });
  if (missing.length) {
    throw new Error('coupons シートに必要な列がありません: ' + missing.join(', '));
  }
}

function admin_nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00");
}

// メニュー実行時はダイアログ、それ以外（エディタ直接実行等）はログに出す
function admin_notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
