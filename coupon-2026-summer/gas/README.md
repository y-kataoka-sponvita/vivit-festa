# Vivitフェスタ クーポンシステム（2026夏）セットアップ

来場者向けの1回限りデジタルクーポン。個別ID付きURL（`?id=xxxx`）で開き、利用店舗を選んで「このクーポンを使う」を押すと、スプレッドシート上のクーポンが使用済みになる。

- フロント：[`../index.html`](../index.html)（単体で動作。GAS の URL を `API_URL` に設定する）
- バックエンド：[`Code.gs`](./Code.gs)（GAS ウェブアプリ）

配布URLの形：
```
https://vivit-festa.sunnyspot-tokyo.co.jp/coupon-2026-summer/?id=<個別ID>
```

---

## 1. スプレッドシートを用意

新規スプレッドシートを作成し、**2つのシート**を用意する（シート名は小文字厳守）。

### `coupons` シート（1行目にヘッダー）

| id | amount | used | usedAt | shopId | shopName | issuedAt | note |
|---|---:|---|---|---|---|---|---|
| 550e8400-e29b-41d4-a716-446655440000 | 300 | FALSE |  |  |  | 2026/07/17 10:00 | 来場者配布用 |

- `id`：**推測しにくいランダム文字列**（UUID推奨）。連番禁止。1IDは1人にだけ配布。
- `amount`：`300` または `500`。
- `used`：未使用は `FALSE`。**チェックボックス列でも文字列 FALSE/TRUE でも可**。
- `usedAt` / `shopId` / `shopName`：使用時にシステムが書き込む（初期は空）。

### `shops` シート（1行目にヘッダー）

| shopId | shopName | active | displayOrder | note |
|---|---|---|---:|---|
| shop-001 | サンプルショップA | TRUE | 1 |  |
| shop-002 | サンプルショップB | TRUE | 2 |  |

- `active`：`TRUE` の店舗だけがプルダウンに出る。
- `displayOrder`：プルダウンの並び順（昇順）。

> **タイムゾーン**：スプレッドシートの ファイル → 設定 → タイムゾーンを「(GMT+09:00) 東京」にしておく。

---

## 2. GAS を設置

1. スプレッドシートの **拡張機能 → Apps Script** を開く。
2. 既定の `コード.gs` を全消しして [`Code.gs`](./Code.gs) を貼り付け、保存。
3. プロジェクトの **タイムゾーン**を「Asia/Tokyo」に（プロジェクトの設定 → タイムゾーン）。
4. `CONFIG` は基本そのままでOK（このスクリプトを上記スプレッドシートにバインドして使う場合、`SPREADSHEET_ID` は空のままで動く）。
   別のスプレッドシートを参照させたい場合のみ `SPREADSHEET_ID` にIDを設定する。

---

## 3. ウェブアプリとしてデプロイ

1. 右上 **デプロイ → 新しいデプロイ**。
2. 種類（歯車）→ **ウェブアプリ**。
3. 設定：
   - 実行するユーザー：**自分**
   - アクセスできるユーザー：**全員**（ログイン不要。来場者が匿名で使うため必須）
4. **デプロイ** → 初回は権限承認。
5. 表示された **ウェブアプリURL**（`https://script.google.com/macros/s/XXXX/exec`）をコピー。

---

## 4. フロントに接続

[`../index.html`](../index.html) の `<script>` 冒頭を、コピーしたURLに差し替える：

```js
var API_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

> URLをもらえれば、こちらで差し替えコミットもできます。

---

## 5. 動作確認（本番URLで）

1. ブラウザで `…/exec?action=getCoupon&id=<coupons に入れたID>` を直接開く → JSON が返ればGAS稼働中。
2. `…/coupon-2026-summer/?id=<ID>` をスマホで開く → クーポンが表示される。
3. 店舗を選んで「このクーポンを使う」→ 確認ダイアログ → 使用済み表示に切替、`coupons` の `used` が `TRUE`・`usedAt`・`shopId`・`shopName` が入る。
4. 同じURLを再読み込み → 使用済みのまま表示される（再使用不可）。

---

## API 仕様（要点）

| 区分 | リクエスト | 主なレスポンス |
|---|---|---|
| 取得 | `GET  ?action=getCoupon&id=..` | `{success:true, coupon:{...}, shops:[...]}` |
| 使用 | `POST action=useCoupon&id=..&shopId=..` | `{success:true, coupon:{...}}` |

エラーコード：`INVALID_REQUEST` / `COUPON_NOT_FOUND` / `COUPON_ALREADY_USED` / `SHOP_NOT_FOUND` / `SHOP_INACTIVE` / `INVALID_COUPON_DATA` / `INTERNAL_ERROR`

### 安全設計（サーバー側で担保）
- 金額は `coupons`、店舗名は `shops` から取得（フロントの申告値は信用しない）。
- 使用は `LockService` で排他制御 → ロック後に使用状態を再確認してから更新（**二重使用・連打・同時アクセスを防止**）。
- 使用済みクーポンへの再POSTはサーバー側で拒否。
- エラー時にスプレッドシートIDや内部情報は返さない。

---

## 運用メモ
- コードを直したら **デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ**（URLは変わらない）。
- IDの発行は `coupons` に行を足すだけ。UUID生成は GAS で `Utilities.getUuid()` を使うと楽（一括発行スクリプトが必要なら別途用意可）。
- `?id=` は個人ごとに固有。QRやメールで各人に別URLを配布する。
