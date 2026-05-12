-- Migration 00014: agent_heartbeats テーブル追加
--
-- Translation Agent の定期 heartbeat を永続化する。
-- Agent が生存中であることと、その時点のリソース指標を記録する。
--
-- 所有モジュール: translation (trancall_event schema)
-- 参照: docs/translation-pipeline-design.md, docs/api-spec.md

CREATE TABLE IF NOT EXISTS trancall_event.agent_heartbeats (
  run_id        UUID        NOT NULL DEFAULT gen_random_uuid(),
  agent_job_id  UUID        NOT NULL,
  session_id    UUID        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  metrics       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_heartbeats_pkey PRIMARY KEY (run_id)
);

-- agent_job_id + session_id でのルックアップを高速化
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent_job_id
  ON trancall_event.agent_heartbeats (agent_job_id);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_session_id
  ON trancall_event.agent_heartbeats (session_id);

-- RLS: service role のみ INSERT / SELECT を許可
ALTER TABLE trancall_event.agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON trancall_event.agent_heartbeats
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
