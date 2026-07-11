/**
 * audio-session.ts — CallKit `didActivate` と LiveKit `AudioSession` の協調 (H-3 d, G-9 解消)
 *
 * 設計: docs/native-call-bridge.md §4.7 (AVAudioSession の協調)
 *
 * CallKit 利用時、AVAudioSession の category/mode 変更・activation は
 * `provider(_:didActivate:)` (native, `CallBridgeProvider.swift`) 内で行うのが正規
 * (Apple CallKit Programming Guide)。`AudioSession.startAudioSession()` を
 * didActivate より早く呼ぶと CallKit と audio session の activation が競合する。
 *
 * `CallBridgeProvider.swift` の `didActivate` ハンドラは AVAudioSession の
 * category/mode を native 側で設定した上で `audioRouteChanged` event (route: "earpiece")
 * を emit する (native-call-bridge-impl-status.md §5.3)。本モジュールはこの event を
 * 「didActivate 相当のタイミング」の代理シグナルとして購読し、
 * `AudioSession.configureAudio()` + `AudioSession.startAudioSession()` を呼ぶ。
 * 通話終了 (`callEnded` event) で `AudioSession.stopAudioSession()` を呼ぶ。
 *
 * index.ts で `registerGlobals({ autoConfigureAudioSession: false })` を呼び、
 * LiveKit SDK 側の自動 audio session 管理 (mic track enable と同時に activate してしまい
 * CallKit と競合しうる) を明示的に無効化していることが前提。
 *
 * Android は CallKit 相当の OS 制約が無く、AudioManager 経由で
 * `CallBridgeModule.setSpeakerphone`/`TranCallConnection.onCallAudioStateChanged` が
 * 完結しているため (native-call-bridge.md §5.6)、本モジュールは iOS でのみ動作する
 * (`Platform.OS !== "ios"` は no-op)。
 *
 * ⚠️ device-verification-required: 実機/シミュレータでの CallKit ⇄ LiveKit
 * audio session 協調タイミングの実挙動は未検証 (Xcode 無し環境のため)。
 */
import { Platform } from "react-native";
import { callBridge } from "../../../modules/call-bridge/index";

/**
 * `@livekit/react-native` の `AudioSession` (default export class) のうち、
 * 本モジュールが使う部分のみを duck-typing で表した最小インタフェース。
 * connect.ts の `LiveKitModuleLike` と同じ理由で、tsc がネイティブ binding の
 * 有無に依存しないよう native module を静的 import しない。
 */
export interface LiveKitAudioSessionLike {
  configureAudio: (config: { ios?: { defaultOutput?: "speaker" | "earpiece" } }) => Promise<void>;
  startAudioSession: () => Promise<void>;
  stopAudioSession: () => Promise<void>;
}

/**
 * CallKit didActivate 相当のタイミングで AudioSession を起動し、通話終了で停止する
 * 状態機械。native module (`AudioSession`) を外部から注入できるようにして、
 * native binding 抜きにユニットテスト可能にする (connect.ts の
 * `createDataReceivedListener` と同じ「純粋ロジックを抽出してテストする」パターン)。
 */
export function createCallKitAudioSessionCoordinator(audioSession: LiveKitAudioSessionLike) {
  let started = false;

  return {
    /** `audioRouteChanged` event (didActivate 相当) を受けたら呼ぶ。冪等。 */
    handleAudioRouteChanged: async (): Promise<void> => {
      if (started) return;
      started = true;
      try {
        await audioSession.configureAudio({ ios: { defaultOutput: "speaker" } });
        await audioSession.startAudioSession();
      } catch (error) {
        started = false;
        console.warn(
          "[audio-session] failed to start AudioSession after CallKit didActivate",
          error,
        );
      }
    },

    /** `callEnded` event を受けたら呼ぶ。冪等 (未開始なら何もしない)。 */
    handleCallEnded: async (): Promise<void> => {
      if (!started) return;
      started = false;
      try {
        await audioSession.stopAudioSession();
      } catch (error) {
        console.warn("[audio-session] failed to stop AudioSession after callEnded", error);
      }
    },

    /** テスト用: 現在 AudioSession が start 済みかどうか */
    isStarted: (): boolean => started,
  };
}

export type CallKitAudioSessionCoordinator = ReturnType<typeof createCallKitAudioSessionCoordinator>;

function loadLiveKitAudioSession(): LiveKitAudioSessionLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@livekit/react-native") as { AudioSession?: LiveKitAudioSessionLike };
    return mod.AudioSession ?? null;
  } catch {
    console.warn(
      "[audio-session] @livekit/react-native is not linked; CallKit/AudioSession " +
        "coordination disabled (device-verification-required).",
    );
    return null;
  }
}

/**
 * アプリの通話ライフサイクルの中で一度呼ぶ (in-call 開始時が想定、呼び出し箇所自体は
 * 別 workstream が画面/CallKit 配線と合わせて行う)。CallBridge の `audioRouteChanged` /
 * `callEnded` event を購読し、CallKit didActivate と LiveKit AudioSession を協調させる。
 *
 * @returns 購読解除関数 (通話終了・画面 unmount 時に呼ぶ)
 */
export function startCallKitAudioSessionCoordination(): () => void {
  if (Platform.OS !== "ios") {
    // Android は AudioManager 経由で native 側完結 (§5.6)、JS 側の協調は不要。
    return () => undefined;
  }

  const audioSession = loadLiveKitAudioSession();
  if (audioSession == null) {
    return () => undefined;
  }

  const coordinator = createCallKitAudioSessionCoordinator(audioSession);

  const unsubscribeRouteChanged = callBridge.on("audioRouteChanged", () => {
    void coordinator.handleAudioRouteChanged();
  });
  const unsubscribeEnded = callBridge.on("callEnded", () => {
    void coordinator.handleCallEnded();
  });

  return () => {
    unsubscribeRouteChanged();
    unsubscribeEnded();
  };
}
