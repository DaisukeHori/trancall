/**
 * navigation-ref.ts — Root navigator への型付き参照
 *
 * #30/#68: CallStack (PreCall/Calling/IncomingCall/InCall) は React コンポーネント
 * ツリー外 (VoIP push リスナー等) からもナビゲートする必要があるため、
 * React Navigation 公式推奨パターンの `createNavigationContainerRef` を使う。
 * https://reactnavigation.org/docs/navigating-without-navigation-prop/
 *
 * 使用前に `rootNavigationRef.isReady()` を必ず確認すること
 * (NavigationContainer がまだ mount されていない起動直後の呼び出しを防ぐ)。
 */
import { createNavigationContainerRef } from "@react-navigation/native";
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { CallStackParamList } from "./call-overlay";
import type { MainTabParamList } from "./main-tabs";

export type RootStackParamList = {
  // M-5: pre-call-screen.tsx / call-summary-screen.tsx (CallStack 配下) から
  // rootNavigationRef.navigate("Main", { screen: "Settings", params: { screen: "Subscription" } })
  // で Settings > Subscription 画面へ cross-stack ナビゲーションできるようにする。
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Call: NavigatorScreenParams<CallStackParamList>;
};

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * M-5: pre-call-screen.tsx / call-summary-screen.tsx の「アップグレード」ボタンから
 * Settings > Subscription 画面 (settings-subscription-screen.tsx) へ cross-stack
 * ナビゲーションする共通ヘルパー。
 *
 * PreCall / CallSummary は RootStack の "Call" 兄弟 screen 配下にいるため、ローカルの
 * navigation prop (CallStackParamList / PostCallStackParamList スコープ) では
 * Settings タブへ届かない。contact-profile-screen.tsx の
 * `rootNavigationRef.navigate("Call", {...})` と同じパターンで、RootStack の
 * "Main" → MainTabs "Settings" タブ → SettingsStack "Subscription" 画面へネスト遷移する。
 *
 * rootNavigationRef が未 mount (isReady()===false) の場合は何もしない
 * (use-incoming-call-push.ts と同じ安全策)。
 */
export function navigateToSubscriptionScreen(): void {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.navigate("Main", {
    screen: "Settings",
    params: { screen: "Subscription" },
  });
}
