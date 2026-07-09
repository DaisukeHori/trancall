-- =============================================================================
-- 00018: trancall_billing.subscriptions.iap_original_transaction_id に
-- 部分 UNIQUE インデックスを追加
-- Issue #40: iap_original_transaction_id に一意性制約が無く、
-- 同一の Apple/Google originalTransactionId に対して複数 subscriptions 行が
-- 作られる可能性があった（Webhook / IAP 検証リトライ等での重複作成）。
-- =============================================================================
--
-- 対応:
--   iap_original_transaction_id IS NOT NULL の行のみを対象とした部分 UNIQUE
--   インデックスを追加する。free / stripe_web 等 iap_original_transaction_id が
--   NULL の行同士は対象外（NULL は複数存在して良い）。
--
-- 運用注記（適用前に必ず確認すること）:
--   本番環境に既に重複した iap_original_transaction_id を持つ行が存在する場合、
--   このインデックス作成は失敗する。適用前に下記クエリで重複の有無を確認し、
--   重複があれば正規化（同一ユーザーの重複行を1行にマージ、または誤った行を削除）
--   してから本 migration を適用すること。
--
--   -- 重複検出用クエリ（適用前チェック）:
--   -- SELECT iap_original_transaction_id, COUNT(*), array_agg(id) AS subscription_ids
--   --   FROM trancall_billing.subscriptions
--   --   WHERE iap_original_transaction_id IS NOT NULL
--   --   GROUP BY iap_original_transaction_id
--   --   HAVING COUNT(*) > 1;
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_iap_original_transaction_id_unique
  ON trancall_billing.subscriptions (iap_original_transaction_id)
  WHERE iap_original_transaction_id IS NOT NULL;

COMMENT ON INDEX trancall_billing.idx_subscriptions_iap_original_transaction_id_unique IS
  'Apple/Google IAP の originalTransactionId は購読1件につき1行のみであるべき (Issue #40)。'
  'NULL (free / stripe_web 等 IAP 以外のチャネル) は対象外の部分インデックス。';
