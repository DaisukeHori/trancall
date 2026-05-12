/**
 * home-balance-banner.test.ts
 *
 * HomeBalanceBanner の色閾値ロジック (getBalanceTier) と 0 分時の分岐テスト
 * docs/billing-ui-flow.md §10.2.2 / T-16 タスク仕様 準拠
 */

import { describe, it, expect, vi } from "vitest";

// -------------------------------------------------------------------------
// Mock react-native (node test environment では利用不可)
// -------------------------------------------------------------------------
vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
  TouchableOpacity: "TouchableOpacity",
  Text: "Text",
  View: "View",
}));

// -------------------------------------------------------------------------
// Mock @trancall/ui-kit
// -------------------------------------------------------------------------
vi.mock("@trancall/ui-kit", () => ({
  useTheme: () => ({
    colors: {
      bgPrimary: "#FFFFFF",
      bgSecondary: "#F2F2F7",
      primaryBg: "#E6F1FB",
      warningBg: "#FAEEDA",
      dangerBg: "#FCEBEB",
      primary: "#0A7AFF",
      warning: "#FF9500",
      danger: "#FF3B30",
    },
    spacing: { 8: 8, 12: 12, 16: 16 },
    radii: { 12: 12 },
  }),
}));

// -------------------------------------------------------------------------
// Mock @trancall/billing
// -------------------------------------------------------------------------
vi.mock("@trancall/billing", () => ({
  PLAN_CONFIGS: {
    free: { tier: "free", overageRateYen: 0, monthlyPriceYen: 0, includedMinutes: 5, transcriptRetentionDays: 7 },
    light: { tier: "light", overageRateYen: 40, monthlyPriceYen: 980, includedMinutes: 30, transcriptRetentionDays: 30 },
    standard: { tier: "standard", overageRateYen: 30, monthlyPriceYen: 2980, includedMinutes: 120, transcriptRetentionDays: 90 },
    business: { tier: "business", overageRateYen: 25, monthlyPriceYen: 9800, includedMinutes: 500, transcriptRetentionDays: 365 },
  },
}));

// -------------------------------------------------------------------------
// Mock @react-navigation/native
// -------------------------------------------------------------------------
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
  }),
}));

// -------------------------------------------------------------------------
// Mock i18n
// -------------------------------------------------------------------------
vi.mock("../src/i18n/index.js", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// -------------------------------------------------------------------------
// Mock billing-store
// -------------------------------------------------------------------------
vi.mock("../src/stores/billing-store.js", () => ({
  useBillingStore: vi.fn(() => null),
}));

// -------------------------------------------------------------------------
// Mock navigation (bottom-tabs)
// -------------------------------------------------------------------------
vi.mock("@react-navigation/bottom-tabs", () => ({}));

import { getBalanceTier } from "../src/components/HomeBalanceBanner.js";
import type { BalanceTier } from "../src/components/HomeBalanceBanner.js";

describe("getBalanceTier — 残量分数から色閾値を返す", () => {
  // ------------------------------------------------------------------
  // normal (> 30 分)
  // ------------------------------------------------------------------
  it("31 分 → normal", () => {
    const result: BalanceTier = getBalanceTier(31);
    expect(result).toBe("normal");
  });

  it("100 分 → normal", () => {
    expect(getBalanceTier(100)).toBe("normal");
  });

  it("境界値: 31 分 → normal", () => {
    expect(getBalanceTier(31)).toBe("normal");
  });

  // ------------------------------------------------------------------
  // warning (10–30 分)
  // ------------------------------------------------------------------
  it("30 分 → warning", () => {
    expect(getBalanceTier(30)).toBe("warning");
  });

  it("10 分 → warning", () => {
    expect(getBalanceTier(10)).toBe("warning");
  });

  it("15 分 → warning", () => {
    expect(getBalanceTier(15)).toBe("warning");
  });

  // ------------------------------------------------------------------
  // critical (1–9 分)
  // ------------------------------------------------------------------
  it("9 分 → critical", () => {
    expect(getBalanceTier(9)).toBe("critical");
  });

  it("1 分 → critical", () => {
    expect(getBalanceTier(1)).toBe("critical");
  });

  it("5 分 → critical", () => {
    expect(getBalanceTier(5)).toBe("critical");
  });

  // ------------------------------------------------------------------
  // depleted (0 分以下)
  // ------------------------------------------------------------------
  it("0 分 → depleted (残量 0 の警告 UI)", () => {
    expect(getBalanceTier(0)).toBe("depleted");
  });

  it("負の値 (-1) → depleted (残量 0 以下の警告 UI)", () => {
    // docs/billing-ui-flow.md §10.2.2: 残量 0 以下は depleted 扱い
    expect(getBalanceTier(-1)).toBe("depleted");
  });

  it("大きな負の値 (-999) → depleted", () => {
    expect(getBalanceTier(-999)).toBe("depleted");
  });
});

describe("getBalanceTier — 境界値の厳密な検証", () => {
  it("境界: 10 分は warning (critical ではない)", () => {
    expect(getBalanceTier(10)).toBe("warning");
  });

  it("境界: 9 分は critical (warning ではない)", () => {
    expect(getBalanceTier(9)).toBe("critical");
  });

  it("境界: 30 分は warning (normal ではない)", () => {
    expect(getBalanceTier(30)).toBe("warning");
  });

  it("境界: 31 分は normal (warning ではない)", () => {
    expect(getBalanceTier(31)).toBe("normal");
  });

  it("境界: 0 分は depleted (critical ではない)", () => {
    expect(getBalanceTier(0)).toBe("depleted");
  });

  it("境界: 1 分は critical (depleted ではない)", () => {
    expect(getBalanceTier(1)).toBe("critical");
  });
});
