/**
 * Vivitフェスタ クーポンシステム（Google Apps Script）
 *
 * - GET  ?action=getCoupon&id=xxxx  … クーポン情報＋利用可能店舗を返す
 * - POST action=useCoupon&id=..&shopId=.. … クーポンを使用済みに更新
 *
 * 実装指示書 vivit_coupon_system_spec.md に準拠。
 * セットアップ／デプロイ手順は同フォルダ README.md 参照。
 */

// ===== 設定 =====
var CONFIG = {
  // クーポン用スプレッドシートのID。空の場合はこのスクリプトにバインドされた
  // スプレッドシート（getActiveSpreadsheet）を使う。
  SPREADSHEET_ID: '',
  COUPONS_SHEET: 'coupons',
  SHOPS_SHEET: 'shops',
  TIMEZONE: 'Asia/Tokyo',

  // ===== 利用可能期間 =====
  // この時間帯（JST）のみ使用可。開場11:30〜閉場17:00に前後30分バッファ。
  // 変更したい場合はこの2つを書き換える（ISO 8601・+09:00 を付ける）。
  USABLE_FROM: '2026-08-01T11:00:00+09:00',
  USABLE_UNTIL: '2026-08-01T17:30:00+09:00',
  // このプレフィックスで始まるIDは期間チェックを無視して常に使用可（テスト用）。
  DEMO_PREFIX: 'demo'
};

// ===== エンドポイント =====
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    if (params.action === 'getCoupon') {
      return handleGetCoupon_(params.id);
    }
    return errorResponse_('INVALID_REQUEST', 'リクエストが不正です');
  } catch (err) {
    return errorResponse_('INTERNAL_ERROR', 'サーバーエラーが発生しました');
  }
}

function doPost(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    if (params.action === 'useCoupon') {
      return handleUseCoupon_(params.id, params.shopId);
    }
    return errorResponse_('INVALID_REQUEST', 'リクエストが不正です');
  } catch (err) {
    return errorResponse_('INTERNAL_ERROR', 'サーバーエラーが発生しました');
  }
}

// ===== クーポン情報取得 =====
function handleGetCoupon_(id) {
  id = String(id || '').trim();
  if (!id) {
    return errorResponse_('INVALID_REQUEST', 'クーポンIDが指定されていません');
  }

  var found = findCoupon_(id);
  if (!found) {
    return errorResponse_('COUPON_NOT_FOUND', 'クーポンが見つかりません');
  }

  var coupon = toCouponObject_(found);
  if (coupon.amount !== 300 && coupon.amount !== 500) {
    return errorResponse_('INVALID_COUPON_DATA', 'クーポンデータが不正です');
  }

  // 使用済みなら店舗一覧は返さない（選択不可のため）
  var shops = coupon.used ? [] : getActiveShops_();

  return jsonResponse_({
    success: true,
    coupon: coupon,
    shops: shops,
    availability: couponAvailability_(id)
  });
}

// ===== クーポン使用 =====
function handleUseCoupon_(id, shopId) {
  id = String(id || '').trim();
  shopId = String(shopId || '').trim();
  if (!id || !shopId) {
    return errorResponse_('INVALID_REQUEST', '必須項目が不足しています');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    // ロック取得後に最新状態を再取得する
    var found = findCoupon_(id);
    if (!found) {
      return errorResponse_('COUPON_NOT_FOUND', 'クーポンが見つかりません');
    }

    var coupon = toCouponObject_(found);
    if (coupon.amount !== 300 && coupon.amount !== 500) {
      return errorResponse_('INVALID_COUPON_DATA', 'クーポンデータが不正です');
    }

    // すでに使用済みならサーバー側で拒否
    if (coupon.used) {
      return jsonResponse_({
        success: false,
        error: { code: 'COUPON_ALREADY_USED', message: 'このクーポンはすでに使用済みです' },
        coupon: coupon
      });
    }

    // 利用可能期間の判定（demoは常に可）。クライアント時刻は信用せずサーバー側で判定。
    var avail = couponAvailability_(id);
    if (!avail.available) {
      var outMsg = (avail.reason === 'before_period')
        ? 'このクーポンはまだご利用いただけません'
        : 'クーポンのご利用期間は終了しました';
      return jsonResponse_({
        success: false,
        error: { code: 'OUTSIDE_PERIOD', message: outMsg },
        availability: avail
      });
    }

    // 店舗を検証（存在・active）
    var shop = findShop_(shopId);
    if (!shop) {
      return errorResponse_('SHOP_NOT_FOUND', '店舗が見つかりません');
    }
    if (!shop.active) {
      return errorResponse_('SHOP_INACTIVE', '現在利用できない店舗です');
    }

    // 使用済みに更新（金額・店舗名はサーバー側の値を使用）
    var nowIso = nowIso_();
    updateCouponRow_(found, {
      used: true,
      usedAt: nowIso,
      shopId: shop.shopId,
      shopName: shop.shopName
    });

    coupon.used = true;
    coupon.usedAt = nowIso;
    coupon.shopId = shop.shopId;
    coupon.shopName = shop.shopName;

    return jsonResponse_({ success: true, coupon: coupon });
  } catch (err) {
    return errorResponse_('INTERNAL_ERROR', 'サーバーエラーが発生しました');
  } finally {
    lock.releaseLock();
  }
}

