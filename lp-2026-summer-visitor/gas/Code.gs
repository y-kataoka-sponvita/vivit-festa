/**
 * Vivitフェスタ 2026 SUMMER 来場者向けLP
 * クーポン登録フォーム 受信スクリプト（Google Apps Script）
 *
 * 役割：
 *   LPのフォーム送信（POST）を受け取り、スプレッドシートに1行追記する。
 *   任意で、登録者へ「登録ありがとうございます」の自動返信メールを送る。
 *   ※ 300円クーポン本体は開催の約1週間前に別途送る運用（このスクリプトでは送らない）。
 *
 * セットアップ／デプロイ手順は同フォルダの README.md を参照。
 */

// ===== 設定 =====
var SHEET_NAME = 'registrations';   // 書き込み先シート名（なければ自動作成）
var SEND_CONFIRMATION = true;       // 登録直後に自動返信メールを送るか
var MAX_REGISTRATIONS = 100;        // 先着枠（超過分は full=true を返す。運用の目安用）

// ===== エンドポイント =====
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // 同時実行での重複・番号ズレを防ぐ
    lock.waitLock(10000);

    var params = (e && e.parameter) ? e.parameter : {};
    var email = String(params.email || '').trim();
    var name = String(params.name || '').trim();
    var source = String(params.source || 'lp-2026-summer-visitor').trim();

    if (!email || !isValidEmail_(email)) {
      return jsonOutput_({ ok: false, error: 'invalid_email' });
    }

    var sheet = getSheet_();

    // 同一メールの二重登録はスキップ（おひとり様1回まで）
    if (isDuplicate_(sheet, email)) {
      return jsonOutput_({ ok: true, duplicated: true });
    }

    var seq = sheet.getLastRow(); // ヘッダー1行ぶんを差し引くと受付番号になる
    sheet.appendRow([new Date(), email, name, source, seq]);

    var isFull = seq > MAX_REGISTRATIONS;

    if (SEND_CONFIRMATION) {
      // メール送信失敗でも登録自体は成功扱いにする（記録を優先）
      try {
        sendConfirmation_(email, name);
      } catch (mailErr) {
        console.error('confirmation mail failed: ' + mailErr);
      }
    }

    return jsonOutput_({ ok: true, seq: seq, full: isFull });
  } catch (err) {
    console.error(err);
    return jsonOutput_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 動作確認用（ブラウザでウェブアプリURLを開くと表示される）
function doGet() {
  return jsonOutput_({ ok: true, message: 'Vivit festa registration endpoint is running.' });
}

// ===== 補助関数 =====
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['登録日時', 'メールアドレス', 'お名前', '流入元', '受付番号']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function isDuplicate_(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var values = sheet.getRange(2, 2, last - 1, 1).getValues(); // B列=メール
  var target = email.toLowerCase();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === target) return true;
  }
  return false;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendConfirmation_(email, name) {
  var greeting = name ? (name + ' 様') : 'Vivitフェスタにご登録いただいたみなさま';
  var subject = '【Vivitフェスタ】クーポン登録ありがとうございます';
  var body = [
    greeting,
    '',
    'Vivitフェスタ 2026 SUMMER のクーポン登録ありがとうございます。',
    '',
    '当日使える300円クーポンは、開催の約1週間前に、',
    'こちらのメールアドレス宛にお送りします。今しばらくお待ちください。',
    '',
    '▼ 開催情報',
    '　日程：2026年8月1日（土）11:30〜17:00',
    '　会場：GOBLIN.北参道店 -ROADSIDE-（東京都渋谷区千駄ケ谷3-5-16）',
    '　入場：無料',
    '',
    '当日、会場でお会いできるのを楽しみにしています。',
    '',
    '───────────────',
    'Vivitフェスタ 運営',
    '主催：株式会社Sunny Spot',
    '───────────────',
  ].join('\n');

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body,
    name: 'Vivitフェスタ',
  });
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
