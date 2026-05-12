-- Migration: 00013_add_quality_qa_results_table
-- Table: trancall_event.quality_qa_results
-- Purpose: 翻訳品質 QA 実走結果の記録 (T-61)

begin;

create table if not exists trancall_event.quality_qa_results (
  id                uuid        primary key default gen_random_uuid(),
  run_id            uuid        not null,
  scenario_id       text        not null,
  source_lang       text        not null,
  target_lang       text        not null,
  translated_text   text        not null default '',
  score             numeric(3,1)
                    check (score is null or (score >= 1 and score <= 5)),
  passed            boolean,
  evaluator_id      uuid        references auth.users (id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Index for querying by run
create index if not exists quality_qa_results_run_id_idx
  on trancall_event.quality_qa_results (run_id);

-- Index for querying by language pair
create index if not exists quality_qa_results_lang_pair_idx
  on trancall_event.quality_qa_results (source_lang, target_lang);

-- Index for querying by scenario
create index if not exists quality_qa_results_scenario_id_idx
  on trancall_event.quality_qa_results (scenario_id);

-- Index for querying by evaluator
create index if not exists quality_qa_results_evaluator_id_idx
  on trancall_event.quality_qa_results (evaluator_id)
  where evaluator_id is not null;

-- updated_at auto-update trigger
create or replace function trancall_event.set_quality_qa_results_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger quality_qa_results_updated_at
  before update on trancall_event.quality_qa_results
  for each row execute procedure trancall_event.set_quality_qa_results_updated_at();

-- RLS: QA 担当者はレコードを挿入・更新可。参照は認証済みユーザー全員に許可。
alter table trancall_event.quality_qa_results enable row level security;

create policy "quality_qa_results: authenticated users can read"
  on trancall_event.quality_qa_results
  for select
  to authenticated
  using (true);

create policy "quality_qa_results: service role can insert"
  on trancall_event.quality_qa_results
  for insert
  to service_role
  with check (true);

create policy "quality_qa_results: evaluator can update own notes and score"
  on trancall_event.quality_qa_results
  for update
  to authenticated
  using (evaluator_id = auth.uid())
  with check (evaluator_id = auth.uid());

comment on table trancall_event.quality_qa_results is
  'Sprint 3 翻訳品質 QA 実走結果。D10 translation-quality-qa.md §8 に準拠。';
comment on column trancall_event.quality_qa_results.run_id is
  'QA 実走セッション ID (quality-qa/runner.ts が生成する UUID)';
comment on column trancall_event.quality_qa_results.scenario_id is
  'テストケース ID (例: TC-S1-en、TC-S2-ja)';
comment on column trancall_event.quality_qa_results.source_lang is
  '発話言語 ISO 639-1 コード (ja/en/zh/ko)';
comment on column trancall_event.quality_qa_results.target_lang is
  '翻訳先言語 ISO 639-1 コード (13 言語)';
comment on column trancall_event.quality_qa_results.translated_text is
  '翻訳済みテキスト (GPT-RT-Translate の出力)';
comment on column trancall_event.quality_qa_results.score is
  '総合スコア 1.0–5.0 (§3.1 の加重平均: A×0.3 + F×0.25 + C×0.2 + L×0.15 + S×0.1)';
comment on column trancall_event.quality_qa_results.passed is
  '合否判定 (true=PASS/CONDITIONAL_PASS, false=FAIL, null=未評価)';
comment on column trancall_event.quality_qa_results.evaluator_id is
  'ネイティブ評価者の auth.users.id';
comment on column trancall_event.quality_qa_results.notes is
  '評価者メモ・問題点の詳細';

commit;
