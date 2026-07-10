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

export type RootStackParamList = {
  Main: undefined;
  Call: NavigatorScreenParams<CallStackParamList>;
};

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();
