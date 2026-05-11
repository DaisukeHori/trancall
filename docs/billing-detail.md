# TranCall 課金フロー詳細設計

## reservation → heartbeat → reconcile シーケンス

### 通話開始時: reserveMinutes

```sql
-- 1. 残量チェック
SELECT included_minutes - COALESCE(
  (SELECT SUM(duration_seconds) / 60 FROM trancall_billing.usage_windows
   WHERE user_id = $1 AND recorded_at >= $2), 0
) AS remaining
FROM trancall_billing.subscriptions
WHERE user_id = $1;

-- 2. remaining >= 1 なら予約作成
INSERT INTO trancall_billing.usage_reservations
  (user_id, session_id, reserved_minutes, status)
VALUES ($1, $2, LEAST(5, remaining), 'active');

-- 3. remaining < 1 なら INSUFFICIENT_BALANCE エラー
```

### 通話中: heartbeat (30秒ごと)

サーバー側の処理順序（API Server内）:

1. **heartbeatリクエストを受信**（Agent → POST /internal/translation/heartbeat）
2. **SubscriptionStateを取得**（`overage_rate_yen`, `included_minutes`, 当期消費分から `remaining_minutes` を算出）
3. **amount_yen を計算**:
   - `remaining_minutes > 0`: `amount_yen = 0`（含有分を消費）
   - `remaining_minutes <= 0`: `amount_yen = ceil(duration_seconds / 60 × overage_rate_yen)`
   - 含有分を跨ぐ window（例: 残10秒→0秒）: 含有部分は0、超過部分のみ請求
4. **usage_windows に冪等 INSERT**（idempotency_key で重複排除）
5. **shouldContinue を判定**: `(remaining_minutes - new_minutes_consumed > 0) OR has_active_payment_method`

```sql
-- 冪等INSERT（idempotency_keyで重複排除）
INSERT INTO trancall_billing.usage_windows
  (user_id, session_id, room_id, window_start, window_end,
   duration_seconds, language_pair, amount_yen, idempotency_key)
VALUES ($1, $2, $3, $4, $5, 30, $6, $7, $8)
ON CONFLICT (idempotency_key) DO NOTHING;

-- 残量再計算
-- shouldContinue = (remaining_minutes > 0 OR has_payment_method)
```

amount_yen計算式（具体例）:
```
overage_rate_yen = 40（Lightプラン）、duration_seconds = 30 のwindow:
- 含有分残あり: amount_yen = 0
- 含有分切れ:   amount_yen = ceil(30 / 60 × 40) = ceil(20) = 20円
- 跨ぎwindow（残10秒+超過20秒）:
    含有部分 10秒分: 0円
    超過部分 20秒分: ceil(20 / 60 × 40) = ceil(13.33) = 14円
    合計: 14円
```

### 通話終了時: reconcile

```sql
-- 1. 予約を確定
UPDATE trancall_billing.usage_reservations
SET status = 'reconciled',
    consumed_minutes = (
      SELECT SUM(duration_seconds) / 60
      FROM trancall_billing.usage_windows
      WHERE session_id = $1
    ),
    reconciled_at = now()
WHERE session_id = $1 AND status = 'active';

-- 2. 未使用予約分を解放（自動、consumed < reserved なら差分が戻る）
```

### 残高不足時の挙動

```
heartbeat response: { shouldContinue: false, remainingMinutes: 0 }
  ↓
Agent: 翻訳セッション停止
  ↓
Agent: POST /internal/translation/events { type: "ended", reason: "insufficient_balance" }
  ↓
Client: 翻訳停止通知 → ambient 100% → 通話自体は継続
  ↓
Client: 「翻訳分数が不足しています」ダイアログ（通話中に表示）
  ↓
ユーザー選択:
  (a) 通話終了
  (b) 翻訳なしで通話継続
  (c) プランアップグレード（アプリ内課金画面へ→完了後に翻訳再開）
```

## 購入チャネル設計（3チャネル併設）

ユーザーは状況に応じて以下3チャネルから購入方法を選択できる。

### (a) IAP（App Store / Google Play）

```
クライアント:
  POST /api/billing/checkout { tier: "standard", paymentMethod: "iap" }
    ↓ レスポンスの productId を取得
  StoreKit 2 / Google Play Billing Library で IAP フロー起動
    ↓
  購入完了 → StoreKit / Google から App Store Server Notifications V2 / RTDN がサーバーに到着
    ↓
  サーバー: POST /api/billing/webhook/apple または /webhook/google
    ↓
  webhook_events に冪等INSERT → subscriptions.iap_original_transaction_id 更新
```

### (b) StoreKit External Purchase（日本MSCA対応、アプリ内Stripe）

```
クライアント:
  POST /api/billing/checkout { tier: "standard", paymentMethod: "storekit_external" }
    ↓ レスポンス: { url, externalPurchaseToken, disclosureSheetRequired: true }
  StoreKit ExternalPurchase API.requestUserConfirmation()
    ↓ Apple disclosure sheet 表示（"You are leaving the App Store..."）
  ユーザー同意 → openURL(stripeCheckoutUrl)
    ↓ Webブラウザ（SFSafariViewController or 外部Safari）でStripe Checkout
    ↓
  Stripe Webhook → サーバー: POST /api/billing/webhook/stripe
    ↓
  サーバー: POST /api/billing/storekit-external/report で Apple External Purchase Server API に取引報告
    ↓
  Apple月次レポート → Apple-issued invoice → 30日以内に支払い
```

### (c) Stripe Web（アプリ外、B2B/年間契約）

```
ユーザー:
  Webブラウザで trancall.app の billing ページにアクセス
    ↓
  サーバー: Stripe Checkout Session 作成
    ↓
  Stripe Checkout → 完了 → Stripe Webhook
    ↓
  webhook_events に冪等INSERT → subscriptions.stripe_subscription_id 更新
```

### チャネル別の DB 状態

| 購入チャネル | subscriptions テーブルへの記録 |
|------------|------------------------------|
| IAP (Apple) | iap_original_transaction_id, iap_platform='apple' |
| IAP (Google) | iap_original_transaction_id, iap_platform='google' |
| StoreKit External | stripe_subscription_id + iap_platform='apple' (Apple月次レポート対象) |
| Stripe Web | stripe_subscription_id のみ |

注: 1ユーザーに対して subscriptions 行は1つのみ（user_id UNIQUE 制約）。プラン変更時は同じ行を update。
