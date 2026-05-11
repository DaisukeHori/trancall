-- =============================================================================
-- 00002: trancall_event.translation_sessions
-- Agent からの session 永続化用テーブル
-- =============================================================================

CREATE TABLE trancall_event.translation_sessions (
  session_id            UUID PRIMARY KEY,
  agent_job_id          UUID NOT NULL,
  room_id               UUID NOT NULL,
  source_participant_id UUID NOT NULL,
  target_participant_id UUID,
  output_language       VARCHAR(10) NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  duration_ms           INTEGER,
  billable_seconds      INTEGER,
  ended_reason          VARCHAR(40),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_translation_sessions_room
  ON trancall_event.translation_sessions(room_id);

CREATE INDEX idx_translation_sessions_started
  USING BRIN ON trancall_event.translation_sessions(started_at);

ALTER TABLE trancall_event.translation_sessions ENABLE ROW LEVEL SECURITY;

-- 通常ユーザーはアクセス不可 (service_role のみ)
CREATE POLICY translation_sessions_service_only
  ON trancall_event.translation_sessions
  FOR ALL
  USING (FALSE);
