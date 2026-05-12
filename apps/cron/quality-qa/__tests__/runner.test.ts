/**
 * runner.test.ts
 *
 * Mock LiveKit/OpenAI で runner の smoke test を実行する。
 *
 * - loadRunnerConfig: mock モードの設定確認
 * - runScenarioMock: fixture を mock 実行してQARunResult を返す
 * - saveRunResults: Supabase 未設定時はスキップ (警告のみ)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  loadRunnerConfig,
  runScenarioMock,
  saveRunResults,
} from "../runner.js";
import type { ScenarioFixture } from "../schemas.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockFixture: ScenarioFixture = {
  scenario_id: "TC-S1-en-test",
  scenario: "S1",
  name: "Test Daily Conversation",
  source_lang: "ja",
  target_lang: "en",
  context: "Test context",
  audio_url: null,
  expected_keywords: ["nice to meet you", "photography"],
  turns: [
    {
      turn: 1,
      speaker: "A",
      script_text: "はじめまして、田中と申します。",
      expected_translation: "Nice to meet you. My name is Tanaka.",
      eval_point: "謙譲表現の自然な英語化",
    },
    {
      turn: 2,
      speaker: "B",
      script_text: "Hello! I'm John from Seattle.",
      expected_translation: "こんにちは！シアトルのジョンです。",
      eval_point: "固有名詞の保持",
    },
  ],
};

const mockS5Fixture: ScenarioFixture = {
  scenario_id: "TC-S5-en-test",
  scenario: "S5",
  name: "Test Code-Switching",
  source_lang: "ja",
  target_lang: "en",
  context: "Test code-switching",
  audio_url: null,
  ambient_passthrough_check: true,
  expected_keywords: ["Thank you for your patience"],
  turns: [
    {
      turn: 1,
      speaker: "A",
      script_text: "今日はありがとうございます。",
      expected_translation: "Thank you for today.",
      eval_point: "通常翻訳",
    },
    {
      turn: 2,
      speaker: "A",
      script_text: 'まず "Thank you for your patience" とお伝えします。',
      expected_translation: "First, I'd like to say 'Thank you for your patience'.",
      eval_point: "英語フレーズ混入・ambient passthrough 確認",
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadRunnerConfig", () => {
  beforeEach(() => {
    delete process.env["LIVEKIT_URL"];
    delete process.env["LIVEKIT_API_KEY"];
    delete process.env["LIVEKIT_API_SECRET"];
    delete process.env["QA_MOCK"];
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  });

  it("should return mockMode=true when LIVEKIT_URL is not set", () => {
    const config = loadRunnerConfig();
    expect(config.mockMode).toBe(true);
    expect(config.livekitUrl).toBeNull();
  });

  it("should return mockMode=true when QA_MOCK=true", () => {
    process.env["QA_MOCK"] = "true";
    process.env["LIVEKIT_URL"] = "wss://example.livekit.cloud";
    process.env["LIVEKIT_API_KEY"] = "test-key";
    process.env["LIVEKIT_API_SECRET"] = "test-secret";
    const config = loadRunnerConfig();
    expect(config.mockMode).toBe(true);
  });

  it("should return mockMode=false when all LiveKit env vars are set and QA_MOCK is not true", () => {
    process.env["LIVEKIT_URL"] = "wss://example.livekit.cloud";
    process.env["LIVEKIT_API_KEY"] = "test-key";
    process.env["LIVEKIT_API_SECRET"] = "test-secret";
    const config = loadRunnerConfig();
    expect(config.mockMode).toBe(false);
    expect(config.livekitUrl).toBe("wss://example.livekit.cloud");
  });
});

describe("runScenarioMock", () => {
  const mockConfig = {
    livekitUrl: null,
    livekitApiKey: null,
    livekitApiSecret: null,
    supabaseUrl: null,
    supabaseServiceRoleKey: null,
    mockMode: true,
  };

  it("should return QARunResult with correct structure", async () => {
    const result = await runScenarioMock(mockFixture, mockConfig);
    expect(result.run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.scenario_id).toBe("TC-S1-en-test");
    expect(result.scenario).toBe("S1");
    expect(result.source_lang).toBe("ja");
    expect(result.target_lang).toBe("en");
    expect(result.error).toBeNull();
  });

  it("should return turn results matching fixture turns count", async () => {
    const result = await runScenarioMock(mockFixture, mockConfig);
    expect(result.turn_results.length).toBe(mockFixture.turns.length);
  });

  it("should use expected_translation as translated_text in mock mode", async () => {
    const result = await runScenarioMock(mockFixture, mockConfig);
    for (let i = 0; i < result.turn_results.length; i++) {
      const turnResult = result.turn_results[i];
      const fixtureTurn = mockFixture.turns[i];
      expect(turnResult?.translated_text).toBe(
        fixtureTurn?.expected_translation
      );
    }
  });

  it("should assign mock latency values", async () => {
    const result = await runScenarioMock(mockFixture, mockConfig);
    for (const turnResult of result.turn_results) {
      expect(turnResult.latency_ms).toBeGreaterThanOrEqual(500);
      expect(turnResult.latency_ms).toBeLessThanOrEqual(2500);
    }
  });

  it("should handle S5 ambient_passthrough_check fixture correctly", async () => {
    const result = await runScenarioMock(mockS5Fixture, mockConfig);
    expect(result.scenario).toBe("S5");
    expect(result.turn_results.length).toBe(2);
    // ambient_passthrough_check は fixture レベルのフラグ (turn result には直接影響しない)
    expect(result.error).toBeNull();
  });

  it("should set started_at and completed_at as ISO strings", async () => {
    const result = await runScenarioMock(mockFixture, mockConfig);
    expect(result.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("saveRunResults", () => {
  it("should skip persistence and log warning when Supabase config is not set", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mockConfig = {
      livekitUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      supabaseUrl: null,
      supabaseServiceRoleKey: null,
      mockMode: true,
    };

    const mockResult = await runScenarioMock(mockFixture, mockConfig);
    await saveRunResults([mockResult], mockConfig);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Supabase config not set")
    );
    consoleSpy.mockRestore();
  });
});

describe("runner integration: mock run of all Phase 1a priority scenarios", () => {
  const mockConfig = {
    livekitUrl: null,
    livekitApiKey: null,
    livekitApiSecret: null,
    supabaseUrl: null,
    supabaseServiceRoleKey: null,
    mockMode: true,
  };

  const priorityFixtures: ScenarioFixture[] = ["S1", "S2", "S3", "S4", "S5"].map(
    (s) => ({
      scenario_id: `TC-${s}-en`,
      scenario: s as "S1" | "S2" | "S3" | "S4" | "S5",
      name: `Test ${s}`,
      source_lang: "ja" as const,
      target_lang: "en" as const,
      audio_url: null,
      ambient_passthrough_check: s === "S5",
      turns: Array.from({ length: 10 }, (_, i) => ({
        turn: i + 1,
        speaker: (i % 2 === 0 ? "A" : "B") as "A" | "B",
        script_text: `Turn ${i + 1} source text`,
        expected_translation: `Turn ${i + 1} expected translation`,
        eval_point: `Turn ${i + 1} eval point`,
      })),
    })
  );

  it("should complete mock runs for all 5 scenarios", async () => {
    const results = await Promise.all(
      priorityFixtures.map((f) => runScenarioMock(f, mockConfig))
    );
    expect(results.length).toBe(5);
    for (const result of results) {
      expect(result.turn_results.length).toBe(10);
      expect(result.error).toBeNull();
    }
  });
});
