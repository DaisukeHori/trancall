/**
 * register-globals.ts — `@livekit/react-native` の `registerGlobals()` 呼び出しラッパー (H-3 b)
 *
 * `index.ts` (アプリエントリポイント) から起動直後に一度だけ呼ぶ。
 * 他の LiveKit API を使う前に呼ぶ必要がある (公式ドキュメント準拠、WebRTC の
 * グローバル polyfill 登録)。
 *
 * `@livekit/react-native` はネイティブ binding 前提のパッケージのため、トップレベルで
 * 静的 import すると Expo Go (native module 未リンク環境) で起動直後に例外を投げ、
 * CallBridge を使わない画面まで含めてアプリ全体がクラッシュする
 * (`connect.ts` の `loadLiveKitModule()` と同じ理由で dynamic require + duck typing を使う)。
 *
 * `autoConfigureAudioSession: false`: デフォルト (true) だと LiveKit の audio engine が
 * enable された瞬間 (mic track publish 時) に自動で `AudioSession.startAudioSession()` が
 * 呼ばれるが、CallKit 利用時は `provider(_:didActivate:)` が発火する前に AVAudioSession を
 * activate すると CallKit と category 競合する (native-call-bridge.md §4.7)。
 * 協調タイミングは `audio-session.ts` (G-9) が CallBridge の `audioRouteChanged`/`callEnded`
 * event を購読して手動制御するため、ここでの自動アクティベートは明示的に無効化する。
 */

interface RegisterGlobalsOptions {
  autoConfigureAudioSession?: boolean;
}

interface LiveKitGlobalsModuleLike {
  registerGlobals?: (options?: RegisterGlobalsOptions) => void;
}

export function registerLiveKitGlobals(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const livekit = require("@livekit/react-native") as LiveKitGlobalsModuleLike;
    livekit.registerGlobals?.({ autoConfigureAudioSession: false });
  } catch {
    console.warn(
      "[register-globals] @livekit/react-native is not linked (Expo Go, or native build " +
        "not performed). registerGlobals() skipped — device-verification-required.",
    );
  }
}
