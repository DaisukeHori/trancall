-- =============================================================================
-- TranCall Initial Schema
-- Supabase PostgreSQL Migration
-- =============================================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS trancall_auth;
CREATE SCHEMA IF NOT EXISTS trancall_room;
CREATE SCHEMA IF NOT EXISTS trancall_contact;
CREATE SCHEMA IF NOT EXISTS trancall_billing;
CREATE SCHEMA IF NOT EXISTS trancall_transcript;
CREATE SCHEMA IF NOT EXISTS trancall_notification;

-- =============================================================================
-- 1. trancall_auth.profiles
-- =============================================================================

CREATE TABLE trancall_auth.profiles (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trancall_id    VARCHAR(30) NOT NULL UNIQUE,
  display_name   VARCHAR(50) NOT NULL,
  avatar_url     TEXT,
  native_language VARCHAR(10) NOT NULL,  -- OutputLanguage enum
  consent_version VARCHAR(20),
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_trancall_id ON trancall_auth.profiles(trancall_id);
CREATE INDEX idx_profiles_native_language ON trancall_auth.profiles(native_language);

-- =============================================================================
-- 2. trancall_room.rooms
-- =============================================================================

CREATE TABLE trancall_room.rooms (
  room_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          VARCHAR(10) NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'active', 'ended')),
  room_type       VARCHAR(10) NOT NULL DEFAULT 'audio'
                    CHECK (room_type IN ('audio', 'video')),
  translation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

CREATE INDEX idx_rooms_created_by ON trancall_room.rooms(created_by);
CREATE INDEX idx_rooms_status ON trancall_room.rooms(status) WHERE status != 'ended';
CREATE INDEX idx_rooms_created_at ON trancall_room.rooms(created_at DESC);

-- =============================================================================
-- 3. trancall_room.participants
-- =============================================================================

CREATE TABLE trancall_room.participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES trancall_room.rooms(room_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  role            VARCHAR(10) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('host', 'member')),
  is_muted        BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,
  UNIQUE (room_id, user_id)
);

CREATE INDEX idx_participants_room_user ON trancall_room.participants(room_id, user_id);
CREATE INDEX idx_participants_user_id ON trancall_room.participants(user_id);

-- =============================================================================
-- 4. trancall_contact.contacts
-- =============================================================================

CREATE TABLE trancall_contact.contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  contact_user_id UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  is_favorite     BOOLEAN NOT NULL DEFAULT FALSE,
  last_translation_config JSONB,  -- 前回の翻訳設定
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_user_id),
  CHECK (user_id != contact_user_id)
);

CREATE INDEX idx_contacts_user ON trancall_contact.contacts(user_id);

-- =============================================================================
-- 5. trancall_contact.block_list
-- =============================================================================

CREATE TABLE trancall_contact.block_list (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, blocked_user_id)
);

CREATE INDEX idx_block_list_user ON trancall_contact.block_list(user_id);

-- =============================================================================
-- 6. trancall_contact.report_events
-- =============================================================================

CREATE TABLE trancall_contact.report_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  reported_id     UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  reason          VARCHAR(20) NOT NULL
                    CHECK (reason IN ('spam', 'harassment', 'impersonation', 'other')),
  details         TEXT,
  reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. trancall_billing.subscriptions
-- =============================================================================

CREATE TABLE trancall_billing.subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES trancall_auth.profiles(user_id),
  plan_tier               VARCHAR(10) NOT NULL DEFAULT 'free'
                            CHECK (plan_tier IN ('free', 'light', 'standard', 'business')),
  included_minutes        INTEGER NOT NULL DEFAULT 3,
  overage_rate_yen        INTEGER NOT NULL DEFAULT 0,
  monthly_price_yen       INTEGER NOT NULL DEFAULT 0,
  transcript_retention_days INTEGER NOT NULL DEFAULT 7,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_customer_id      VARCHAR(255),
  stripe_subscription_id  VARCHAR(255),
  iap_original_transaction_id VARCHAR(255),
  iap_platform            VARCHAR(10) CHECK (iap_platform IN ('apple', 'google')),
  current_period_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 8. trancall_billing.usage_windows (heartbeat方式)
-- =============================================================================

