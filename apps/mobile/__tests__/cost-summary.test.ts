/**
 * CostSummary コンポーネント ロジックテスト (T-18)
 *
 * docs/billing-ui-flow.md §10.3 準拠
 *
 * テスト対象:
 * - durationSeconds → mm:ss フォーマット
 * - 金額 → ¥1,234 フォーマット
 * - 超過あり/なしの分岐ロジック
 * - CallSummaryParams → CostSummary props 変換ロジック
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// ロジック関数 (CostSummary.tsx から抜粋してテスト)
// ---------------------------------------------------------------------------

/** 秒数を mm:ss 形式にフォーマット */
function formatDurationSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** 金額を ¥1,234 形式にフォーマット */
function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** CallSummaryParams から CostSummary 用 props を導出 */
function resolveCostSummaryProps(params: {
  callDurationMs: number;
  costYen: number;
  baseCostYen?: number;
  overageCostYen?: number;
}) {
  const durationSeconds = Math.floor(params.callDurationMs / 1000);
  const resolvedBaseCostYen = params.baseCostYen ?? 0;
  const resolvedOverageCostYen = params.overageCostYen ?? 0;
  const hasOverage = resolvedOverageCostYen > 0;
  return {
    durationSeconds,
    baseCostYen: resolvedBaseCostYen,
    overageCostYen: resolvedOverageCostYen > 0 ? resolvedOverageCostYen : undefined,
    totalCostYen: params.costYen,
    hasOverage,
    showUpgradeSuggestion: hasOverage,
  };
}

// ---------------------------------------------------------------------------
// formatDurationSeconds
// ---------------------------------------------------------------------------

describe("formatDurationSeconds", () => {
  it("正常系: 0秒 → 00:00", () => {
    expect(formatDurationSeconds(0)).toBe("00:00");
  });

  it("正常系: 30秒 → 00:30", () => {
    expect(formatDurationSeconds(30)).toBe("00:30");
  });

  it("正常系: 60秒 → 01:00", () => {
    expect(formatDurationSeconds(60)).toBe("01:00");
  });

  it("正常系: 90秒 → 01:30", () => {
    expect(formatDurationSeconds(90)).toBe("01:30");
  });

  it("正常系: 3661秒 → 61:01", () => {
    // 61分1秒
    expect(formatDurationSeconds(3661)).toBe("61:01");
  });

  it("正常系: 599秒 → 09:59", () => {
    expect(formatDurationSeconds(599)).toBe("09:59");
  });

  it("正常系: 600秒 → 10:00", () => {
    expect(formatDurationSeconds(600)).toBe("10:00");
  });

  it("正常系: 1秒 → 00:01", () => {
    expect(formatDurationSeconds(1)).toBe("00:01");
  });
});

// ---------------------------------------------------------------------------
// formatYen
// ---------------------------------------------------------------------------

describe("formatYen", () => {
  it("正常系: 0円 → ¥0", () => {
    expect(formatYen(0)).toBe("¥0");
  });

  it("正常系: 100円 → ¥100", () => {
    expect(formatYen(100)).toBe("¥100");
  });

  it("正常系: 1234円 → ¥1,234 (カンマ区切り)", () => {
    expect(formatYen(1234)).toBe("¥1,234");
  });

  it("正常系: 10000円 → ¥10,000", () => {
    expect(formatYen(10000)).toBe("¥10,000");
  });

  it("正常系: 1234567円 → ¥1,234,567", () => {
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });
});

// ---------------------------------------------------------------------------
// resolveCostSummaryProps (CallSummaryParams → CostSummary props 変換)
// ---------------------------------------------------------------------------

