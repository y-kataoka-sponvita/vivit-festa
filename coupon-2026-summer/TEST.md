# Vivitフェスタ クーポンシステム テスト項目書（2026夏）

対象：`coupon-2026-summer/`（フロント `index.html` ＋ GAS）

- 公開URL：`https://vivit-festa.sunnyspot-tokyo.co.jp/coupon-2026-summer/?id=<ID>`
- 実施環境：本番URL（GitHub Pages）で行う。スマホ実機（iPhone Safari / Android Chrome）必須。
- 判定：期待結果どおりなら ✅ / 異なれば ❌ と実際の挙動をメモ。

---

## 0. 事前準備（テストデータ）

スプレッドシートに以下を用意する（`used` は空でも FALSE 扱い）。

### `coupons` シート
| id | amount | used | usedAt | shopId | shopName | note |
|---|---:|---|---|---|---|---|
| `demo` | 300 | FALSE |  |  |  | 正常系（300円）|
| `test-500` | 500 | FALSE |  |  |  | 正常系（500円）|
| `test-used` | 300 | TRUE | 2026-08-01T13:30:00+09:00 | 1 | クッキー屋さん | 使用済み表示の確認 |
| `test-baddata` | 999 | FALSE |  |  |  | 不正金額の確認 |
| `test-post` | 300 | FALSE |  |  |  | curl用（消費されるので使い捨て）|

### `shops` シート
| shopId | shopName | active | displayOrder | note |
|---|---|---|---:|---|
| `1` | クッキー屋さん | TRUE | 1 |  |
| `2` | アクセサリー雑貨 hoshi | TRUE | 2 |  |
| `3` | アイス工房ぽっぷ | TRUE | 3 |  |
| `99` | 休止テスト店 | FALSE | 99 | 非アクティブの確認 |

> テスト用API_URL（curl用）:
> `https://script.google.com/macros/s/AKfycbx8PW2weykoGiZDBnjn3bBWa5H8gSLRcujG8KRDYFD17rrcGRQhaOvGdFDfoho9oCb8/exec`

---

## 1. 正常系

- [ ] **1-1 300円クーポン表示**：`?id=demo` を開く → 金額「300円」、当日限り/1回限りチップ、店舗プルダウン表示
- [ ] **1-2 500円クーポン表示**：`?id=test-500` を開く → 金額「500円」で表示
- [ ] **1-3 店舗一覧取得**：プルダウンに `shops` の active店舗が `displayOrder` 昇順（クッキー屋さん→hoshi→ぽっぷ）で並ぶ。休止テスト店は出ない
- [ ] **1-4 未選択時ボタン非活性**：店舗未選択のあいだ「このクーポンを使う」が押せない（グレー）
- [ ] **1-5 選択後ボタン活性**：店舗を選ぶとボタンが赤く押せる状態になる
- [ ] **1-6 確認ダイアログ・キャンセル**：ボタン押下 → 「『◯◯』でこのクーポンを使用しますか？」→ キャンセル → 未使用のまま
- [ ] **1-7 使用実行**：再度押下 → 承認 → 「使用処理中…」→ 使用済み表示に切替（スタンプ「使用済み」・使用店舗・使用日時）
- [ ] **1-8 スプレッドシート更新**：`demo` 行が `used=TRUE`、`usedAt`（JST）、`shopId`、`shopName` が記録される
- [ ] **1-9 再読み込み後も使用済み**：同じURLをリロード → 使用済み表示のまま、操作不可
- [ ] **1-10 使用済み表示の明確さ**：色（グレー化）＋文言（使用済み）＋スタンプの複数要素で判別できる

---

## 2. 異常系（画面で確認できるもの）