CREATE TABLE trancall_billing.usage_windows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  session_id       UUID NOT NULL,
  room_id          UUID NOT NULL,
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,
  language_pair    VARCHAR(10) NOT NULL,  -- "ja-en"
  amount_yen       INTEGER NOT NULL DEFAULT 0,
  idempotency_key  VARCHAR(200) NOT NULL UNIQUE,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BRIN index: append-only高頻度書き込み向け
CREATE INDEX idx_usage_windows_recorded USING BRIN ON trancall_billing.usage_windows(recorded_at);
CREATE INDEX idx_usage_windows_user ON trancall_billing.usage_windows(user_id, recorded_at DESC);
CREATE INDEX idx_usage_windows_session ON trancall_billing.usage_windows(session_id);

-- =============================================================================
-- 9. trancall_billing.usage_reservations
-- =============================================================================

CREATE TABLE trancall_billing.usage_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  session_id      UUID NOT NULL,
  reserved_minutes INTEGER NOT NULL,
  consumed_minutes INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(10) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'reconciled', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at   TIMESTAMPTZ
);

-- =============================================================================
-- 10. trancall_transcript.segments (final only)
-- =============================================================================

CREATE TABLE trancall_transcript.segments (
  segment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL,
  participant_id  UUID NOT NULL,
  speaker_name    VARCHAR(50) NOT NULL,
  original_text   TEXT NOT NULL,
  translated_text TEXT,
  language_pair   VARCHAR(10) NOT NULL,
  start_time_ms   INTEGER NOT NULL,
  end_time_ms     INTEGER NOT NULL,
  sequence_no     INTEGER NOT NULL,
  source_event_id UUID NOT NULL,
  agent_session_id UUID,
  retention_until TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, participant_id, sequence_no)
);

-- BRIN for append-only writes
CREATE INDEX idx_segments_room USING BRIN ON trancall_transcript.segments(room_id);
CREATE INDEX idx_segments_room_time ON trancall_transcript.segments(room_id, start_time_ms);
CREATE INDEX idx_segments_retention ON trancall_transcript.segments(retention_until)
  WHERE retention_until IS NOT NULL;

-- =============================================================================
-- 11. trancall_transcript.transcript_access
-- =============================================================================

CREATE TABLE trancall_transcript.transcript_access (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  can_view        BOOLEAN NOT NULL DEFAULT TRUE,
  can_export      BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  consent_version VARCHAR(20) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX idx_transcript_access_user ON trancall_transcript.transcript_access(user_id);

-- =============================================================================
-- 12. trancall_notification.device_tokens
-- =============================================================================

CREATE TABLE trancall_notification.device_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id) ON DELETE CASCADE,
  platform        VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  token           TEXT NOT NULL,
  bundle_id       VARCHAR(255),  -- iOS only
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, token)
);

CREATE INDEX idx_device_tokens_user ON trancall_notification.device_tokens(user_id);

-- =============================================================================
-- 13. trancall_notification.push_logs
-- =============================================================================

CREATE TABLE trancall_notification.push_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  notification_type VARCHAR(20) NOT NULL,  -- 'incoming_call', 'missed_call'
  room_id         UUID,
  delivered       BOOLEAN,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_logs_user USING BRIN ON trancall_notification.push_logs(created_at);

-- =============================================================================
-- RLS Policies
-- =============================================================================

ALTER TABLE trancall_auth.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_room.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_room.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_contact.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_contact.block_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_billing.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_billing.usage_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_billing.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_transcript.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_transcript.transcript_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE trancall_notification.device_tokens ENABLE ROW LEVEL SECURITY;

-- profiles: 自分は全操作可、他者は表示名等のみ参照可
CREATE POLICY profiles_self ON trancall_auth.profiles
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY profiles_public_read ON trancall_auth.profiles
  FOR SELECT USING (TRUE);  -- display_name, native_language, avatar_url は公開

-- rooms: 参加者のみ
CREATE POLICY rooms_participant ON trancall_room.rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trancall_room.participants p
      WHERE p.room_id = rooms.room_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY rooms_create ON trancall_room.rooms
  FOR INSERT WITH CHECK (created_by = auth.uid());

-- participants: 同じRoomの参加者のみ
CREATE POLICY participants_room_member ON trancall_room.participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trancall_room.participants p2
      WHERE p2.room_id = participants.room_id AND p2.user_id = auth.uid()
    )
  );

CREATE POLICY participants_self_insert ON trancall_room.participants
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY participants_self_update ON trancall_room.participants
  FOR UPDATE USING (user_id = auth.uid());

