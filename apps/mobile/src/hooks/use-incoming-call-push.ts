/**
 * use-incoming-call-push.ts — VoIP push 受信 → IncomingCall 画面へのナビゲーション配線
 *
 * #30/#68: `registerVoIPPushListeners` (lib/callkit/voip-push.ts) は実装済だったが
 * どこからも呼ばれておらず、着信画面 (SCR-004) に到達する経路が無かった。
 * 本モジュールがアプリ起動時に一度だけ登録し、着信 push を Root Stack の
 * "Call" 兄弟 screen (CallStack) の IncomingCall へナビゲートする。
 *
 * `rootNavigationRef` は React コンポーネントツリー外からも呼べる
 * (VoIP push リスナーは Native → JS event 経由で任意のタイミングで発火するため)。
 */
import { useEffect } from "react";
import { registerVoIPPushListeners, type VoIPPushPayload } from "../lib/callkit/voip-push.js";
import { rootNavigationRef } from "../navigation/navigation-ref.js";

/**
 * VoIPPushPayload を CallStack の IncomingCall route params に変換してナビゲートする。
 * テストしやすいよう hook 本体と分離したピュア関数として公開する。
 */
export function navigateToIncomingCall(payload: VoIPPushPayload): void {
  if (!rootNavigationRef.isReady()) {
    console.warn("[useIncomingCallPushListener] navigation not ready — dropping incoming call navigation");
    return;
  }

  rootNavigationRef.navigate("Call", {
    screen: "IncomingCall",
    params: {
      roomId: payload.roomId,
      callerName: payload.callerName,
      callerLanguage: payload.callerLanguage,
      callUuid: payload.uuid,
      translationEnabled: payload.translationEnabled,
      ...(payload.callerAvatarUrl != null ? { callerAvatarUri: payload.callerAvatarUrl } : {}),
    },
  });
}

/**
 * アプリのルートで一度だけ呼ぶ。VoIP push (iOS PushKit / Android FCM) の
 * 着信通知を受け取り、IncomingCall 画面へ自動遷移させる。
 */
export function useIncomingCallPushListener(): void {
  useEffect(() => {
    const unsubscribe = registerVoIPPushListeners({
      onIncomingCall: navigateToIncomingCall,
    });
    return unsubscribe;
  }, []);
}