// ===== 利用可能期間 =====
// demoで始まるIDは常に利用可。それ以外は CONFIG の期間内のみ利用可。
// { available, reason: 'ok'|'before_period'|'after_period', from, until } を返す。
function couponAvailability_(id) {
  if (isDemoId_(id)) {
    return { available: true, reason: 'ok', from: null, until: null };
  }
  var from = new Date(CONFIG.USABLE_FROM).getTime();
  var until = new Date(CONFIG.USABLE_UNTIL).getTime();
  var now = Date.now();
  var reason = 'ok';
  if (now < from) reason = 'before_period';
  else if (now > until) reason = 'after_period';
  return {
    available: reason === 'ok',
    reason: reason,
    from: CONFIG.USABLE_FROM,
    until: CONFIG.USABLE_UNTIL
  };
}

function isDemoId_(id) {
  return String(id || '').toLowerCase().indexOf(String(CONFIG.DEMO_PREFIX).toLowerCase()) === 0;
}

// ===== スプレッドシート アクセス =====
function getSpreadsheet_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * シートを {sheet, headers(name->0基点index), rows(2次元配列)} で返す。
 * 列番号は固定せず、ヘッダー名から特定する。
 */
function readSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('sheet not found: ' + sheetName);
  var values = sheet.getDataRange().getValues();
  var headerRow = values.length ? values[0] : [];
  var headers = {};
  headerRow.forEach(function (name, i) {
    headers[String(name).trim()] = i;
  });
  return { sheet: sheet, headers: headers, values: values };
}

function findCoupon_(id) {
  var data = readSheet_(CONFIG.COUPONS_SHEET);
  var idCol = data.headers['id'];
  if (idCol === undefined) throw new Error('id column not found');
  for (var r = 1; r < data.values.length; r++) {
    if (String(data.values[r][idCol]).trim() === id) {
      return { data: data, rowIndex: r }; // rowIndex は values 上の 0基点
    }
  }
  return null;
}

function toCouponObject_(found) {
  var h = found.data.headers;
  var row = found.data.values[found.rowIndex];
  var get = function (name) { return h[name] === undefined ? null : row[h[name]]; };
  return {
    id: String(get('id') || '').trim(),
    amount: Number(get('amount')),
    used: toBool_(get('used')),
    usedAt: toIsoOrNull_(get('usedAt')),
    shopId: emptyToNull_(get('shopId')),
    shopName: emptyToNull_(get('shopName'))
  };
}

function updateCouponRow_(found, patch) {
  var h = found.data.headers;
  var sheet = found.data.sheet;
  var sheetRow = found.rowIndex + 1; // シート上の行番号（1基点）
  var setCell = function (name, value) {
    if (h[name] === undefined) return;
    sheet.getRange(sheetRow, h[name] + 1).setValue(value);
  };
  if (patch.used !== undefined) setCell('used', patch.used);
  if (patch.usedAt !== undefined) setCell('usedAt', patch.usedAt);
  if (patch.shopId !== undefined) setCell('shopId', patch.shopId);
  if (patch.shopName !== undefined) setCell('shopName', patch.shopName);
  SpreadsheetApp.flush();
}

function getActiveShops_() {
  var data = readSheet_(CONFIG.SHOPS_SHEET);
  var h = data.headers;
  var list = [];
  for (var r = 1; r < data.values.length; r++) {
    var row = data.values[r];
    if (!toBool_(row[h['active']])) continue;
    var shopId = String(row[h['shopId']] || '').trim();
    if (!shopId) continue;
    list.push({
      shopId: shopId,
      shopName: String(row[h['shopName']] || '').trim(),
      displayOrder: Number(row[h['displayOrder']])
    });
  }
  list.sort(function (a, b) {
    var ao = isNaN(a.displayOrder) ? 1e9 : a.displayOrder;
    var bo = isNaN(b.displayOrder) ? 1e9 : b.displayOrder;
    return ao - bo;
  });
  // フロントには表示に必要な項目のみ返す
  return list.map(function (s) { return { shopId: s.shopId, shopName: s.shopName }; });
}

function findShop_(shopId) {
  var data = readSheet_(CONFIG.SHOPS_SHEET);
  var h = data.headers;
  for (var r = 1; r < data.values.length; r++) {
    var row = data.values[r];
    if (String(row[h['shopId']] || '').trim() === shopId) {
      return {
        shopId: shopId,
        shopName: String(row[h['shopName']] || '').trim(),
        active: toBool_(row[h['active']])
      };
    }
  }
  return null;
}

// ===== ユーティリティ =====
function toBool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined || v === '') return false;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function emptyToNull_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s === '' ? null : s;
}

function toIsoOrNull_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss+09:00");
  }
  return String(v); // 既に文字列で入っている場合はそのまま
}

function nowIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss+09:00");
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(code, message) {
  return jsonResponse_({ success: false, error: { code: code, message: message } });
}