describe("resolveCostSummaryProps", () => {
  describe("超過なし (含有分内)", () => {
    it("正常系: baseCostYen/overageCostYen 未指定 → 超過なし", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 300_000, // 5分
        costYen: 0,
      });

      expect(result.baseCostYen).toBe(0);
      expect(result.overageCostYen).toBeUndefined();
      expect(result.hasOverage).toBe(false);
      expect(result.showUpgradeSuggestion).toBe(false);
    });

    it("正常系: baseCostYen=0, overageCostYen=0 → 超過なし", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 120_000,
        costYen: 0,
        baseCostYen: 0,
        overageCostYen: 0,
      });

      expect(result.baseCostYen).toBe(0);
      expect(result.overageCostYen).toBeUndefined();
      expect(result.hasOverage).toBe(false);
    });

    it("正常系: durationSeconds が ms から正しく変換される", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 90_500, // 90.5秒 → 90秒 (切り捨て)
        costYen: 0,
      });

      expect(result.durationSeconds).toBe(90);
    });
  });

  describe("超過あり", () => {
    it("正常系: overageCostYen > 0 → 超過あり", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 1_800_000, // 30分
        costYen: 500,
        baseCostYen: 0,
        overageCostYen: 500,
      });

      expect(result.overageCostYen).toBe(500);
      expect(result.hasOverage).toBe(true);
      expect(result.showUpgradeSuggestion).toBe(true);
    });

    it("正常系: 超過あり → overageCostYen が props に渡される", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 600_000, // 10分
        costYen: 1200,
        baseCostYen: 0,
        overageCostYen: 1200,
      });

      expect(result.overageCostYen).toBe(1200);
      expect(result.totalCostYen).toBe(1200);
    });

    it("正常系: 超過あり → アップグレード提案が表示される", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 900_000,
        costYen: 300,
        overageCostYen: 300,
      });

      expect(result.showUpgradeSuggestion).toBe(true);
    });
  });

  describe("durationSeconds 変換", () => {
    it("正常系: callDurationMs=0 → durationSeconds=0", () => {
      const result = resolveCostSummaryProps({ callDurationMs: 0, costYen: 0 });
      expect(result.durationSeconds).toBe(0);
    });

    it("正常系: 切り捨て: 1999ms → 1秒", () => {
      const result = resolveCostSummaryProps({ callDurationMs: 1999, costYen: 0 });
      expect(result.durationSeconds).toBe(1);
    });

    it("正常系: 3600000ms → 3600秒 (60分)", () => {
      const result = resolveCostSummaryProps({ callDurationMs: 3_600_000, costYen: 0 });
      expect(result.durationSeconds).toBe(3600);
    });
  });

  describe("totalCostYen は常に costYen と同値", () => {
    it("正常系: costYen=0 → totalCostYen=0", () => {
      const result = resolveCostSummaryProps({ callDurationMs: 60_000, costYen: 0 });
      expect(result.totalCostYen).toBe(0);
    });

    it("正常系: costYen=980 → totalCostYen=980", () => {
      const result = resolveCostSummaryProps({
        callDurationMs: 60_000,
        costYen: 980,
        overageCostYen: 980,
      });
      expect(result.totalCostYen).toBe(980);
    });
  });
});

// ---------------------------------------------------------------------------
// 統合: フォーマット関数の組み合わせテスト
// ---------------------------------------------------------------------------

describe("CostSummary 表示ロジック統合", () => {
  it("正常系: 超過なしの通話 (5分、¥0) の表示値が正しい", () => {
    const params = {
      callDurationMs: 300_000,
      costYen: 0,
    };
    const props = resolveCostSummaryProps(params);
    const durationText = formatDurationSeconds(props.durationSeconds);

    expect(durationText).toBe("05:00");
    expect(props.hasOverage).toBe(false);
    // totalCostYen=0 なら "含有分内" テキストを表示 (ロジック確認)
    const isIncludedInPlan = props.totalCostYen === 0;
    expect(isIncludedInPlan).toBe(true);
  });

  it("正常系: 超過あり (12分30秒、¥750) の表示値が正しい", () => {
    const params = {
      callDurationMs: 750_000, // 12分30秒
      costYen: 750,
      baseCostYen: 0,
      overageCostYen: 750,
    };
    const props = resolveCostSummaryProps(params);
    const durationText = formatDurationSeconds(props.durationSeconds);
    const totalText = formatYen(props.totalCostYen);

    expect(durationText).toBe("12:30");
    expect(props.hasOverage).toBe(true);
    expect(totalText).toBe("¥750");
    expect(props.showUpgradeSuggestion).toBe(true);
  });

  it("正常系: 大きな金額 (¥12,345) のフォーマット", () => {
    const params = {
      callDurationMs: 3_600_000, // 60分
      costYen: 12345,
      overageCostYen: 12345,
    };
    const props = resolveCostSummaryProps(params);
    const durationText = formatDurationSeconds(props.durationSeconds);
    const totalText = formatYen(props.totalCostYen);

    expect(durationText).toBe("60:00");
    expect(totalText).toBe("¥12,345");
  });
});
