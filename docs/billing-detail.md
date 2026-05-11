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

```sql
-- 冪等INSERT（idempotency_keyで重複排除）
INSERT INTO trancall_billing.usage_windows
  (user_id, session_id, room_id, window_start, window_end,
   duration_seconds, language_pair, amount_yen, idempotency_key)
VALUES ($1, $2, $3, $4, $5, 30, $6, $7, $8)
ON CONFLICT (idempotency_key) DO NOTHING;

-- 残量再計算
-- shouldContinue = (remaining_minutes > 0)
```

amount_yen計算:
```
翻訳のみ: 30秒 × (超過料金/60) = 例: 30 × (40/60) ≈ 20円
含有分内: amount_yen = 0（含有分を消費）
超過時: amount_yen = ceil(duration_seconds / 60 × overage_rate_yen)
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
