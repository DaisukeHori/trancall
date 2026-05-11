-- =============================================================================
-- 00003: trancall_event.agent_metrics
-- Agent からの metrics 永続化テーブル
-- =============================================================================

CREATE TABLE trancall_event.agent_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_job_id    UUID NOT NULL,
  room_id         UUID NOT NULL,
  -- latency_ms JSONB 構造: {
  --   "captureToAgent": [number, ...],    -- mic capture → Agent 到達
  --   "agentToOpenAI": [number, ...],     -- Agent → OpenAI WS 送信
  --   "openAIFirstDelta": [number, ...],  -- OpenAI WS open → 最初の response.audio.delta
  --   "agentPublish": [number, ...],      -- OpenAI delta → LiveKit Publish
  --   "totalEndToEnd": [number, ...]      -- mic capture → Callee 再生まで
  -- }
  latency_ms      JSONB NOT NULL,
  memory_rss_bytes BIGINT NOT NULL,
  collected_at    TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_metrics_collected
  USING BRIN ON trancall_event.agent_metrics(collected_at);

CREATE INDEX idx_agent_metrics_room
  ON trancall_event.agent_metrics(room_id);

ALTER TABLE trancall_event.agent_metrics ENABLE ROW LEVEL SECURITY;

-- 通常ユーザーはアクセス不可 (service_role のみ)
CREATE POLICY agent_metrics_service_only
  ON trancall_event.agent_metrics
  FOR ALL
  USING (FALSE);
