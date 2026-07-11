/**
 * matrix.test.ts
 *
 * M-12: 合否判定マトリクス自動生成ロジックのユニットテスト。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { CSV_HEADERS, rowToCsvLine } from "../evaluator-sheet.js";
import {
  CANONICAL_LANG_PAIRS,
  PHASE_1A_PRIORITY_LANG_PAIRS,
  aggregateMatrix,
  buildMatrixMarkdown,
  extractScenarioKey,
  findCoverageGaps,
  generateMatrixReport,
  judge,
  langPairKey,
  summarizeLangPair,
} from "../matrix.js";
import type { EvaluatorSheetRow } from "../schemas.js";

// ─── extractScenarioKey ────────────────────────────────────────────────────────

describe("extractScenarioKey", () => {
  it("should extract S1-S5 from ja-source scenario_id (e.g. TC-S2-en)", () => {
    expect(extractScenarioKey("TC-S2-en")).toBe("S2");
  });

  it("should extract S1-S5 from source-target scenario_id (e.g. TC-S2-zh-ja)", () => {
    expect(extractScenarioKey("TC-S2-zh-ja")).toBe("S2");
  });

  it("should extract S1-S5 from en-ja scenario_id (L-14 fixed form)", () => {
    expect(extractScenarioKey("TC-S5-en-ja")).toBe("S5");
  });

  it("should return null for an unrecognized id", () => {
    expect(extractScenarioKey("no-scenario-number")).toBeNull();
  });
});

// ─── judge (§9.3 判定凡例) ──────────────────────────────────────────────────────

describe("judge", () => {
  it("should return '-' when avgScore is null (未実施)", () => {
    expect(judge(null, false)).toBe("-");
  });

  it("should return PASS when avgScore >= 3.5 and no safety fail", () => {
    expect(judge(3.5, false)).toBe("PASS");
    expect(judge(4.3, false)).toBe("PASS");
  });

  it("should return CPASS when avgScore is in [3.0, 3.5)", () => {
    expect(judge(3.0, false)).toBe("CPASS");
    expect(judge(3.49, false)).toBe("CPASS");
  });

  it("should return FAIL when avgScore < 3.0", () => {
    expect(judge(2.9, false)).toBe("FAIL");
  });

  it("should return FAIL when hasSafetyFail=true regardless of avgScore", () => {
    expect(judge(4.8, true)).toBe("FAIL");
  });
});

// ─── aggregateMatrix / summarizeLangPair ────────────────────────────────────────

function row(overrides: Partial<EvaluatorSheetRow>): EvaluatorSheetRow {
  return {
    scenario_id: "TC-S1-en",
    source_lang: "ja",
    target_lang: "en",
    turn_number: 1,
    source_text: "src",
    translated_text: "tgt",
    expected_keywords: "",
    pass_fail: "PASS",
    evaluator_note: "",
    score_a: 4,
    score_f: 4,
    score_c: 4,
    score_l: 4,
    score_s: 5,
    weighted_score: 4.0,
    ...overrides,
  };
}

describe("aggregateMatrix + summarizeLangPair", () => {
  it("should average weighted_score per (langPair, scenario)", () => {
    const rows: EvaluatorSheetRow[] = [
      row({ scenario_id: "TC-S1-en", weighted_score: 4.0 }),
      row({ scenario_id: "TC-S1-en", turn_number: 2, weighted_score: 5.0 }),
    ];
    const matrix = aggregateMatrix(rows);
    const cell = matrix.get(langPairKey("ja", "en"))?.get("S1");
    expect(cell?.avgScore).toBeCloseTo(4.5);
    expect(cell?.scoredTurnCount).toBe(2);
    expect(cell?.hasSafetyFail).toBe(false);
  });

  it("should flag hasSafetyFail when any turn has score_s === 1", () => {
    const rows: EvaluatorSheetRow[] = [
      row({ scenario_id: "TC-S1-en", score_s: 1, weighted_score: 4.5 }),
    ];
    const matrix = aggregateMatrix(rows);
    const cell = matrix.get(langPairKey("ja", "en"))?.get("S1");
    expect(cell?.hasSafetyFail).toBe(true);
  });

  it("should ignore rows with weighted_score null when averaging (PENDING rows)", () => {
    const rows: EvaluatorSheetRow[] = [
      row({ scenario_id: "TC-S1-en", weighted_score: null, pass_fail: "PENDING" }),
    ];
    const matrix = aggregateMatrix(rows);
    const cell = matrix.get(langPairKey("ja", "en"))?.get("S1");
    expect(cell?.avgScore).toBeNull();
    expect(cell?.scoredTurnCount).toBe(0);
  });

  it("summarizeLangPair should only compute overall avg when all 5 scenarios are scored", () => {
    const rows: EvaluatorSheetRow[] = ["S1", "S2", "S3", "S4"].map((s) =>
      row({ scenario_id: `TC-${s}-en`, weighted_score: 4.0 })
    );
    const matrix = aggregateMatrix(rows);
    const summary = summarizeLangPair(langPairKey("ja", "en"), matrix);
    // S5 未採点なので overallAvg は null、判定は "-"
    expect(summary.overallAvg).toBeNull();
    expect(summary.judgement).toBe("-");
  });

  it("summarizeLangPair should compute PASS when all 5 scenarios average >= 3.5", () => {
    const rows: EvaluatorSheetRow[] = ["S1", "S2", "S3", "S4", "S5"].map((s) =>
      row({ scenario_id: `TC-${s}-en`, weighted_score: 4.0 })
    );
    const matrix = aggregateMatrix(rows);
    const summary = summarizeLangPair(langPairKey("ja", "en"), matrix);
    expect(summary.overallAvg).toBeCloseTo(4.0);
    expect(summary.judgement).toBe("PASS");
  });

  it("should ignore scenario_id without a recognizable S1-S5 number", () => {
    const rows: EvaluatorSheetRow[] = [row({ scenario_id: "not-a-scenario" })];
    const matrix = aggregateMatrix(rows);
    expect(matrix.size).toBe(0);
  });
});

// ─── buildMatrixMarkdown ────────────────────────────────────────────────────────

describe("buildMatrixMarkdown", () => {
  it("should render a row per lang pair with '-.-' for unscored cells", () => {
    const matrix = aggregateMatrix([]);
    const md = buildMatrixMarkdown(PHASE_1A_PRIORITY_LANG_PAIRS, matrix);
    expect(md).toContain("ja-en");
    expect(md).toContain("en-ja");
    expect(md).toContain("-.-");
  });

  it("should include all canonical 14 lang pairs when requested", () => {
    const matrix = aggregateMatrix([]);
    const md = buildMatrixMarkdown(CANONICAL_LANG_PAIRS, matrix);
    for (const pair of CANONICAL_LANG_PAIRS) {
      expect(md).toContain(pair);
    }
  });
});

// ─── findCoverageGaps ───────────────────────────────────────────────────────────

describe("findCoverageGaps", () => {
  it("should report all cells as not_run when matrix is empty", () => {
    const matrix = aggregateMatrix([]);
    const gaps = findCoverageGaps(PHASE_1A_PRIORITY_LANG_PAIRS, matrix);
    expect(gaps.length).toBe(PHASE_1A_PRIORITY_LANG_PAIRS.length * 5);
    expect(gaps.every((g) => g.reason === "not_run")).toBe(true);
  });

  it("should report no gaps once all scenarios for a pair are scored", () => {
    const rows: EvaluatorSheetRow[] = ["S1", "S2", "S3", "S4", "S5"].map((s) =>
      row({ scenario_id: `TC-${s}-en`, weighted_score: 4.0 })
    );
    const matrix = aggregateMatrix(rows);
    const gaps = findCoverageGaps(["ja-en"], matrix);
    expect(gaps).toEqual([]);
  });
});

// ─── generateMatrixReport (CSV round-trip + ファイル出力) ───────────────────────

describe("generateMatrixReport", () => {
  it("should round-trip evaluator CSV -> markdown report and write the gaps section", () => {
    const rows: EvaluatorSheetRow[] = ["S1", "S2", "S3", "S4", "S5"].map((s) =>
      row({ scenario_id: `TC-${s}-en`, weighted_score: 4.2 })
    );

    const tmpDir = mkdtempSync(join(tmpdir(), "qa-matrix-test-"));
    try {
      // writeResultsToCsv は非同期ストリーム書き込みのため、テストでは
      // CSV_HEADERS/rowToCsvLine を直接使って同期的に CSV 文字列を組み立てる
      // (ファイル書き込み完了を待たずに読み戻すレースを避ける)。
      const csvContent = [
        CSV_HEADERS.join(","),
        ...rows.map(rowToCsvLine),
      ].join("\n");
      const csvPath = join(tmpDir, "evaluator.csv");

      const outputPath = generateMatrixReport(csvContent, {
        evaluatorCsvPath: csvPath,
        outputDir: tmpDir,
        runDate: "2026-07-11",
      });

      const report = readFileSync(outputPath, "utf-8");
      expect(report).toContain("Phase 1a 主要 4 ペア");
      expect(report).toContain("全 14 言語ペア");
      expect(report).toContain("ja-en");
      // ja-en は全 5 シナリオ採点済みなので PASS 判定が含まれる
      expect(report).toContain("PASS");
      // en-ja 等、他ペアは未実施なので未実施セクションに列挙される
      expect(report).toContain("未実施");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
