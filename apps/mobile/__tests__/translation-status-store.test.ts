/**
 * translation-status-store — 状態遷移ユニットテスト
 *
 * T-19 仕様:
 *  - setDegraded(reason) → degradedReason がセットされ justRecovered はクリア
 *  - setRecovered(durationMs, timestamp) → degradedReason が null、lastRecoveredAt / justRecovered がセット
 *  - clearJustRecovered() → justRecovered のみ false に
 *  - reset() → 全フィールドを初期値に
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTranslationStatusStore } from "../src/stores/translation-status-store.js";

beforeEach(() => {
  useTranslationStatusStore.getState().reset();
});

describe("translation-status-store — initial state", () => {
  it("starts with null degradedReason", () => {
    expect(useTranslationStatusStore.getState().degradedReason).toBeNull();
  });

  it("starts with null lastRecoveredAt", () => {
    expect(useTranslationStatusStore.getState().lastRecoveredAt).toBeNull();
  });

  it("starts with justRecovered = false", () => {
    expect(useTranslationStatusStore.getState().justRecovered).toBe(false);
  });
});

describe("translation-status-store — setDegraded", () => {
  it("sets degradedReason to the given reason", () => {
    useTranslationStatusStore.getState().setDegraded("high_latency");
    expect(useTranslationStatusStore.getState().degradedReason).toBe("high_latency");
  });

  it("supports openai_ws_reconnecting reason", () => {
    useTranslationStatusStore.getState().setDegraded("openai_ws_reconnecting");
    expect(useTranslationStatusStore.getState().degradedReason).toBe("openai_ws_reconnecting");
  });

  it("supports output_silence reason", () => {
    useTranslationStatusStore.getState().setDegraded("output_silence");
    expect(useTranslationStatusStore.getState().degradedReason).toBe("output_silence");
  });

  it("clears justRecovered when degraded", () => {
    // 先に recovered 状態にする
    useTranslationStatusStore.getState().setRecovered(1500, "2026-05-12T00:00:00.000Z");
    expect(useTranslationStatusStore.getState().justRecovered).toBe(true);
    // degraded になると justRecovered はクリア
    useTranslationStatusStore.getState().setDegraded("high_latency");
    expect(useTranslationStatusStore.getState().justRecovered).toBe(false);
  });
});

describe("translation-status-store — setRecovered", () => {
  it("clears degradedReason", () => {
    useTranslationStatusStore.getState().setDegraded("high_latency");
    useTranslationStatusStore.getState().setRecovered(2000, "2026-05-12T00:01:00.000Z");
    expect(useTranslationStatusStore.getState().degradedReason).toBeNull();
  });

  it("sets lastRecoveredAt to the given timestamp", () => {
    const ts = "2026-05-12T00:01:00.000Z";
    useTranslationStatusStore.getState().setRecovered(2000, ts);
    expect(useTranslationStatusStore.getState().lastRecoveredAt).toBe(ts);
  });

  it("sets justRecovered to true", () => {
    useTranslationStatusStore.getState().setRecovered(500, "2026-05-12T00:02:00.000Z");
    expect(useTranslationStatusStore.getState().justRecovered).toBe(true);
  });

  it("accepts durationMs = 0", () => {
    useTranslationStatusStore.getState().setRecovered(0, "2026-05-12T00:03:00.000Z");
    expect(useTranslationStatusStore.getState().justRecovered).toBe(true);
  });
});

describe("translation-status-store — clearJustRecovered", () => {
  it("sets justRecovered to false without touching other fields", () => {
    const ts = "2026-05-12T00:04:00.000Z";
    useTranslationStatusStore.getState().setRecovered(1000, ts);
    useTranslationStatusStore.getState().clearJustRecovered();

    const state = useTranslationStatusStore.getState();
    expect(state.justRecovered).toBe(false);
    expect(state.lastRecoveredAt).toBe(ts);
    expect(state.degradedReason).toBeNull();
  });
});

describe("translation-status-store — reset", () => {
  it("clears all fields to initial values", () => {
    useTranslationStatusStore.getState().setDegraded("high_latency");
    useTranslationStatusStore.getState().setRecovered(999, "2026-05-12T00:05:00.000Z");
    useTranslationStatusStore.getState().reset();

    const state = useTranslationStatusStore.getState();
    expect(state.degradedReason).toBeNull();
    expect(state.lastRecoveredAt).toBeNull();
    expect(state.justRecovered).toBe(false);
  });
});

describe("translation-status-store — transition sequence", () => {
  it("normal → degraded → recovered → clearJustRecovered", () => {
    // normal
    let state = useTranslationStatusStore.getState();
    expect(state.degradedReason).toBeNull();
    expect(state.justRecovered).toBe(false);

    // degraded
    useTranslationStatusStore.getState().setDegraded("output_silence");
    state = useTranslationStatusStore.getState();
    expect(state.degradedReason).toBe("output_silence");
    expect(state.justRecovered).toBe(false);

    // recovered
    useTranslationStatusStore.getState().setRecovered(3000, "2026-05-12T00:06:00.000Z");
    state = useTranslationStatusStore.getState();
    expect(state.degradedReason).toBeNull();
    expect(state.justRecovered).toBe(true);
    expect(state.lastRecoveredAt).toBe("2026-05-12T00:06:00.000Z");

    // 3秒後 timer 相当: clearJustRecovered
    useTranslationStatusStore.getState().clearJustRecovered();
    state = useTranslationStatusStore.getState();
    expect(state.justRecovered).toBe(false);
    // lastRecoveredAt は保持される
    expect(state.lastRecoveredAt).toBe("2026-05-12T00:06:00.000Z");
  });
});
