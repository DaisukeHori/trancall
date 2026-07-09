/**
 * use-incoming-call-push.ts — VoIP push 受信 → IncomingCall 画面へのナビゲーション配線
 *
 * #30/#68: `registerVoIPPushListeners` (lib/callkit/voip-push.ts, react-native-voip-push-notification
 * 経由の legacy JS-driven パス) は実装済だったが、どこからも呼ばれておらず、
 * 着信画面 (SCR-004) に到達する経路が無かった。本モジュールがアプリ起動時に一度だけ登録し、
 * 着信 push を Root Stack の "Call" 兄弟 screen (CallStack) の IncomingCall へナビゲートする。
 *
 * Stage 2 追加: `callBridge.on("incomingCall", ...)` (modules/call-bridge, native
 * PushKitDelegate.swift/FcmService.kt が CXProvider/Telecom への投入と同時に emit する経路、
 * §3.3 canonical) も同じ画面へ到達させる。2 経路とも同じ IncomingCall 画面に着地させることで、
 * legacy (voip-push.ts) → CallBridge Module への移行期間中も着信を取りこぼさない。
 *
 * `rootNavigationRef` は React コンポーネントツリー外からも呼べる
 * (VoIP push リスナーは Native → JS event 経由で任意のタイミングで発火するため)。
 */
import { useEffect } from "react";
import { registerVoIPPushListeners, type VoIPPushPayload } from "../lib/callkit/voip-push.js";
import { callBridge, type CallEvent } from "../../modules/call-bridge/index.js";
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
 * CallBridge Module の "incomingCall" event (native CXProvider/Telecom 投入と同時に emit) を
 * IncomingCall route params に変換してナビゲートする。
 *
 * 既知の制約: CallEventSchema の incomingCall variant (§7.1) には callerAvatarUrl /
 * translationEnabled が含まれないため (design canonical の制約)、これらの params は
 * 渡さない (画面側は optional 扱いのため安全にデフォルト表示される)。
 */
export function navigateToIncomingCallFromBridgeEvent(
  event: Extract<CallEvent, { type: "incomingCall" }>,
): void {
  if (!rootNavigationRef.isReady()) {
    console.warn("[useIncomingCallPushListener] navigation not ready — dropping incoming call navigation");
    return;
  }

  rootNavigationRef.navigate("Call", {
    screen: "IncomingCall",
    params: {
      roomId: event.roomId,
      callerName: event.callerName,
      callerLanguage: event.sourceLang,
      callUuid: event.uuid,
    },
  });
}

/**
 * アプリのルートで一度だけ呼ぶ。VoIP push (iOS PushKit / Android FCM) の
 * 着信通知を受け取り、IncomingCall 画面へ自動遷移させる。
 */
export function useIncomingCallPushListener(): void {
  useEffect(() => {
    const unsubscribeLegacy = registerVoIPPushListeners({
      onIncomingCall: navigateToIncomingCall,
    });
    const unsubscribeBridge = callBridge.on("incomingCall", navigateToIncomingCallFromBridgeEvent);
    return () => {
      unsubscribeLegacy();
      unsubscribeBridge();
    };
  }, []);
}
