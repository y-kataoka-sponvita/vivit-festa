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

| id | amount | used | usedAt | shopId | shopName | issuedAt | email | sentAt | note |
|---|---:|---|---|---|---|---|---|---|---|
| （自動発行） | 300 | FALSE |  |  |  |  | taro@example.com |  | 来場者配布用 |

- `id`：**推測しにくい文字列**。連番禁止、1IDは1人にだけ配布。
  - 管理スクリプト（[`CouponAdmin.gs`](./CouponAdmin.gs)）で **`email` からハッシュ自動生成**する運用が基本（後述）。手動でUUIDを入れてもよい。
- `amount`：`300` または `500`。空なら発行時に既定額（300）を補完。
- `used`：未使用は `FALSE`。**チェックボックス列でも文字列 FALSE/TRUE でも可**。
- `usedAt` / `shopId` / `shopName`：使用時にWebアプリがJSTで書き込む（初期は空）。
- `email`：配布先メールアドレス（**発行・送信の起点**）。
- `sentAt`：クーポンメールを送った日時（管理スクリプトが記録。**二重送信防止に使うため必ず列を用意**）。

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

エラーコード：`INVALID_REQUEST` / `COUPON_NOT_FOUND` / `COUPON_ALREADY_USED` / `OUTSIDE_PERIOD` / `SHOP_NOT_FOUND` / `SHOP_INACTIVE` / `INVALID_COUPON_DATA` / `INTERNAL_ERROR`

`getCoupon` は `availability: { available, reason, from, until }` も返す（`reason`: `ok` / `before_period` / `after_period`）。

### 利用可能期間（当日限定）
- `Code.gs` の `CONFIG.USABLE_FROM` / `USABLE_UNTIL`（JST）で使用できる時間帯を制御。
  既定は **2026-08-01 11:00〜17:30**（開場11:30・閉場17:00に前後30分バッファ）。
- **判定はサーバー側**（クライアント時刻は信用しない）。期間外の使用は `OUTSIDE_PERIOD` で拒否。
- **`CONFIG.DEMO_PREFIX`（既定 `demo`）で始まるIDは期間チェックを無視**して常に使用可（テスト用）。
- 変更したい場合は `USABLE_FROM` / `USABLE_UNTIL` の2行を書き換えて再デプロイ。

### 安全設計（サーバー側で担保）
- 金額は `coupons`、店舗名は `shops` から取得（フロントの申告値は信用しない）。
- 使用は `LockService` で排他制御 → ロック後に使用状態を再確認してから更新（**二重使用・連打・同時アクセスを防止**）。
- 使用済み・期間外クーポンへの再POSTはサーバー側で拒否。
- エラー時にスプレッドシートIDや内部情報は返さない。

---

## クーポン発行＆メール送信（管理用 `CouponAdmin.gs`）

来場者のメールアドレスから **ID を自動発行**し、**id 付きクーポンURLをメール送信**するための管理スクリプト。Webには公開せず、スプレッドシートのメニューから手動実行する。

### ID の作り方
```
id = SHA-256( 小文字化・trim した email + SALT )   → 64文字の16進文字列
SALT = "2026vivit"（CouponAdmin.gs の ADMIN_CONFIG）
```
- 同じメールなら常に同じIDになる（再送しても同一URL）。
- ★ **SALT は管理スクリプト側だけに置く。`index.html`（フロント）には絶対に置かない。** 漏れると第三者が任意メールのIDを計算できてしまう。

### 設置
1. `coupons` シートに **`email` 列と `sentAt` 列**を追加する（ヘッダー名で判定するので位置は自由）。
2. Apps Script エディタで **＋ → スクリプト** を追加し、[`CouponAdmin.gs`](./CouponAdmin.gs) を貼り付けて保存（`Code.gs` と同じプロジェクトでよい）。
3. スプレッドシートを再読み込みすると、上部に **「クーポン管理」メニュー**が出る。
   （別プロジェクトにする場合は `ADMIN_CONFIG.SPREADSHEET_ID` にクーポン用スプレッドシートのIDを設定）

### 運用手順
1. `coupons` の **`email` 列**に配布先アドレスを入れる（登録フォームのリストから貼り付け等）。`amount` は 300/500 を入れる（空なら発行時に300補完）。
2. メニュー **「クーポン管理 → ① IDを発行」** … email があり id が空の行に id を発行（used=FALSE / issuedAt も補完）。同じメールの重複は自動スキップ。
3. メニュー **「② クーポンメールを送信」** … id と email があり未送信（`sentAt` 空）の行に、id付きURLをメール送信し `sentAt` を記録。
   - 送る前に **「自分宛にテストメールを送る」**で文面を確認できる。
   - 送信上限：無料Gmail **1日100通** / Google Workspace **1日1500通**。超過分は翌日に分けて再実行（`sentAt` により送信済みは自動スキップ）。

---

## 運用メモ
- コードを直したら **デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ**（URLは変わらない）。※発行・送信の `CouponAdmin.gs` はデプロイ不要（メニューから実行）。
- `?id=` は個人ごとに固有。メールや QR で各人に別URLを配布する。
