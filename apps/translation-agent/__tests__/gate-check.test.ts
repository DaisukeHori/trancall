/**
 * gate-check.ts テスト (T-31)
 *
 * 対象:
 *   1. 判定ロジック単体テスト (determineVerdict)
 *   2. 百分位計算ユーティリティ (percentile)
 *   3. dry-run の Markdown 出力フォーマット検証 (buildMarkdownReport)
 *   4. dry-run 結果生成 (generateDryRunResults) の形式検証
 *
 * production-runbook.md §15.5 の閾値:
 *   PASS             : p95 < 3000ms かつ pass_count >= 99
 *   CONDITIONAL_PASS : p95 < 3500ms かつ pass_count >= 95
 *   FAIL             : 上記いずれも満たさない
 */

import { describe, expect, it } from "vitest";

import {
  buildMarkdownReport,
  determineVerdict,
  generateDryRunResults,
  percentile,
} from "../scripts/gate-check.js";

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

describe("percentile", () => {
  it("空配列では 0 を返す", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("要素 1 つは全分位で同じ値を返す", () => {
    expect(percentile([500], 0.5)).toBe(500);
    expect(percentile([500], 0.95)).toBe(500);
    expect(percentile([500], 0)).toBe(500);
    expect(percentile([500], 1)).toBe(500);
  });

  it("均等な 4 要素の p50 は中央値の線形補間", () => {
    // [100, 200, 300, 400] → p50 = index 1.5 → 200 + 0.5*(300-200) = 250
    expect(percentile([100, 200, 300, 400], 0.5)).toBe(250);
  });

  it("p0 は最小値、p1 は最大値", () => {
    const arr = [10, 20, 30, 40, 50];
    expect(percentile(arr, 0)).toBe(10);
    expect(percentile(arr, 1)).toBe(50);
  });

  it("100 要素の p95 は 95 番目周辺の線形補間", () => {
    // 1〜100 の昇順配列
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    // p95: index = 0.95 * 99 = 94.05 → arr[94] + 0.05 * (arr[95] - arr[94]) = 95 + 0.05 * 1 = 95.05
    const result = percentile(arr, 0.95);
    expect(result).toBeCloseTo(95.05, 5);
  });
});

// ---------------------------------------------------------------------------
// determineVerdict
// ---------------------------------------------------------------------------

describe("determineVerdict", () => {
  const scenarioCount = 100;

  describe("PASS 判定", () => {
    it("p95 < 3000ms かつ pass_count >= 99 で PASS", () => {
      const { verdict } = determineVerdict(2999, 99, scenarioCount);
      expect(verdict).toBe("PASS");
    });

    it("p95 が 2000ms かつ pass_count が 100 で PASS", () => {
      const { verdict } = determineVerdict(2000, 100, scenarioCount);
      expect(verdict).toBe("PASS");
    });

    it("PASS の理由文字列に p95 と pass_count が含まれる", () => {
      const { reason } = determineVerdict(2500, 99, scenarioCount);
      expect(reason).toContain("2500.0ms");
      expect(reason).toContain("99");
    });
  });

  describe("CONDITIONAL_PASS 判定", () => {
    it("p95 < 3500ms かつ pass_count >= 95 で CONDITIONAL_PASS", () => {
      const { verdict } = determineVerdict(3200, 96, scenarioCount);
      expect(verdict).toBe("CONDITIONAL_PASS");
    });

    it("p95 = 3000ms かつ pass_count = 95 で CONDITIONAL_PASS (p95 >= 3000 なので PASS 未達)", () => {
      // p95 < 3000 は PASS 条件、p95 = 3000 は PASS 未達
      const { verdict } = determineVerdict(3000, 99, scenarioCount);
      expect(verdict).toBe("CONDITIONAL_PASS");
    });

    it("p95 = 3499ms かつ pass_count = 95 で CONDITIONAL_PASS", () => {
      const { verdict } = determineVerdict(3499, 95, scenarioCount);
      expect(verdict).toBe("CONDITIONAL_PASS");
    });

    it("CONDITIONAL_PASS の理由文字列に PASS 未達と記載される", () => {
      const { reason } = determineVerdict(3200, 96, scenarioCount);
      expect(reason).toContain("PASS 未達");
    });
  });

  describe("FAIL 判定", () => {
    it("p95 >= 3500ms で FAIL", () => {
      const { verdict } = determineVerdict(3500, 99, scenarioCount);
      expect(verdict).toBe("FAIL");
    });

    it("pass_count < 95 で FAIL", () => {
      const { verdict } = determineVerdict(2000, 94, scenarioCount);
      expect(verdict).toBe("FAIL");
    });

    it("p95 >= 3500ms かつ pass_count < 95 の両条件違反は FAIL", () => {
      const { verdict, reason } = determineVerdict(4000, 80, scenarioCount);
      expect(verdict).toBe("FAIL");
      expect(reason).toContain("4000.0ms");
      expect(reason).toContain("80");
    });

    it("FAIL 理由に閾値超過の詳細が含まれる", () => {
      const { reason } = determineVerdict(3600, 99, scenarioCount);
      expect(reason).toContain("閾値超過");
    });
  });

  describe("境界値テスト", () => {
    it("p95 = 2999ms かつ pass_count = 99 は PASS", () => {
      expect(determineVerdict(2999, 99, scenarioCount).verdict).toBe("PASS");
    });

    it("p95 = 3000ms かつ pass_count = 99 は CONDITIONAL_PASS (p95 < 3000 の PASS 条件を満たさない)", () => {
      expect(determineVerdict(3000, 99, scenarioCount).verdict).toBe("CONDITIONAL_PASS");
    });

    it("p95 = 3499ms かつ pass_count = 94 は FAIL (pass_count < 95)", () => {
      expect(determineVerdict(3499, 94, scenarioCount).verdict).toBe("FAIL");
    });

    it("p95 = 3500ms は FAIL (p95 < 3500 の CONDITIONAL_PASS 条件を満たさない)", () => {
      expect(determineVerdict(3500, 95, scenarioCount).verdict).toBe("FAIL");
    });
  });
});

// ---------------------------------------------------------------------------
// generateDryRunResults
// ---------------------------------------------------------------------------

describe("generateDryRunResults", () => {
  it("指定した scenarioCount の数だけ結果を生成する", () => {
    const results = generateDryRunResults(100, 30);
    expect(results).toHaveLength(100);
  });

  it("scenarioIndex は 0 から連番", () => {
    const results = generateDryRunResults(10, 30);
    results.forEach((r, i) => {
      expect(r.scenarioIndex).toBe(i);
    });
  });

  it("scenarioType は 4 種類の範囲内", () => {
    const validTypes = new Set(["ja-en", "en-ja", "ja-zh", "en-zh"]);
    const results = generateDryRunResults(20, 30);
    results.forEach((r) => {
      expect(validTypes.has(r.scenarioType)).toBe(true);
    });
  });

  it("大半のシナリオで crashed も hung も false", () => {
    const results = generateDryRunResults(100, 30);
    const failCount = results.filter((r) => r.crashed || r.hung).length;
    // 95% 以上は成功 (mock の失敗率 5%)
    expect(failCount).toBeLessThanOrEqual(10);
  });

  it("durationMs は scenarioDurationSec * 1000 以上", () => {
    const results = generateDryRunResults(20, 30);
    results.forEach((r) => {
      expect(r.durationMs).toBeGreaterThanOrEqual(30 * 1000);
    });
  });

  it("memoryMbPeak は 0 より大きく 512 未満", () => {
    const results = generateDryRunResults(50, 30);
    results.forEach((r) => {
      expect(r.memoryMbPeak).toBeGreaterThan(0);
      expect(r.memoryMbPeak).toBeLessThan(512);
    });
  });

  it("同一 scenarioCount で再実行すると同じ結果 (再現性)", () => {
    const r1 = generateDryRunResults(10, 30);
    const r2 = generateDryRunResults(10, 30);
    expect(r1.map((r) => r.latencyMs)).toEqual(r2.map((r) => r.latencyMs));
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownReport — フォーマット検証
// ---------------------------------------------------------------------------

describe("buildMarkdownReport", () => {
  /** dry-run 用のサマリデータを生成するヘルパー */
  function makeSummary(
    overrides: Partial<Parameters<typeof buildMarkdownReport>[0]> = {},
  ): Parameters<typeof buildMarkdownReport>[0] {
    const results = generateDryRunResults(100, 30);
    const allLatencies = results
      .map((r) => r.latencyMs)
      .filter((l): l is number => l !== null)
      .sort((a, b) => a - b);

    const p50Ms = percentile(allLatencies, 0.5);
    const p95Ms = percentile(allLatencies, 0.95);
    const p99Ms = percentile(allLatencies, 0.99);
    const passCount = results.filter((r) => !r.crashed && !r.hung).length;
    const { verdict, reason } = determineVerdict(p95Ms, passCount, results.length);

    return {
      runId: "test-run-id-00000000",
      startedAt: new Date("2026-05-12T10:00:00Z"),
      endedAt: new Date("2026-05-12T12:00:00Z"),
      scenarioCount: 100,
      passCount,
      p50Ms,
      p95Ms,
      p99Ms,
      memoryMbMax: 280,
      crashRate: 0.02,
      verdict,
      verdictReason: reason,
      dryRun: true,
      results,
      ...overrides,
    };
  }

  it("## Gate Check 結果 ヘッダが含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("## Gate Check 結果");
  });

  it("dry-run モードの注意書きが含まれる", () => {
    const md = buildMarkdownReport(makeSummary({ dryRun: true }));
    expect(md).toContain("dry-run");
    expect(md).toContain("mock 結果");
  });

  it("dry-run=false の場合は dry-run 注意書きがない", () => {
    const md = buildMarkdownReport(makeSummary({ dryRun: false }));
    expect(md).not.toContain("**注意**: これは");
  });

  it("Run ID が含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("test-run-id-00000000");
  });

  it("シナリオ数 100 が含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("100 件");
  });

  it("シナリオ別テーブルに ja-en と en-ja が含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("ja-en");
    expect(md).toContain("en-ja");
  });

  it("全体集計テーブルに p50 / p95 / p99 の行が含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("p50 latency");
    expect(md).toContain("p95 latency");
    expect(md).toContain("p99 latency");
  });

  it("PASS 判定時は PASS にチェックが入り FAIL にはチェックが入らない", () => {
    const passSummary = makeSummary({ verdict: "PASS", verdictReason: "p95=2000.0ms (<3000ms) かつ pass_count=99 (>=99)" });
    const md = buildMarkdownReport(passSummary);
    expect(md).toContain("- [x] PASS");
    expect(md).toContain("- [ ] FAIL");
  });

  it("FAIL 判定時は FAIL にチェックが入り PASS にはチェックが入らない", () => {
    const failSummary = makeSummary({ verdict: "FAIL", verdictReason: "p95=4000.0ms (>=3500ms 閾値超過)" });
    const md = buildMarkdownReport(failSummary);
    expect(md).toContain("- [ ] PASS");
    expect(md).toContain("- [x] FAIL");
    expect(md).toContain("閾値超過");
  });

  it("CONDITIONAL_PASS 判定時は CONDITIONAL_PASS にチェックが入る", () => {
    const condSummary = makeSummary({ verdict: "CONDITIONAL_PASS", verdictReason: "p95=3200.0ms (<3500ms) かつ pass_count=96 (>=95) — PASS 未達" });
    const md = buildMarkdownReport(condSummary);
    expect(md).toContain("- [x] CONDITIONAL_PASS");
  });

  it("production-runbook.md §15 への参照が含まれる", () => {
    const md = buildMarkdownReport(makeSummary());
    expect(md).toContain("production-runbook.md");
    expect(md).toContain("§15");
  });

  it("メモリ最大値が含まれる", () => {
    const md = buildMarkdownReport(makeSummary({ memoryMbMax: 280 }));
    expect(md).toContain("280");
  });
});
