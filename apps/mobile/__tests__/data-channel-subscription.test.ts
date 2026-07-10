/**
 * data-channel-subscription.ts — 統合購読ヘルパーのユニットテスト
 *
 * 確定#6 (2026-07 敵対的レビュー) 対応: in-call-screen.tsx が実際に呼び出す
 * subscribeTranslationDataChannel / makeCombinedDataChannelHandler を検証する。
 *
 *  - translation.degraded / translation.recovered 受信 → translation-status-store 相当の
 *    actions (setDegraded/setRecovered) が呼ばれ、subtitle 側は呼ばれない
 *  - subtitle.delta 受信 → onSubtitleDelta が呼ばれ、status 側は呼ばれない
 *  - topic 不一致イベントは両方とも無視される
 *  - 購読 cleanup: RoomHandle.subscribeToDataChannel が返す unsubscribe が
 *    そのまま呼び出し元に返り、呼び出すと Room 側の解除処理が実行される (リーク防止)
 */
import { describe, it, expect, vi } from "vitest";
import {
  makeCombinedDataChannelHandler,
  subscribeTranslationDataChannel,
} from "../src/lib/livekit/data-channel-subscription.js";
import type { RoomHandle } from "../src/lib/livekit/connect.js";
import type { TranslationStatusActions } from "../src/lib/livekit/translation-status.js";
import type { SubtitleDelta } from "../src/stores/subtitle-store.js";

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

const SESSION_ID = "12345678-1234-4234-a234-123456789abc";

function makeActions(): TranslationStatusActions & {
  setDegraded: ReturnType<typeof vi.fn>;
  setRecovered: ReturnType<typeof vi.fn>;
} {
  return {
    setDegraded: vi.fn(),
    setRecovered: vi.fn(),
  };
}

describe("makeCombinedDataChannelHandler", () => {
  it("routes translation.degraded to actions.setDegraded only", () => {
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();
    const handler = makeCombinedDataChannelHandler(actions, onSubtitleDelta, "ja");

    const payload = {
      type: "translation.degraded",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      timestamp: "2026-05-12T00:00:00.000Z",
    };
    handler(encode(payload), "translation.status");

    expect(actions.setDegraded).toHaveBeenCalledWith("high_latency");
    expect(actions.setRecovered).not.toHaveBeenCalled();
    expect(onSubtitleDelta).not.toHaveBeenCalled();
  });

  it("routes translation.recovered to actions.setRecovered only", () => {
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();
    const handler = makeCombinedDataChannelHandler(actions, onSubtitleDelta, "ja");

    const payload = {
      type: "translation.recovered",
      sessionId: SESSION_ID,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 2000,
      timestamp: "2026-05-12T00:00:01.000Z",
    };
    handler(encode(payload), "translation.status");

    expect(actions.setRecovered).toHaveBeenCalledWith(2000, "2026-05-12T00:00:01.000Z");
    expect(actions.setDegraded).not.toHaveBeenCalled();
    expect(onSubtitleDelta).not.toHaveBeenCalled();
  });

  it("routes subtitle.delta to onSubtitleDelta only", () => {
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();
    const handler = makeCombinedDataChannelHandler(actions, onSubtitleDelta, "ja");

    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hello",
      elapsedMs: 100,
      isFinal: false,
      timestamp: "2026-05-12T00:00:02.000Z",
    };
    handler(encode(payload), "translation.status");

    expect(onSubtitleDelta).toHaveBeenCalledTimes(1);
    expect(onSubtitleDelta).toHaveBeenCalledWith({
      segmentId: `${SESSION_ID}-2026-05-12T00:00:02.000Z`,
      side: "peer",
      text: "Hello",
      isFinal: false,
    });
    expect(actions.setDegraded).not.toHaveBeenCalled();
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });

  it("ignores messages with a mismatched topic (topic 不一致イベントの無視)", () => {
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();
    const handler = makeCombinedDataChannelHandler(actions, onSubtitleDelta, "ja");

    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hello",
      elapsedMs: 100,
      isFinal: false,
      timestamp: "2026-05-12T00:00:03.000Z",
    };
    handler(encode(payload), "some.unrelated.topic");

    expect(onSubtitleDelta).not.toHaveBeenCalled();
    expect(actions.setDegraded).not.toHaveBeenCalled();
    expect(actions.setRecovered).not.toHaveBeenCalled();
  });
});

describe("subscribeTranslationDataChannel — 購読 cleanup", () => {
  function makeMockRoom(): RoomHandle & {
    subscribeToDataChannel: ReturnType<typeof vi.fn>;
  } {
    const roomUnsubscribe = vi.fn();
    return {
      disconnect: vi.fn(async () => {}),
      publishMicrophoneTrack: vi.fn(async () => {}),
      setMicrophoneMuted: vi.fn(async () => {}),
      subscribeToDataChannel: vi.fn(() => roomUnsubscribe),
      subscribeToParticipantTracks: vi.fn(() => () => {}),
    };
  }

  it("subscribes exactly once and forwards the combined handler to the room", () => {
    const room = makeMockRoom();
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();

    subscribeTranslationDataChannel(room, actions, onSubtitleDelta, "ja");

    expect(room.subscribeToDataChannel).toHaveBeenCalledTimes(1);
    const registeredHandler = room.subscribeToDataChannel.mock.calls[0]?.[0] as (
      data: Uint8Array,
      topic?: string,
    ) => void;
    expect(typeof registeredHandler).toBe("function");

    // Registered handler actually dispatches subtitle.delta through to onSubtitleDelta.
    const payload = {
      type: "subtitle.delta",
      sessionId: SESSION_ID,
      sourceLang: "en",
      targetLang: "ja",
      text: "Hi",
      elapsedMs: 10,
      isFinal: false,
      timestamp: "2026-05-12T00:00:04.000Z",
    };
    registeredHandler(encode(payload), "translation.status");
    expect(onSubtitleDelta).toHaveBeenCalledTimes(1);
  });

  it("returns the room's own unsubscribe function so callers can clean up on call leave", () => {
    const room = makeMockRoom();
    const actions = makeActions();
    const onSubtitleDelta = vi.fn();

    const unsubscribe = subscribeTranslationDataChannel(room, actions, onSubtitleDelta, "ja");
    const roomUnsubscribeFn = room.subscribeToDataChannel.mock.results[0]?.value as () => void;

    expect(unsubscribe).toBe(roomUnsubscribeFn);

    // Calling the returned unsubscribe must invoke the room-level cleanup (no leaked listener).
    unsubscribe();
    expect(roomUnsubscribeFn).toHaveBeenCalledTimes(1);
  });
});
