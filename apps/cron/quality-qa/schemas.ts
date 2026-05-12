/**
 * quality-qa schemas — Zod スキーマ定義
 *
 * YAML fixture・DB レコード・ランナー入出力の型を定義する。
 */

import { z } from "zod";

// ─── Scenario fixture schema ────────────────────────────────────────────────

export const ScenarioIdSchema = z.enum(["S1", "S2", "S3", "S4", "S5"]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const TargetLangSchema = z.enum([
  "en",
  "es",
  "pt",
  "fr",
  "ja",
  "ru",
  "zh",
  "de",
  "ko",
  "hi",
  "id",
  "vi",
  "it",
]);
export type TargetLang = z.infer<typeof TargetLangSchema>;

export const SourceLangSchema = z.enum(["ja", "en", "zh", "ko"]);
export type SourceLang = z.infer<typeof SourceLangSchema>;

export const QATurnSchema = z.object({
  turn: z.number().int().min(1).max(10),
  speaker: z.enum(["A", "B"]),
  script_text: z.string().min(1),
  expected_translation: z.string().min(1),
  eval_point: z.string().optional(),
});
export type QATurn = z.infer<typeof QATurnSchema>;

export const ScenarioFixtureSchema = z.object({
  scenario_id: z.string().min(1),
  scenario: ScenarioIdSchema,
  name: z.string().min(1),
  source_lang: SourceLangSchema,
  target_lang: TargetLangSchema,
  context: z.string().optional(),
  audio_url: z.string().url().nullable().optional(),
  expected_keywords: z.array(z.string()).optional(),
  ambient_passthrough_check: z.boolean().optional(),
  turns: z.array(QATurnSchema),
});
export type ScenarioFixture = z.infer<typeof ScenarioFixtureSchema>;

// ─── Runner output schema ────────────────────────────────────────────────────

export const QATurnResultSchema = z.object({
  turn_number: z.number().int().min(1).max(10),
  source_text: z.string(),
  translated_text: z.string(),
  expected_translation: z.string(),
  latency_ms: z.number().nonnegative().nullable(),
  eval_point: z.string().optional(),
});
export type QATurnResult = z.infer<typeof QATurnResultSchema>;

export const QARunResultSchema = z.object({
  run_id: z.string().uuid(),
  scenario_id: z.string(),
  scenario: ScenarioIdSchema,
  source_lang: SourceLangSchema,
  target_lang: TargetLangSchema,
  room_name: z.string().nullable(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  turn_results: z.array(QATurnResultSchema),
  error: z.string().nullable().optional(),
});
export type QARunResult = z.infer<typeof QARunResultSchema>;

// ─── DB record schema (quality_qa_results テーブル) ─────────────────────────

export const QAResultDbRecordSchema = z.object({
  run_id: z.string().uuid(),
  scenario_id: z.string(),
  source_lang: z.string(),
  target_lang: z.string(),
  translated_text: z.string(),
  score: z.number().min(1).max(5).nullable(),
  passed: z.boolean().nullable(),
  evaluator_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().datetime().optional(),
});
export type QAResultDbRecord = z.infer<typeof QAResultDbRecordSchema>;

// ─── Evaluator sheet row schema ──────────────────────────────────────────────

export const EvaluatorSheetRowSchema = z.object({
  scenario_id: z.string(),
  source_lang: z.string(),
  target_lang: z.string(),
  turn_number: z.number().int(),
  source_text: z.string(),
  translated_text: z.string(),
  expected_keywords: z.string(), // comma-separated
  pass_fail: z.enum(["PASS", "FAIL", "CONDITIONAL_PASS", "PENDING"]),
  evaluator_note: z.string().optional(),
  score_a: z.number().min(1).max(5).nullable().optional(),
  score_f: z.number().min(1).max(5).nullable().optional(),
  score_c: z.number().min(1).max(5).nullable().optional(),
  score_l: z.number().min(1).max(5).nullable().optional(),
  score_s: z.number().min(1).max(5).nullable().optional(),
  weighted_score: z.number().nullable().optional(),
});
export type EvaluatorSheetRow = z.infer<typeof EvaluatorSheetRowSchema>;
