/**
 * translation-status.ts — payload parsing ユニットテスト
 *
 * T-19 仕様:
 *  - translation.degraded ペイロード → setDegraded 呼び出し
 *  - translation.recovered ペイロード → setRecovered 呼び出し
 *  - subtitle.delta ペイロード → 無視 (setDegraded/setRecovered は呼ばれない)
 *  - 不正 JSON → null 返却、actions は呼ばれない
 *  - スキーマ不一致 → null 返却、actions は呼ばれない
 *  - topic が TRANSLATION_STATUS_CHANNEL_TOPIC 以外 → ハンドラは何もしない
 */
import { describe, it, expect, vi } from "vitest";
import {
  handleTranslationStatusPayload,
  makeTranslationStatusDataChannelHandler,
  TRANSLATION_STATUS_CHANNEL_TOPIC,
} from "../src/lib/livekit/translation-status.js";
import type { TranslationStatusActions } from "../src/lib/livekit/translation-status.js";

// ---- helpers ----

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function makeActions(): TranslationStatusActions & {
  setDegraded: ReturnType<typeof vi.fn>;
  setRecovered: ReturnType<typeof vi.fn>;
} {
  return {
    setDegraded: vi.fn(),
    setRecovered: vi.fn(),
  };
}

// Zod v4 の strict UUID 検証 (variant bits [89abAB], version [1-8]) に適合する UUID
const SESSION_ID = "12345678-1234-4234-a234-123456789abc";

// ---- tests ----

describe("handleTranslationStatusPayload — translation.degraded", () => {
  it("calls setDegraded with the reason", () => {
    const actions = makeActions();
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:00:00.000Z",
    };
    const result = handleTranslationStatusPayload(encode(payload), actions);
    expect(result).toBe("translation.degraded");
    expect(actions.setDegraded).toHaveBeenCalledWith("high_latency");
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });

  it("handles openai_ws_reconnecting reason", () => {
    const actions = makeActions();
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      reason: "openai_ws_reconnecting",
      timestamp: "2026-05-12T00:00:01.000Z",
    };
    handleTranslationStatusPayload(encode(payload), actions);
    expect(actions.setDegraded).toHaveBeenCalledWith("openai_ws_reconnecting");
  });

  it("handles output_silence reason", () => {
    const actions = makeActions();
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "zh",
      targetLang: "en",
      reason: "output_silence",
      timestamp: "2026-05-12T00:00:02.000Z",
    };
    handleTranslationStatusPayload(encode(payload), actions);
    expect(actions.setDegraded).toHaveBeenCalledWith("output_silence");
  });
});

describe("handleTranslationStatusPayload — translation.recovered", () => {
  it("calls setRecovered with durationMs and timestamp", () => {
    const actions = makeActions();
    const ts = "2026-05-12T00:01:00.000Z";
    const payload = {
      type: "translation.recovered",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 5000,
      timestamp: ts,
    };
    const result = handleTranslationStatusPayload(encode(payload), actions);
    expect(result).toBe("translation.recovered");
    expect(actions.setRecovered).toHaveBeenCalledWith(5000, ts);
    expect(actions.setDegraded).not.toHaveBeenCalled();
  });

  it("accepts degradedDurationMs = 0", () => {
    const actions = makeActions();
    const payload = {
      type: "translation.recovered",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "zh",
      degradedDurationMs: 0,
      timestamp: "2026-05-12T00:02:00.000Z",
    };
    handleTranslationStatusPayload(encode(payload), actions);
    expect(actions.setRecovered).toHaveBeenCalledWith(0, "2026-05-12T00:02:00.000Z");
  });
});

describe("handleTranslationStatusPayload — subtitle.delta", () => {
  it("returns 'subtitle.delta' without calling setDegraded or setRecovered", () => {
    const actions = makeActions();
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      text: "Hello",
      elapsedMs: 100,
      isFinal: false,
      timestamp: "2026-05-12T00:03:00.000Z",
    };
    const result = handleTranslationStatusPayload(encode(payload), actions);
    expect(result).toBe("subtitle.delta");
    expect(actions.setDegraded).not.toHaveBeenCalled();
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });
});

describe("handleTranslationStatusPayload — error cases", () => {
  it("returns null for invalid JSON", () => {
    const actions = makeActions();
    const badData = new TextEncoder().encode("not-valid-json{{{");
    const result = handleTranslationStatusPayload(badData, actions);
    expect(result).toBeNull();
    expect(actions.setDegraded).not.toHaveBeenCalled();
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });

  it("returns null for schema mismatch (missing reason in degraded)", () => {
    const actions = makeActions();
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      // reason フィールドなし
      timestamp: "2026-05-12T00:04:00.000Z",
    };
    const result = handleTranslationStatusPayload(encode(payload), actions);
    expect(result).toBeNull();
    expect(actions.setDegraded).not.toHaveBeenCalled();
  });

  it("returns null for schema mismatch (unknown type)", () => {
    const actions = makeActions();
    const payload = {
      type: "unknown.event",
      sessionId: SESSION_ID,
    };
    const result = handleTranslationStatusPayload(encode(payload), actions);
    expect(result).toBeNull();
  });

  it("returns null for empty object", () => {
    const actions = makeActions();
    const result = handleTranslationStatusPayload(encode({}), actions);
    expect(result).toBeNull();
  });
});

describe("makeTranslationStatusDataChannelHandler", () => {
  it("calls handleTranslationStatusPayload when topic matches", () => {
    const actions = makeActions();
    const handler = makeTranslationStatusDataChannelHandler(actions);
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:05:00.000Z",
    };
    handler(encode(payload), TRANSLATION_STATUS_CHANNEL_TOPIC);
    expect(actions.setDegraded).toHaveBeenCalledWith("high_latency");
  });

  it("ignores messages with different topic", () => {
    const actions = makeActions();
    const handler = makeTranslationStatusDataChannelHandler(actions);
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:05:00.000Z",
    };
    handler(encode(payload), "subtitle.translated_delta");
    expect(actions.setDegraded).not.toHaveBeenCalled();
  });

  it("ignores messages with no topic", () => {
    const actions = makeActions();
    const handler = makeTranslationStatusDataChannelHandler(actions);
    const payload = {
      type: "translation.recovered",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 1000,
      timestamp: "2026-05-12T00:06:00.000Z",
    };
    handler(encode(payload));
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });
});
