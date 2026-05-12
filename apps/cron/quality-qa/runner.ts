/**
 * quality-qa runner
 *
 * シナリオ YAML を順次読み込み、mock または実 LiveKit Room で実行し、
 * 翻訳済み transcript を取得して quality_qa_results テーブルに記録する。
 *
 * 実走モード: LIVEKIT_URL / OPENAI_API_KEY が存在する場合
 * mock モード: 環境変数 QA_MOCK=true または上記が未設定の場合
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import yaml from "js-yaml";

import {
  type QARunResult,
  type QATurnResult,
  type ScenarioFixture,
  ScenarioFixtureSchema,
} from "./schemas.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface RunnerConfig {
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  mockMode: boolean;
}

export function loadRunnerConfig(): RunnerConfig {
  const livekitUrl = process.env["LIVEKIT_URL"] ?? null;
  const livekitApiKey = process.env["LIVEKIT_API_KEY"] ?? null;
  const livekitApiSecret = process.env["LIVEKIT_API_SECRET"] ?? null;
  const supabaseUrl = process.env["SUPABASE_URL"] ?? null;
  const supabaseServiceRoleKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? null;

  const mockMode =
    process.env["QA_MOCK"] === "true" ||
    !livekitUrl ||
    !livekitApiKey ||
    !livekitApiSecret;

  return {
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    supabaseUrl,
    supabaseServiceRoleKey,
    mockMode,
  };
}

// ─── Fixture loader ──────────────────────────────────────────────────────────

export function loadScenarioFixture(fixturePath: string): ScenarioFixture {
  const raw = readFileSync(fixturePath, "utf-8");
  const parsed = yaml.load(raw);
  const result = ScenarioFixtureSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid fixture at ${fixturePath}: ${result.error.message}`
    );
  }
  return result.data;
}

export function loadAllFixtures(scenariosDir: string): ScenarioFixture[] {
  const fixtures: ScenarioFixture[] = [];

  const langPairs = readdirSync(scenariosDir).filter((entry) =>
    statSync(join(scenariosDir, entry)).isDirectory()
  );

  for (const langPair of langPairs) {
    const langPairDir = join(scenariosDir, langPair);
    const files = readdirSync(langPairDir).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
      const fixture = loadScenarioFixture(join(langPairDir, file));
      fixtures.push(fixture);
    }
  }

  return fixtures;
}

// ─── Mock runner ─────────────────────────────────────────────────────────────

/**
 * Mock 実行: 実際の LiveKit/OpenAI 接続なしで fixture の expected_translation を
 * そのまま translated_text として返す。テスト・CI 環境で使用する。
 */
export async function runScenarioMock(
  fixture: ScenarioFixture,
  _config: RunnerConfig
): Promise<QARunResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const turnResults: QATurnResult[] = fixture.turns.map((turn) => ({
    turn_number: turn.turn,
    source_text: turn.script_text,
    translated_text: turn.expected_translation,
    expected_translation: turn.expected_translation,
    latency_ms: Math.floor(Math.random() * 2000) + 500, // mock latency 500–2500ms
    eval_point: turn.eval_point,
  }));

  return {
    run_id: runId,
    scenario_id: fixture.scenario_id,
    scenario: fixture.scenario,
    source_lang: fixture.source_lang,
    target_lang: fixture.target_lang,
    room_name: null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    turn_results: turnResults,
    error: null,
  };
}

// ─── Live runner ─────────────────────────────────────────────────────────────

/**
 * 実走実行: LiveKit Room を作成し、translation-agent を参加させて
 * audio_url を再生・翻訳済み transcript を取得する。
 *
 * NOTE: Phase 1a では QA 担当者が手動で TranCall 通話を行うため、
 * このランナーはスクリプト cue の表示と結果記録を担当する。
 * 自動音声再生は Phase 1c 以降の自動化ロードマップ (D11) で実装予定。
 */
export async function runScenarioLive(
  fixture: ScenarioFixture,
  config: RunnerConfig
): Promise<QARunResult> {
  if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    throw new Error("LiveKit config is required for live run");
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const roomName = `qa-${fixture.source_lang}-${fixture.target_lang}-${fixture.scenario}-${Date.now()}`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`QA Run: ${fixture.scenario_id}`);
  console.log(`Language pair: ${fixture.source_lang} → ${fixture.target_lang}`);
  console.log(`Room: ${roomName}`);
  console.log(`${"=".repeat(60)}\n`);
  console.log("Context:", fixture.context ?? "");
  console.log("\nStarting turns. Press Enter after each turn to proceed.\n");

  const turnResults: QATurnResult[] = [];

  for (const turn of fixture.turns) {
    console.log(`\n--- Turn ${turn.turn} / Speaker ${turn.speaker} ---`);
    console.log(`Script: ${turn.script_text}`);
    console.log(`Expected: ${turn.expected_translation}`);
    if (turn.eval_point) {
      console.log(`Eval: ${turn.eval_point}`);
    }

    // In live mode: wait for QA operator to speak and record translation
    // This is a placeholder — actual transcript capture would integrate with LiveKit API
    const turnResult: QATurnResult = {
      turn_number: turn.turn,
      source_text: turn.script_text,
      translated_text: "", // Filled by QA operator via evaluator-sheet
      expected_translation: turn.expected_translation,
      latency_ms: null,
      eval_point: turn.eval_point,
    };
    turnResults.push(turnResult);
  }

  return {
    run_id: runId,
    scenario_id: fixture.scenario_id,
    scenario: fixture.scenario,
    source_lang: fixture.source_lang,
    target_lang: fixture.target_lang,
    room_name: roomName,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    turn_results: turnResults,
    error: null,
  };
}

// ─── Runner dispatcher ───────────────────────────────────────────────────────

export async function runScenario(
  fixture: ScenarioFixture,
  config: RunnerConfig
): Promise<QARunResult> {
  if (config.mockMode) {
    return runScenarioMock(fixture, config);
  }
  return runScenarioLive(fixture, config);
}

// ─── DB persistence ──────────────────────────────────────────────────────────

export async function saveRunResults(
  results: QARunResult[],
  config: RunnerConfig
): Promise<void> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.warn(
      "[runner] Supabase config not set, skipping DB persistence"
    );
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey
  );

  for (const result of results) {
    for (const turn of result.turn_results) {
      const record = {
        run_id: result.run_id,
        scenario_id: result.scenario_id,
        source_lang: result.source_lang,
        target_lang: result.target_lang,
        translated_text: turn.translated_text,
        score: null,
        passed: null,
        evaluator_id: null,
        notes: turn.eval_point ?? null,
      };

      const { error } = await supabase
        .from("quality_qa_results")
        .insert(record);

      if (error) {
        console.error(
          `[runner] Failed to save turn ${turn.turn_number} of ${result.scenario_id}:`,
          error.message
        );
      }
    }
  }

  console.log(
    `[runner] Saved ${results.length} run results to quality_qa_results`
  );
}
