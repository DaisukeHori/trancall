-- =============================================================================
-- 00006: trancall_event.translation_sessions.agent_job_id に UNIQUE 制約を追加
-- =============================================================================
--
-- 背景:
--   PR #12 module-contracts (docs/module-contracts.md Section 7.3) で
--   「translation.session_started / session_ended の冪等性は
--    trancall_event.translation_sessions.agent_job_id (UNIQUE) で重複弾き」
--   と契約しているが、00002 migration では UNIQUE 制約が抜けていた。
--   Agent → Server の HTTP リトライで session_started が複数回到達した場合、
--   現状では同一 agent_job_id で複数行 INSERT されてしまう。
--
-- 対応:
--   trancall_event.translation_sessions.agent_job_id を UNIQUE 化。
--   既存の重複行があれば事前に DELETE する必要があるが、本テーブルは
--   Sprint 1 で新設のため Phase 1a 本番デプロイ前であれば重複行は存在しない想定。
--   本番デプロイ後に migration を適用する場合は、事前に重複の有無を確認すること。

ALTER TABLE trancall_event.translation_sessions
  ADD CONSTRAINT translation_sessions_agent_job_id_unique
  UNIQUE (agent_job_id);

-- 重複検出用クエリ (運用時の事前チェック用、コメントとして残す):
-- SELECT agent_job_id, COUNT(*) c
--   FROM trancall_event.translation_sessions
--   GROUP BY agent_job_id
--   HAVING COUNT(*) > 1;
