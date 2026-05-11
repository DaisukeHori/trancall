# 第10回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | Claude (Opus 4.7) |
| 範囲 | 第9回レビュー(もう一巡)で新規発見した Critical 1 + Major 3 + Minor 3 |
| ユーザー指示 | 「Critical 1 + Major 3 + Minor 3 これらを潰してください」 |
| 推奨案の採用 | Q-002: `purchase_channel` 追加 + `iap_platform` 削除 / Q-003: `TRANSLATION_*`, `BILLING_*` プレフィックス採用 |

## Critical

### C-001-NEW: heartbeat API に `roomId` が無いが `usage_windows.room_id NOT NULL` に違反

**発見**: 第9回レビュー(もう一巡)で発見。

- `supabase/migrations/00001_initial_schema.sql`: `usage_windows.room_id UUID NOT NULL`
- `docs/billing-detail.md`: heartbeat SQL は `INSERT INTO usage_windows (..., room_id, ...)` で room_id を含む
- `docs/api-spec.md`: heartbeat Request body に `roomId` が無い
- `docs/agent-flow.md`: `startHeartbeat()` の fetch body に `roomId` が無い

Phase 1a Day 1 で `null value in column "room_id" violates not-null constraint` で失敗。

**今回の対応**:
- `docs/api-spec.md` の heartbeat Request body に `"roomId": "uuid"` を追加
- `docs/agent-flow.md` の `startHeartbeat()` body に `roomId: this.config.roomId` を追加
- `TranslationSession` のコンストラクタには既に `roomId: room.name` が渡されているので参照可能

## Major

### M-001-NEW: `subscriptions.iap_platform` の意味が StoreKit External 採用後に曖昧

**発見**: 第8回で StoreKit External Purchase を採用した結果、`iap_platform` 列の意味が「IAPプラットフォーム識別子」から「Apple月次レポート対象フラグ」へと拡大解釈される構造になっており、列名と実態が乖離していた。

**今回の対応**: `subscriptions` テーブルに `purchase_channel` カラムを新設、`iap_platform` を削除:

```sql
purchase_channel VARCHAR(20) NOT NULL DEFAULT 'free'
  CHECK (purchase_channel IN (
    'free', 'iap_apple', 'iap_google',
    'storekit_external', 'stripe_web'
  )),
```

加えて整合性 CHECK 制約を追加:
```sql
ALTER TABLE trancall_billing.subscriptions ADD CONSTRAINT purchase_channel_id_consistency CHECK (
  (purchase_channel = 'free' AND iap_original_transaction_id IS NULL AND stripe_subscription_id IS NULL)
  OR (purchase_channel IN ('iap_apple', 'iap_google') AND iap_original_transaction_id IS NOT NULL)
  OR (purchase_channel IN ('storekit_external', 'stripe_web') AND stripe_subscription_id IS NOT NULL)
);
```

`docs/billing-detail.md` の「チャネル別 DB 状態」表も新カラムで書き換え:

| 購入チャネル | purchase_channel | iap_original_transaction_id | stripe_subscription_id |
|------------|------------------|---------------------------|------------------------|
| Free | 'free' | NULL | NULL |
| IAP Apple | 'iap_apple' | "abc123..." | NULL |
| IAP Google | 'iap_google' | "xyz789..." | NULL |
| StoreKit External | 'storekit_external' | NULL | "sub_..." |
| Stripe Web | 'stripe_web' | NULL | "sub_..." |

### M-002-NEW: reserveMinutes の残量チェック SQL で `$2` が説明されていない

**発見**: billing-detail.md の SQL `WHERE user_id = $1 AND recorded_at >= $2` の `$2` が何の日付か不明で、Phase 1a 実装者が「30日前で固定?月初?」で詰まる。

**今回の対応**: SQL を `subscriptions` テーブルと JOIN する形式に書き換え、パラメータも明示:

```sql
-- $1 = user_id
SELECT
  s.included_minutes - COALESCE(CEIL(SUM(u.duration_seconds)::numeric / 60), 0) AS remaining
FROM trancall_billing.subscriptions s
LEFT JOIN trancall_billing.usage_windows u
  ON u.user_id = s.user_id
  AND u.recorded_at >= s.current_period_start
  AND u.recorded_at <  s.current_period_end
WHERE s.user_id = $1
GROUP BY s.included_minutes;
```

