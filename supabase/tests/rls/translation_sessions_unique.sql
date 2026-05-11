BEGIN;
SELECT plan(1);

-- agent_job_id の UNIQUE 制約を検証
SELECT has_index(
  'trancall_event',
  'translation_sessions',
  'translation_sessions_agent_job_id_unique',
  'translation_sessions.agent_job_id should have a UNIQUE constraint (00006 で追加)'
);

SELECT * FROM finish();
ROLLBACK;