-- contacts: 自分のみ
CREATE POLICY contacts_self ON trancall_contact.contacts
  FOR ALL USING (user_id = auth.uid());

-- block_list: 自分のみ
CREATE POLICY block_self ON trancall_contact.block_list
  FOR ALL USING (user_id = auth.uid());

-- subscriptions: 自分のみ
CREATE POLICY subscriptions_self ON trancall_billing.subscriptions
  FOR ALL USING (user_id = auth.uid());

-- usage_windows: 自分のみ
CREATE POLICY usage_self ON trancall_billing.usage_windows
  FOR SELECT USING (user_id = auth.uid());

-- usage_reservations: 自分のみ
CREATE POLICY reservations_self ON trancall_billing.usage_reservations
  FOR SELECT USING (user_id = auth.uid());

-- segments: transcript_accessで可視性判定
CREATE POLICY segments_via_access ON trancall_transcript.segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trancall_transcript.transcript_access ta
      WHERE ta.room_id = segments.room_id
        AND ta.user_id = auth.uid()
        AND ta.can_view = TRUE
        AND ta.deleted_at IS NULL
    )
  );

-- transcript_access: 自分のみ
CREATE POLICY access_self ON trancall_transcript.transcript_access
  FOR ALL USING (user_id = auth.uid());

-- device_tokens: 自分のみ
CREATE POLICY tokens_self ON trancall_notification.device_tokens
  FOR ALL USING (user_id = auth.uid());

-- =============================================================================
-- Transcript Retention Batch Delete Function
-- =============================================================================

CREATE OR REPLACE FUNCTION trancall_transcript.delete_expired_segments()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- 両者が削除済みのアクセスに対応するセグメントを削除
  WITH expired_rooms AS (
    SELECT room_id FROM trancall_transcript.transcript_access
    GROUP BY room_id
    HAVING bool_and(deleted_at IS NOT NULL)
  ),
  retention_expired AS (
    SELECT segment_id FROM trancall_transcript.segments
    WHERE retention_until < now()
  ),
  to_delete AS (
    SELECT segment_id FROM retention_expired
    UNION
    SELECT s.segment_id FROM trancall_transcript.segments s
    JOIN expired_rooms er ON er.room_id = s.room_id
  )
  DELETE FROM trancall_transcript.segments
  WHERE segment_id IN (SELECT segment_id FROM to_delete);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 14. trancall_event.translation_events (Agent → Server outbox永続化)
-- レビュー対応v1 C-001で合意したoutboxパターンの実装
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS trancall_event;

CREATE TABLE trancall_event.translation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  event_type      VARCHAR(40) NOT NULL CHECK (event_type IN (
                    'translation.started', 'translation.ended',
                    'translation.degraded', 'translation.recovered'
                  )),
  session_id      UUID NOT NULL,
  room_id         UUID NOT NULL,
  payload         JSONB NOT NULL,
  agent_id        VARCHAR(100),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  processing_error TEXT
);

CREATE INDEX idx_translation_events_received USING BRIN
  ON trancall_event.translation_events(received_at);

CREATE INDEX idx_translation_events_unprocessed
  ON trancall_event.translation_events(received_at)
  WHERE processed_at IS NULL;

CREATE INDEX idx_translation_events_session
  ON trancall_event.translation_events(session_id);

ALTER TABLE trancall_event.translation_events ENABLE ROW LEVEL SECURITY;

-- service_role のみ書き込み可能（Agent経由のinternal API）
CREATE POLICY events_service_only ON trancall_event.translation_events
  FOR ALL USING (FALSE);  -- 通常ユーザーはアクセス不可

-- =============================================================================
-- 15. trancall_auth.consent_versions (同意バージョン管理)
-- レビュー v7 M-006
-- =============================================================================

CREATE TABLE trancall_auth.consent_versions (
  version           VARCHAR(20) PRIMARY KEY,
  effective_at      TIMESTAMPTZ NOT NULL,
  retired_at        TIMESTAMPTZ,
  description       TEXT NOT NULL,
  policy_url        TEXT NOT NULL,
  requires_reconsent BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO trancall_auth.consent_versions (version, effective_at, description, policy_url)
VALUES ('v1.0', now(), 'Initial consent: audio sent to OpenAI for translation', 'https://trancall.app/privacy');

-- =============================================================================
-- pgcrypto 拡張有効化（ローカル開発用、m-002）
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
