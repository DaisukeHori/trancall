/**
 * audio-session.ts — CallKit didActivate ⇄ LiveKit AudioSession 協調のユニットテスト
 *
 * H-3 (d) / G-9 解消の回帰防止テスト。
 *
 * `createCallKitAudioSessionCoordinator` は native module 非依存の純粋ロジックとして
 * 抽出済み (connect.ts の `createDataReceivedListener` と同じ設計方針) なので、
 * フェイクの `LiveKitAudioSessionLike` を注入して直接検証する。
 *
 * `startCallKitAudioSessionCoordination` (native module 解決を含む配線本体) は
 * Android no-op 分岐と、native module 未リンク時の defensive fallback のみ検証する
 * (`@livekit/react-native` 自体を deep mock することはしない — connect.ts の
 * `loadLiveKitModule()` happy path も同じ理由で unit test していない既存方針に合わせる)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

// modules/call-bridge/index.ts は expo-modules-core (JSI native runtime 依存) を import する。
// vitest (node 環境) では読み込めないため wholesale mock する
// (incoming-call-push.test.ts と同方針)。
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import {
  createCallKitAudioSessionCoordinator,
  startCallKitAudioSessionCoordination,
  type LiveKitAudioSessionLike,
} from "../src/lib/livekit/audio-session.js";

function createFakeAudioSession(
  overrides: Partial<LiveKitAudioSessionLike> = {},
): LiveKitAudioSessionLike {
  return {
    configureAudio: vi.fn(async () => undefined),
    startAudioSession: vi.fn(async () => undefined),
    stopAudioSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createCallKitAudioSessionCoordinator", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("handleAudioRouteChanged (didActivate 相当) で configureAudio → startAudioSession の順に呼ぶ", async () => {
    const audioSession = createFakeAudioSession();
    const coordinator = createCallKitAudioSessionCoordinator(audioSession);

    await coordinator.handleAudioRouteChanged();

    expect(audioSession.configureAudio).toHaveBeenCalledWith({ ios: { defaultOutput: "speaker" } });
    expect(audioSession.startAudioSession).toHaveBeenCalledTimes(1);
    expect(coordinator.isStarted()).toBe(true);
  });

  it("冪等: 2回連続で呼んでも startAudioSession は1回しか呼ばれない", async () => {
    const audioSession = createFakeAudioSession();
    const coordinator = createCallKitAudioSessionCoordinator(audioSession);

    await coordinator.handleAudioRouteChanged();
    await coordinator.handleAudioRouteChanged();

    expect(audioSession.startAudioSession).toHaveBeenCalledTimes(1);
  });

  it("handleCallEnded は開始済みの場合のみ stopAudioSession を呼ぶ", async () => {
    const audioSession = createFakeAudioSession();
    const coordinator = createCallKitAudioSessionCoordinator(audioSession);

    await coordinator.handleCallEnded();
    expect(audioSession.stopAudioSession).not.toHaveBeenCalled();

    await coordinator.handleAudioRouteChanged();
    await coordinator.handleCallEnded();

    expect(audioSession.stopAudioSession).toHaveBeenCalledTimes(1);
    expect(coordinator.isStarted()).toBe(false);
  });

  it("start 失敗時は started フラグを戻し、再試行できる", async () => {
    const startAudioSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const audioSession = createFakeAudioSession({ startAudioSession });
    const coordinator = createCallKitAudioSessionCoordinator(audioSession);

    await coordinator.handleAudioRouteChanged();
    expect(coordinator.isStarted()).toBe(false);

    await coordinator.handleAudioRouteChanged();
    expect(coordinator.isStarted()).toBe(true);
    expect(startAudioSession).toHaveBeenCalledTimes(2);
  });
});

describe("startCallKitAudioSessionCoordination", () => {
  it("@livekit/react-native が未リンクの環境では例外を投げず no-op cleanup を返す (device-verification-required)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const cleanup = startCallKitAudioSessionCoordination();

    expect(typeof cleanup).toBe("function");
    expect(() => { cleanup(); }).not.toThrow();
  });
});
