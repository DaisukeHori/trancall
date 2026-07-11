import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Initialize i18n (side effect import)
import "./src/i18n/index";
import { RootNavigator } from "./src/navigation/root-navigator";
import { useIncomingCallPushListener } from "./src/hooks/use-incoming-call-push";
import { useNotificationPermissionRequest } from "./src/hooks/use-notification-permission";
// M-11: E2E (Maestro) 専用の DataChannel 直注入フック登録。isE2eTestMode() ガードにより
// production ビルドでは何も登録されない (docs/e2e-test-design.md §11)。
import { registerE2ESubtitleInjection } from "./src/lib/e2e/subtitle-injection";

registerE2ESubtitleInjection();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

export default function App() {
  // #30/#68: VoIP push (着信) を受信したら IncomingCall 画面へ自動遷移する
  useIncomingCallPushListener();
  // #32: 起動時に通知権限を要求する (着信 push / 一般通知に必要)
  useNotificationPermissionRequest();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <RootNavigator />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