`current_period_start` と `current_period_end` で当期課金サイクル全体を窓として使う形に。

### M-003-NEW: `api-spec.md` と `error-handling.md` でエラーコード名が不一致

**発見**:
- api-spec.md 共通仕様: `INSUFFICIENT_BALANCE`, `PROVIDER_ERROR`
- error-handling.md: `TRANSLATION_PROVIDER_ERROR`, `TRANSLATION_RATE_LIMITED` 等

**今回の対応**: ユーザー推奨の (a) ドメイン固有プレフィックス採用で統一:

- api-spec.md 共通仕様を命名規約に変更:
  - **ドメイン共通**: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `INTERNAL_ERROR`, `NETWORK_ERROR`
  - **ドメイン固有**: `AUTH_*`, `ROOM_*`, `CONTACT_*`, `TRANSLATION_*`, `BILLING_*`
- 完全なコード一覧は error-handling.md を **単一の参照源** と明記
- error-handling.md の billing セクションを `BILLING_INSUFFICIENT_BALANCE`, `BILLING_SUBSCRIPTION_EXPIRED`, `BILLING_PAYMENT_FAILED` に統一
- `BILLING_INVALID_RECEIPT` と `BILLING_CHANNEL_NOT_AVAILABLE`(海外からの storekit_external 要求拒否用) を追加
- billing-detail.md 中のコメント `INSUFFICIENT_BALANCE` → `BILLING_INSUFFICIENT_BALANCE`

## Minor

### m-001-NEW: `SUM(duration_seconds) / 60` の整数除算で 60秒未満が消える

**発見**: PostgreSQL の integer ÷ integer は整数除算。例えば 1190秒 → 19分(50秒消失)。

**今回の対応**: M-002-NEW の SQL 書き換えと同時に `CEIL(SUM(u.duration_seconds)::numeric / 60)` で切り上げ。numeric キャストで整数除算を回避。

### m-002-NEW: unit-economics.md の「リンクタップから7日以内」の粗利への影響が曖昧

**発見**: Apple 仕様「Transactions within seven days of an external link tap are commissionable」の解釈で、2回目以降の自動更新分が commissionable かどうかで粗利が大きく変わる可能性があるが、注釈が薄かった。

**今回の対応**: unit-economics.md に2シナリオ(保守的・楽観)を明示し、Phase 1c 直前に Apple Japan サポートに照会することを明記。

### m-003-NEW: `permission-consent.html` の6画面が wireframes/README.md の遷移マップに統合されていない

**発見**: 第8回 M-006 で指摘した内容が未対応のままだった。

**今回の対応**: `docs/design/wireframes/README.md` の画面遷移マップに権限・同意フローを統合し、各画面の出現タイミングを表で明示。

## 修正したファイル一覧

| ファイル | 種類 | 内容 |
|---------|------|------|
| docs/agent-flow.md | C-001-NEW | startHeartbeat に roomId 追加 |
| docs/api-spec.md | C-001-NEW + M-003-NEW | heartbeat に roomId 追加 + エラーコード命名規約 |
| docs/billing-detail.md | M-001-NEW + M-002-NEW + m-001-NEW + M-003-NEW | DB 状態表 + reserveMinutes SQL + CEIL + コメント |
| docs/error-handling.md | M-003-NEW | billing セクション BILLING_* プレフィックス |
| docs/unit-economics.md | m-002-NEW | 7日ルール注釈の詳細化 |
| docs/design/wireframes/README.md | m-003-NEW | 画面遷移マップに権限・同意フロー統合 |
| supabase/migrations/00001_initial_schema.sql | M-001-NEW | subscriptions: purchase_channel 追加、iap_platform 削除、CHECK 制約 |
| docs/review-responses-v10.md | このファイル(新規) | レビュー記録 |

## 次のステップ

これで Phase 1a Day 1 で詰まる箇所は理論上ゼロ。Phase 1a に着手可能な状態。
