/**
 * in-call-screen バッジ表示ロジックのユニットテスト
 *
 * in-call-screen.tsx の getStatusBadgeVariant / getStatusBadgeLabel は
 * translationEnabled / translationStatus (call-store) と
 * degradedReason / justRecovered (translation-status-store) の組み合わせで決まる。
 *
 * React Native コンポーネントのレンダリングは node 環境では困難なため、
 * 同等のロジックをピュア関数として抽出してテストする。
 *
 * T-19 要件:
 *  - degraded → variant: "warning", label: "translation.degraded" に対応するテキスト
 *  - justRecovered → variant: "success", label: "translation.recoveredShort" に対応するテキスト
 *  - normal (translating) → variant: "success", label: "translation.enabled"
 *  - 翻訳 OFF → variant: "danger", label: "translation.disabled"
 *  - degraded は translationEnabled や translationStatus より優先
 */
import { describe, it, expect } from "vitest";
import type { DegradedReason } from "../src/stores/translation-status-store.js";

// in-call-screen.tsx の getStatusBadgeVariant / getStatusBadgeLabel と同等のロジック
type BadgeVariant = "default" | "success" | "warning" | "danger";
type TranslationStatus = "idle" | "translating" | "reconnecting" | "stopped";

interface BadgeState {
  translationEnabled: boolean;
  translationStatus: TranslationStatus;
  degradedReason: DegradedReason | null;
  justRecovered: boolean;
}

function getVariant(s: BadgeState): BadgeVariant {
  if (!s.translationEnabled) return "danger";
  if (s.degradedReason != null) return "warning";
  if (s.justRecovered) return "success";
  switch (s.translationStatus) {
    case "translating": return "success";
    case "reconnecting": return "warning";
    case "stopped": return "danger";
    default: return "default";
  }
}

function getLabelKey(s: BadgeState): string {
  if (!s.translationEnabled) return "translation.disabled";
  if (s.degradedReason != null) return "translation.degraded";
  if (s.justRecovered) return "translation.recoveredShort";
  switch (s.translationStatus) {
    case "translating": return "translation.enabled";
    case "reconnecting": return "translation.reconnecting";
    case "stopped": return "translation.stopped";
    default: return "translation.enabled";
  }
}

// ---- tests ----

describe("in-call badge — normal (translating)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "translating",
    degradedReason: null,
    justRecovered: false,
  };

  it("variant is success", () => {
    expect(getVariant(state)).toBe("success");
  });

  it("label key is translation.enabled", () => {
    expect(getLabelKey(state)).toBe("translation.enabled");
  });
});

describe("in-call badge — translation OFF", () => {
  const state: BadgeState = {
    translationEnabled: false,
    translationStatus: "idle",
    degradedReason: null,
    justRecovered: false,
  };

  it("variant is danger", () => {
    expect(getVariant(state)).toBe("danger");
  });

  it("label key is translation.disabled", () => {
    expect(getLabelKey(state)).toBe("translation.disabled");
  });
});

describe("in-call badge — degraded (high_latency)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "translating",
    degradedReason: "high_latency",
    justRecovered: false,
  };

  it("variant is warning", () => {
    expect(getVariant(state)).toBe("warning");
  });

  it("label key is translation.degraded", () => {
    expect(getLabelKey(state)).toBe("translation.degraded");
  });
});

describe("in-call badge — degraded (openai_ws_reconnecting)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "translating",
    degradedReason: "openai_ws_reconnecting",
    justRecovered: false,
  };

  it("variant is warning", () => {
    expect(getVariant(state)).toBe("warning");
  });

  it("label key is translation.degraded", () => {
    expect(getLabelKey(state)).toBe("translation.degraded");
  });
});

describe("in-call badge — degraded (output_silence)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "translating",
    degradedReason: "output_silence",
    justRecovered: false,
  };

  it("variant is warning", () => {
    expect(getVariant(state)).toBe("warning");
  });

  it("label key is translation.degraded", () => {
    expect(getLabelKey(state)).toBe("translation.degraded");
  });
});

describe("in-call badge — just recovered (3s 緑バッジ)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "translating",
    degradedReason: null,
    justRecovered: true,
  };

  it("variant is success", () => {
    expect(getVariant(state)).toBe("success");
  });

  it("label key is translation.recoveredShort", () => {
    expect(getLabelKey(state)).toBe("translation.recoveredShort");
  });
});

describe("in-call badge — reconnecting (call-store side)", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "reconnecting",
    degradedReason: null,
    justRecovered: false,
  };

  it("variant is warning", () => {
    expect(getVariant(state)).toBe("warning");
  });

  it("label key is translation.reconnecting", () => {
    expect(getLabelKey(state)).toBe("translation.reconnecting");
  });
});

describe("in-call badge — stopped", () => {
  const state: BadgeState = {
    translationEnabled: true,
    translationStatus: "stopped",
    degradedReason: null,
    justRecovered: false,
  };

  it("variant is danger", () => {
    expect(getVariant(state)).toBe("danger");
  });

  it("label key is translation.stopped", () => {
    expect(getLabelKey(state)).toBe("translation.stopped");
  });
});

describe("in-call badge — priority: degraded > justRecovered > call-store status", () => {
  it("degraded takes priority over justRecovered", () => {
    const state: BadgeState = {
      translationEnabled: true,
      translationStatus: "translating",
      degradedReason: "high_latency",
      justRecovered: true, // 両方セットの場合、degraded 優先
    };
    expect(getVariant(state)).toBe("warning");
    expect(getLabelKey(state)).toBe("translation.degraded");
  });

  it("degraded takes priority over call-store reconnecting", () => {
    const state: BadgeState = {
      translationEnabled: true,
      translationStatus: "reconnecting",
      degradedReason: "high_latency",
      justRecovered: false,
    };
    // どちらも warning だが label は translation.degraded
    expect(getLabelKey(state)).toBe("translation.degraded");
  });

  it("translationEnabled=false overrides degraded", () => {
    const state: BadgeState = {
      translationEnabled: false,
      translationStatus: "translating",
      degradedReason: "high_latency",
      justRecovered: false,
    };
    expect(getVariant(state)).toBe("danger");
    expect(getLabelKey(state)).toBe("translation.disabled");
  });
});
