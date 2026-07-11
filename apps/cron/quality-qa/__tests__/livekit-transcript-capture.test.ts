/**
 * livekit-transcript-capture.test.ts
 *
 * L-3: LiveKit 実接続に依存しない純粋ロジック (SubtitleDeltaQueue / parseFinalSubtitleText)
 * のユニットテスト。実 Room 接続は unit test の対象外 (mock/live 分割の既存方針を踏襲)。
 */

import { describe, it, expect, vi } from "vitest";

import {
  TRANSLATION_STATUS_CHANNEL_TOPIC,
  SubtitleDeltaQueue,
  parseFinalSubtitleText,
} from "../livekit-transcript-capture.js";

function encodePayload(payload: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(payload), "utf-8"));
}

describe("parseFinalSubtitleText", () => {
  const validPayload = {
    type: "subtitle.delta",
    sessionId: "session-1",
    sourceLang: "ja",
    targetLang: "en",
    text: "Hello there",
    elapsedMs: 120,
    isFinal: true,
    timestamp: new Date().toISOString(),
  };

  it("should return text for a valid isFinal=true subtitle.delta on the correct topic", () => {
    const result = parseFinalSubtitleText(
      encodePayload(validPayload),
      TRANSLATION_STATUS_CHANNEL_TOPIC
    );
    expect(result).toBe("Hello there");
  });

  it("should return null when topic does not match", () => {
    const result = parseFinalSubtitleText(encodePayload(validPayload), "other.topic");
    expect(result).toBeNull();
  });

  it("should return null when topic is undefined", () => {
    const result = parseFinalSubtitleText(encodePayload(validPayload), undefined);
    expect(result).toBeNull();
  });

  it("should return null for isFinal=false (interim delta)", () => {
    const result = parseFinalSubtitleText(
      encodePayload({ ...validPayload, isFinal: false }),
      TRANSLATION_STATUS_CHANNEL_TOPIC
    );
    expect(result).toBeNull();
  });

  it("should return null for a different payload type (translation.degraded)", () => {
    const result = parseFinalSubtitleText(
      encodePayload({
        type: "translation.degraded",
        sessionId: "session-1",
        sourceLang: "ja",
        targetLang: "en",
        reason: "high_latency",
        timestamp: new Date().toISOString(),
      }),
      TRANSLATION_STATUS_CHANNEL_TOPIC
    );
    expect(result).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    const result = parseFinalSubtitleText(
      new Uint8Array(Buffer.from("not json", "utf-8")),
      TRANSLATION_STATUS_CHANNEL_TOPIC
    );
    expect(result).toBeNull();
  });

  it("should return null when required fields are missing (schema validation failure)", () => {
    const result = parseFinalSubtitleText(
      encodePayload({ type: "subtitle.delta", isFinal: true }),
      TRANSLATION_STATUS_CHANNEL_TOPIC
    );
    expect(result).toBeNull();
  });
});

describe("SubtitleDeltaQueue", () => {
  it("should return immediately when a value was already pushed (FIFO)", async () => {
    const queue = new SubtitleDeltaQueue();
    queue.push("first");
    queue.push("second");

    await expect(queue.next(1000)).resolves.toBe("first");
    await expect(queue.next(1000)).resolves.toBe("second");
  });

  it("should resolve a pending next() call as soon as push() is called", async () => {
    vi.useFakeTimers();
    const queue = new SubtitleDeltaQueue();
    const pending = queue.next(5000);
    queue.push("arrived-late");
    vi.advanceTimersByTime(10);
    await expect(pending).resolves.toBe("arrived-late");
    vi.useRealTimers();
  });

  it("should resolve null after timeout when nothing arrives", async () => {
    vi.useFakeTimers();
    const queue = new SubtitleDeltaQueue();
    const pending = queue.next(1000);
    vi.advanceTimersByTime(1000);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("pendingCount should reflect queued-but-unconsumed items", () => {
    const queue = new SubtitleDeltaQueue();
    expect(queue.pendingCount).toBe(0);
    queue.push("a");
    queue.push("b");
    expect(queue.pendingCount).toBe(2);
  });
});
