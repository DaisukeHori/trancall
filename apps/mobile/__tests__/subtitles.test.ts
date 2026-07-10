/**
 * subtitles.ts — payload parsing ユニットテスト
 *
 * 確定#6 (2026-07 敵対的レビュー) 対応: Agent (apps/translation-agent/src/agent.ts) が
 * 実際に publish している canonical topic (`translation.status`) / schema
 * (TranslationStatusChannelPayloadSchema, type: "subtitle.delta") を受信して
 * SubtitleDelta (subtitle-store.ts) に変換できることを確認する。
 *
 *  - subtitle.delta (targetLang === 自分の言語) → side: "peer"
 *  - subtitle.delta (sourceLang === 自分の言語) → side: "me"
 *  - subtitle.delta (自分に無関係な言語ペア) → null
 *  - translation.degraded / translation.recovered → null (subtitles.ts のスコープ外)
 *  - 不正 JSON / スキーマ不一致 → null
 *  - topic が SUBTITLE_DATA_CHANNEL_TOPIC (= translation.status) 以外 → ハンドラは無視
 *  - SUBTITLE_DATA_CHANNEL_TOPIC は translation-status.ts の TRANSLATION_STATUS_CHANNEL_TOPIC と一致
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseSubtitleDelta,
  makeSubtitleDataChannelHandler,
  SUBTITLE_DATA_CHANNEL_TOPIC,
} from "../src/lib/livekit/subtitles.js";
import { TRANSLATION_STATUS_CHANNEL_TOPIC } from "../src/lib/livekit/translation-status.js";

// ---- helpers ----

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

// Zod v4 の strict UUID 検証に適合する UUID
const SESSION_ID = "12345678-1234-4234-a234-123456789abc";

// ---- tests ----

describe("SUBTITLE_DATA_CHANNEL_TOPIC — canonical topic 統一 (確定#6/#51/#17)", () => {
  it("matches TRANSLATION_STATUS_CHANNEL_TOPIC (single Data Channel topic for all 3 payload types)", () => {
    expect(SUBTITLE_DATA_CHANNEL_TOPIC).toBe(TRANSLATION_STATUS_CHANNEL_TOPIC);
    expect(SUBTITLE_DATA_CHANNEL_TOPIC).toBe("translation.status");
  });
});

describe("parseSubtitleDelta — subtitle.delta", () => {
  it("returns side 'peer' when targetLang matches my native language", () => {
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "こんにちは",
      elapsedMs: 120,
      isFinal: false,
      timestamp: "2026-05-12T00:00:00.000Z",
    };
    const result = parseSubtitleDelta(encode(payload), "ja");
    expect(result).toEqual({
      segmentId: `${SESSION_ID}-2026-05-12T00:00:00.000Z`,
      side: "peer",
      text: "こんにちは",
      isFinal: false,
    });
  });

  it("returns side 'me' when sourceLang matches my native language", () => {
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      text: "Hello there",
      elapsedMs: 250,
      isFinal: true,
      timestamp: "2026-05-12T00:00:01.000Z",
    };
    const result = parseSubtitleDelta(encode(payload), "ja");
    expect(result).toEqual({
      segmentId: `${SESSION_ID}-2026-05-12T00:00:01.000Z`,
      side: "me",
      text: "Hello there",
      isFinal: true,
    });
  });

  it("returns null when neither sourceLang nor targetLang matches my native language", () => {
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "zh",
      text: "irrelevant",
      elapsedMs: 10,
      isFinal: false,
      timestamp: "2026-05-12T00:00:02.000Z",
    };
    expect(parseSubtitleDelta(encode(payload), "ja")).toBeNull();
  });

  it("propagates isFinal=true into the mapped SubtitleDelta", () => {
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "final text",
      elapsedMs: 400,
      isFinal: true,
      timestamp: "2026-05-12T00:00:03.000Z",
    };
    const result = parseSubtitleDelta(encode(payload), "ja");
    expect(result?.isFinal).toBe(true);
  });
});

describe("parseSubtitleDelta — out of scope payload types", () => {
  it("returns null for translation.degraded", () => {
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:00:04.000Z",
    };
    expect(parseSubtitleDelta(encode(payload), "ja")).toBeNull();
  });

  it("returns null for translation.recovered", () => {
    const payload = {
      type: "translation.recovered",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 3000,
      timestamp: "2026-05-12T00:00:05.000Z",
    };
    expect(parseSubtitleDelta(encode(payload), "ja")).toBeNull();
  });
});

describe("parseSubtitleDelta — error cases", () => {
  it("returns null for invalid JSON", () => {
    const badData = new TextEncoder().encode("not-valid-json{{{");
    expect(parseSubtitleDelta(badData, "ja")).toBeNull();
  });

  it("returns null for schema mismatch (missing text)", () => {
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      // text フィールドなし
      elapsedMs: 10,
      isFinal: false,
      timestamp: "2026-05-12T00:00:06.000Z",
    };
    expect(parseSubtitleDelta(encode(payload), "ja")).toBeNull();
  });

  it("returns null for unknown type", () => {
    const payload = { type: "unknown.event", sessionId: SESSION_ID };
    expect(parseSubtitleDelta(encode(payload), "ja")).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(parseSubtitleDelta(encode({}), "ja")).toBeNull();
  });
});

describe("makeSubtitleDataChannelHandler", () => {
  it("calls onDelta when topic matches and type is subtitle.delta", () => {
    const onDelta = vi.fn();
    const handler = makeSubtitleDataChannelHandler(onDelta, "ja");
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hi",
      elapsedMs: 50,
      isFinal: false,
      timestamp: "2026-05-12T00:00:07.000Z",
    };
    handler(encode(payload), SUBTITLE_DATA_CHANNEL_TOPIC);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith({
      segmentId: `${SESSION_ID}-2026-05-12T00:00:07.000Z`,
      side: "peer",
      text: "Hi",
      isFinal: false,
    });
  });

  it("ignores messages with a different topic (topic 不一致イベントの無視)", () => {
    const onDelta = vi.fn();
    const handler = makeSubtitleDataChannelHandler(onDelta, "ja");
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hi",
      elapsedMs: 50,
      isFinal: false,
      timestamp: "2026-05-12T00:00:08.000Z",
    };
    handler(encode(payload), "some.other.topic");
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("ignores messages with no topic", () => {
    const onDelta = vi.fn();
    const handler = makeSubtitleDataChannelHandler(onDelta, "ja");
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hi",
      elapsedMs: 50,
      isFinal: false,
      timestamp: "2026-05-12T00:00:09.000Z",
    };
    handler(encode(payload));
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("does not call onDelta for translation.degraded on the same topic (handled by translation-status.ts)", () => {
    const onDelta = vi.fn();
    const handler = makeSubtitleDataChannelHandler(onDelta, "ja");
    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:00:10.000Z",
    };
    handler(encode(payload), SUBTITLE_DATA_CHANNEL_TOPIC);
    expect(onDelta).not.toHaveBeenCalled();
  });
});
