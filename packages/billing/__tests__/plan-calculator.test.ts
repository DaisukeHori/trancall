/**
 * plan-calculator テスト
 *
 * billing-detail.md の amount_yen 計算式を網羅的にテストする。
 */

import { describe, expect, it } from "vitest";

import {
  calcAmountYen,
  calcUsedMinutes,
  calcRemainingSeconds,
  calcRemainingMinutes,
  shouldContinue,
} from "../src/services/plan-calculator.js";
import type { PlanConfig } from "../src/schemas.js";

const freePlan: PlanConfig = {
  tier: "free",
  includedMinutes: 5,
  overageRateYen: 0,
  monthlyPriceYen: 0,
  transcriptRetentionDays: 7,
};

const lightPlan: PlanConfig = {
  tier: "light",
  includedMinutes: 30,
  overageRateYen: 40,
  monthlyPriceYen: 980,
  transcriptRetentionDays: 30,
};

const standardPlan: PlanConfig = {
  tier: "standard",
  includedMinutes: 120,
  overageRateYen: 30,
  monthlyPriceYen: 2980,
  transcriptRetentionDays: 90,
};

describe("calcAmountYen", () => {
  it("含有分に余裕あり: amount_yen = 0", () => {
    const result = calcAmountYen(lightPlan, 120, 30);
    expect(result.amountYen).toBe(0);
    expect(result.includedSeconds).toBe(30);
    expect(result.overageSeconds).toBe(0);
  });

  it("含有分切れ(Light, 30秒): ceil(30/60×40) = 20円", () => {
    const result = calcAmountYen(lightPlan, 0, 30);
    expect(result.amountYen).toBe(20);
    expect(result.includedSeconds).toBe(0);
    expect(result.overageSeconds).toBe(30);
  });

  it("跨ぎ window(残10秒+超過20秒): ceil(20/60×40) = 14円", () => {
    const result = calcAmountYen(lightPlan, 10, 30);
    expect(result.amountYen).toBe(14);
    expect(result.includedSeconds).toBe(10);
    expect(result.overageSeconds).toBe(20);
  });

  it("Standard プランの超過: ceil(30/60×30) = 15円", () => {
    const result = calcAmountYen(standardPlan, 0, 30);
    expect(result.amountYen).toBe(15);
  });

  it("Free プランは overageRateYen=0 なので超過でも0円", () => {
    const result = calcAmountYen(freePlan, 0, 30);
    expect(result.amountYen).toBe(0);
  });

  it("remainingSeconds が windowSeconds と等しい場合は含有分全消費", () => {
    const result = calcAmountYen(lightPlan, 30, 30);
    expect(result.amountYen).toBe(0);
    expect(result.includedSeconds).toBe(30);
  });
});

describe("calcUsedMinutes", () => {
  it("0秒 → 0分", () => {
    expect(calcUsedMinutes(0)).toBe(0);
  });

  it("60秒 → 1分（切り上げ）", () => {
    expect(calcUsedMinutes(60)).toBe(1);
  });

  it("61秒 → 2分（切り上げ）", () => {
    expect(calcUsedMinutes(61)).toBe(2);
  });

  it("30秒 → 1分（切り上げ: M-002-NEW）", () => {
    expect(calcUsedMinutes(30)).toBe(1);
  });

  it("120秒 → 2分", () => {
    expect(calcUsedMinutes(120)).toBe(2);
  });
});

describe("calcRemainingSeconds", () => {
  it("未使用なら含有分全体", () => {
    expect(calcRemainingSeconds(lightPlan, 0)).toBe(30 * 60);
  });

  it("全消費なら 0", () => {
    expect(calcRemainingSeconds(lightPlan, 30 * 60)).toBe(0);
  });

  it("超過しても 0 以下にならない", () => {
    expect(calcRemainingSeconds(lightPlan, 99999)).toBe(0);
  });
});

describe("calcRemainingMinutes", () => {
  it("Light プラン未使用: 30分", () => {
    expect(calcRemainingMinutes(lightPlan, 0)).toBe(30);
  });

  it("残り 45 秒の場合: floor(45/60) = 0 分", () => {
    // 30分 = 1800秒、1755秒使用 → 残45秒 → floor = 0分
    expect(calcRemainingMinutes(lightPlan, 1755)).toBe(0);
  });
});

describe("shouldContinue", () => {
  it("残量あり: true", () => {
    expect(shouldContinue(lightPlan, 60, false)).toBe(true);
  });

  it("Free プランで残量 0: false", () => {
    expect(shouldContinue(freePlan, 0, false)).toBe(false);
  });

  it("Free プランは支払い方法があっても残量 0 は false", () => {
    expect(shouldContinue(freePlan, 0, true)).toBe(false);
  });

  it("有料プランで残量 0 + 支払い方法あり: true（超過課金継続）", () => {
    expect(shouldContinue(lightPlan, 0, true)).toBe(true);
  });

  it("有料プランで残量 0 + 支払い方法なし: false", () => {
    expect(shouldContinue(lightPlan, 0, false)).toBe(false);
  });
});
