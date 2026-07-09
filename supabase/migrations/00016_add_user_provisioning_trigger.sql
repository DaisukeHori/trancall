-- =============================================================================
-- 00016: 新規ユーザー自動 provisioning トリガー追加
-- Issue #47 (#09): signup 後に trancall_auth.profiles / trancall_billing.subscriptions
-- の行が作られず、以降の API が全て失敗する不具合の修正。
-- =============================================================================
--
-- 背景:
--   apps/server/src/routes/auth-routes.ts の POST /api/auth/signup は
--   supabase.auth.signUp() を呼ぶのみで、trancall_auth.profiles /
--   trancall_billing.subscriptions への INSERT を一切行っていない。
--   結果、signup 直後に GET /api/auth/profile 等の profiles 依存 API が
--   全て失敗する（profiles 行が存在しないため）。
--
-- 対応:
--   auth.users への INSERT を契機に、DB トリガーで
--   trancall_auth.profiles と trancall_billing.subscriptions に
--   初期行を作成する（Supabase 標準の "on_auth_user_created" パターン）。
--
--   これにより、アプリ側（apps/server の signup ハンドラ）で
--   明示的な provisioning INSERT を行う必要はない。
--   supabase.auth.signUp() の options.data (display_name / native_language) は
--   auth.users.raw_user_meta_data に格納されるため、本トリガーはそこから読む。
--
-- 冪等性:
--   ON CONFLICT DO NOTHING により、何らかの理由でトリガーが二重発火しても
--   （あるいは将来アプリ側に provisioning コードが残っていても）安全。
--
-- trancall_id 生成方法:
--   `u_` プレフィックス + gen_random_uuid() のハイフン除去先頭16文字（小文字16進数）。
--   例: u_3f9a2c1b7e4d5a6f （'^[a-z0-9_]{4,30}$' / packages/auth/src/schemas.ts
--   ProfileSchema.trancallId の正規表現を満たす）。
--   衝突可能性は極めて低いが（64bit相当のランダム性）、
--   trancall_id UNIQUE 制約があるため、念のため衝突時はリトライするループを設ける。
--
-- SECURITY DEFINER + search_path 固定:
--   auth.users への INSERT は supabase_auth_admin ロールが実行するため、
--   トリガー関数は SECURITY DEFINER で定義し、関数所有者
--   （migration 実行ロール、通常 postgres）の権限で
--   trancall_auth.profiles / trancall_billing.subscriptions への INSERT を行う。
--   search_path を固定し、search_path 経由のなりすまし関数呼び出しを防ぐ。
-- =============================================================================

CREATE OR REPLACE FUNCTION trancall_auth.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate_trancall_id VARCHAR(30);
  attempt INTEGER := 0;
  max_attempts CONSTANT INTEGER := 20;
BEGIN
  -- -----------------------------------------------------------------------
  -- trancall_id をランダム生成し、衝突時はリトライ（最大 20 回）
  -- -----------------------------------------------------------------------
  LOOP
    attempt := attempt + 1;
    candidate_trancall_id := 'u_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM trancall_auth.profiles WHERE trancall_id = candidate_trancall_id
    );

    IF attempt >= max_attempts THEN
      RAISE EXCEPTION
        'trancall_id 生成が % 回連続で衝突しました (user_id=%)', max_attempts, NEW.id;
    END IF;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- trancall_auth.profiles 初期行作成
  -- display_name / native_language は signUp() options.data 経由の
  -- raw_user_meta_data から取得。未指定時はフォールバックを使用。
  -- consent_version は同意フロー未実施のため NULL のまま
  -- （docs/legal-and-consent.md の同意フローで別途記録される）。
  -- -----------------------------------------------------------------------
  INSERT INTO trancall_auth.profiles (
    user_id,
    trancall_id,
    display_name,
    native_language,
    email_verified
  ) VALUES (
    NEW.id,
    candidate_trancall_id,
    left(COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''), split_part(NEW.email, '@', 1), 'TranCall User'), 50),
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'native_language', ''), 'en'),
    NEW.email_confirmed_at IS NOT NULL
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- -----------------------------------------------------------------------
  -- trancall_billing.subscriptions 初期行作成（Free プラン既定）
  -- plan_tier / purchase_channel / included_minutes / overage_rate_yen /
  -- monthly_price_yen / transcript_retention_days は全て列 DEFAULT が
  -- Free 相当（00001_initial_schema.sql §7）なので明示指定は user_id のみで良い。
  -- purchase_channel_id_consistency 制約も
  -- purchase_channel='free' AND iap_original_transaction_id IS NULL
  -- AND stripe_subscription_id IS NULL の既定値で満たされる。
  -- -----------------------------------------------------------------------
  INSERT INTO trancall_billing.subscriptions (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trancall_auth.handle_new_user() IS
  'auth.users への INSERT を契機に trancall_auth.profiles / trancall_billing.subscriptions '
  'の初期行を作成する (Issue #47)。アプリ側 (apps/server signup ハンドラ) での '
  '明示的な provisioning INSERT は不要。冪等 (ON CONFLICT DO NOTHING)。';

-- 既存トリガーがあれば一旦削除してから再登録（idempotent migration）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION trancall_auth.handle_new_user();