- [ ] **2-1 ID未指定**：`?id=` を付けずに開く → 「クーポンIDが指定されていません」
- [ ] **2-2 空ID**：`?id=`（値なし）で開く → 「クーポンIDが指定されていません」
- [ ] **2-3 存在しないID**：`?id=nothing-xxxx` → 「クーポンが見つかりません」
- [ ] **2-4 既に使用済みのクーポンを開く**：`?id=test-used` → 最初から使用済み表示（使用店舗・使用日時つき）、プルダウン/ボタンなし
- [ ] **2-5 不正な金額データ**：`?id=test-baddata`（amount=999）→ 「クーポン情報が正しくありません」（金額は表示しない）
- [ ] **2-6 通信エラー（読み込み）**：端末を機内モードにして `?id=demo` を開く → 「通信に失敗しました」＋「再読み込み」ボタン。オンラインに戻して再読み込みで復帰
- [ ] **2-7 通信エラー（使用時）**：`?id=test-500` を開いて店舗選択 → 機内モードにしてから使用ボタン → 「通信に失敗しました…」エラー表示、ボタンは元に戻り再試行できる
- [ ] **2-8 二重送信（連打）**：使用ボタンを素早く2回以上タップ → 送信は1回だけ、使用済みは1回のみ（プルダウン/ボタンが処理中は無効）

---

## 3. サーバー側でのみ確認する項目（curl / 2端末）

UIからは起こせない防御ロジックを直接確認する。**各コマンドはクーポンを消費するため、使い捨てIDで行い、後でリセットする。**

```bash
API="https://script.google.com/macros/s/AKfycbx8PW2weykoGiZDBnjn3bBWa5H8gSLRcujG8KRDYFD17rrcGRQhaOvGdFDfoho9oCb8/exec"
```

- [ ] **3-1 必須項目不足（INVALID_REQUEST）**
  ```bash
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=test-post"
  # 期待: {"success":false,"error":{"code":"INVALID_REQUEST",...}}（shopId不足）
  ```
- [ ] **3-2 存在しない店舗（SHOP_NOT_FOUND）**
  ```bash
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=test-post" --data-urlencode "shopId=zzz"
  # 期待: {"success":false,"error":{"code":"SHOP_NOT_FOUND",...}}（クーポンは未使用のまま）
  ```
- [ ] **3-3 休止中の店舗（SHOP_INACTIVE）**
  ```bash
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=test-post" --data-urlencode "shopId=99"
  # 期待: {"success":false,"error":{"code":"SHOP_INACTIVE",...}}（クーポンは未使用のまま）
  ```
- [ ] **3-4 正常使用 → 二重使用拒否（COUPON_ALREADY_USED）**
  ```bash
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=test-post" --data-urlencode "shopId=1"
  # 期待: {"success":true,"coupon":{...used:true...}}
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=test-post" --data-urlencode "shopId=1"
  # 期待: {"success":false,"error":{"code":"COUPON_ALREADY_USED",...},"coupon":{...}}
  ```
- [ ] **3-5 存在しないIDへの使用（COUPON_NOT_FOUND）**
  ```bash
  curl -sL "$API" --data-urlencode "action=useCoupon" --data-urlencode "id=nothing" --data-urlencode "shopId=1"
  # 期待: {"success":false,"error":{"code":"COUPON_NOT_FOUND",...}}
  ```
- [ ] **3-6 同時アクセスでの二重使用防止**：未使用IDを1つ用意し、2台の端末（または2つのcurlをほぼ同時実行）で同じIDを使用 → **片方だけ success、もう片方は COUPON_ALREADY_USED**。シートの使用は1回だけ
- [ ] **3-7 内部情報の非露出**：どのエラー応答にもスプレッドシートIDや内部スタックが含まれない

---

## 4. スマホ / レイアウト

- [ ] **4-1 iPhone Safari**：表示・操作・使用まで問題なし
- [ ] **4-2 Android Chrome**：表示・操作・使用まで問題なし
- [ ] **4-3 幅320px**：iPhone SE相当でレイアウトが崩れない（金額・ボタン・プルダウンが収まる）
- [ ] **4-4 タップしやすさ**：ボタン高さ・プルダウンが十分大きくタップしやすい

---

## 5. テスト後のリセット手順

- `demo` / `test-500` / `test-post` などを再テストする場合は、`coupons` シートで対象行の
  `used` を `FALSE` に戻し、`usedAt` / `shopId` / `shopName` を空にする。
- 本番配布前に、テスト用の行（`test-*`）と `demo` を削除、または `used` 状態を整える。
- `shops` の「休止テスト店（shopId=99）」も本番前に削除する。
