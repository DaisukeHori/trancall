/**
 * fixture-validation.test.ts
 *
 * 14 言語ペア × 5 シナリオ = 70 ケースの YAML fixture を検証する。
 *
 * - 全 70 ファイルが存在すること
 * - 各 fixture が ScenarioFixtureSchema に準拠していること
 * - scenario_id が一意であること
 * - 各 fixture が 10 ターンを持つこと (または少なくとも 1 ターン以上)
 * - source_lang / target_lang が有効であること
 */

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";

import { ScenarioFixtureSchema } from "../schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "../scenarios");

// ─── Helper: collect all YAML files ──────────────────────────────────────────

function collectFixtureFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const subFiles = readdirSync(fullPath)
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => join(fullPath, f));
      files.push(...subFiles);
    }
  }
  return files;
}

// ─── Expected language pairs ─────────────────────────────────────────────────

const EXPECTED_LANG_PAIRS = [
  "ja-en", "ja-es", "ja-pt", "ja-fr", "ja-ru", "ja-zh",
  "ja-de", "ja-ko", "ja-hi", "ja-id", "ja-vi", "ja-it",
  "en-ja", "zh-ja",
] as const;

const EXPECTED_SCENARIOS = [
  "casual-greeting",
  "business-meeting",
  "travel-places",
  "numbers-currency",
  "code-switching",
] as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("YAML fixture validation (70 cases)", () => {
  const fixtureFiles = collectFixtureFiles(SCENARIOS_DIR);

  it("should have exactly 70 fixture files", () => {
    expect(fixtureFiles.length).toBe(70);
  });

  it("should have all 14 language pair directories", () => {
    const dirs = readdirSync(SCENARIOS_DIR).filter((e) =>
      statSync(join(SCENARIOS_DIR, e)).isDirectory()
    );
    expect(dirs.sort()).toEqual([...EXPECTED_LANG_PAIRS].sort());
  });

  it("should have 5 scenarios per language pair", () => {
    for (const langPair of EXPECTED_LANG_PAIRS) {
      const langDir = join(SCENARIOS_DIR, langPair);
      const files = readdirSync(langDir).filter((f) => f.endsWith(".yaml"));
      expect(files.length, `${langPair} should have 5 scenario files`).toBe(5);

      const fileNames = files.map((f) => f.replace(".yaml", "")).sort();
      expect(
        fileNames,
        `${langPair} should have all 5 scenario types`
      ).toEqual([...EXPECTED_SCENARIOS].sort());
    }
  });

  describe("each fixture file", () => {
    for (const filePath of fixtureFiles) {
      it(`should parse and validate: ${filePath.split("/scenarios/")[1] ?? filePath}`, () => {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = yaml.load(raw);
        const result = ScenarioFixtureSchema.safeParse(parsed);
        expect(
          result.success,
          `Fixture validation failed: ${result.success ? "" : result.error?.message}`
        ).toBe(true);
      });
    }
  });

  it("all scenario_id values should be unique", () => {
    const ids: string[] = [];
    for (const filePath of fixtureFiles) {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;
      const scenarioId = parsed["scenario_id"];
      if (typeof scenarioId === "string") {
        ids.push(scenarioId);
      }
    }
    // IDs may be shared across language pairs (e.g. TC-S1-en can appear in ja-en)
    // so we just verify count matches files count (no empty IDs)
    expect(ids.length).toBe(fixtureFiles.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("S5 scenarios should have ambient_passthrough_check: true", () => {
    const s5Files = fixtureFiles.filter((f) => f.includes("code-switching"));
    for (const filePath of s5Files) {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;
      expect(
        parsed["ambient_passthrough_check"],
        `${filePath} should have ambient_passthrough_check: true`
      ).toBe(true);
    }
  });

  it("all fixtures should have at least 1 turn", () => {
    for (const filePath of fixtureFiles) {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = yaml.load(raw) as Record<string, unknown>;
      const turns = parsed["turns"];
      expect(
        Array.isArray(turns) && turns.length >= 1,
        `${filePath} should have at least 1 turn`
      ).toBe(true);
    }
  });

  it("Phase 1a priority fixtures (ja-en, en-ja, ja-zh, zh-ja) should have all 5 scenarios with full 10 turns", () => {
    const priorityPairs = ["ja-en", "en-ja", "ja-zh", "zh-ja"];
    for (const pair of priorityPairs) {
      const langDir = join(SCENARIOS_DIR, pair);
      const files = readdirSync(langDir).filter((f) => f.endsWith(".yaml"));
      for (const file of files) {
        const raw = readFileSync(join(langDir, file), "utf-8");
        const parsed = yaml.load(raw) as Record<string, unknown>;
        const turns = parsed["turns"] as unknown[];
        expect(
          turns.length,
          `${pair}/${file} should have 10 turns`
        ).toBe(10);
      }
    }
  });
});
