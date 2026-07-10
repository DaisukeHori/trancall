import React, { useEffect, useCallback } from "react";
import { Modal, View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { useAuthStore, selectIsAuthenticated } from "../stores/auth-store";
import {
  useConsentStore,
  selectPendingConsentRedirect,
} from "../stores/consent-store";
import { getRequiredConsents } from "../api/consent-api";
import { AuthStack } from "./auth-stack";
import { MainTabs } from "./main-tabs";
import { CallStack } from "./call-overlay";
import { ConsentScreen } from "../screens/consent-screen";
import { rootNavigationRef, type RootStackParamList } from "./navigation-ref";
import { usePermissionStore, selectDeniedPermission } from "../stores/permission-store";
import { PermissionRecordAudioScreen } from "../screens/permission-record-audio-screen";
import { PermissionNotificationsScreen } from "../screens/permission-notifications-screen";
import { PermissionManageOwnCallsScreen } from "../screens/permission-manage-own-calls-screen";

const RootStack = createNativeStackNavigator<RootStackParamList>();

/**
 * #30/#68: 認証済みなら MainTabs、未認証なら AuthStack を表示する root screen。
 * RootStack の "Main" screen の component としてマウントされる (別コンポーネントに
 * 切り出すことで CallStack を同じ RootStack 内の兄弟 screen として並置できる)。
 */
function MainOrAuth() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  return isAuthenticated ? <MainTabs /> : <AuthStack />;
}

export function RootNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;

  const restore = useAuthStore((state) => state.restore);
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);

  const pendingConsent = useConsentStore(selectPendingConsentRedirect);
  const clearConsentRedirect = useConsentStore((state) => state.clearConsentRedirect);
  const requestConsentRedirect = useConsentStore((state) => state.requestConsentRedirect);

  useEffect(() => {
    void restore();
  }, [restore]);

  /**
   * AUTH_CONSENT_REQUIRED / AUTH_CONSENT_VERSION_MISMATCH を受け取ったが
   * requiredConsents が空配列の場合、API から再フェッチして上書きする。
   */
  useEffect(() => {
    if (
      pendingConsent == null ||
      pendingConsent.requiredConsents.length > 0 ||
      session == null
    ) {
      return;
    }

    void (async () => {
      const result = await getRequiredConsents(session.accessToken);
      if (result.ok) {
        requestConsentRedirect({
          ...pendingConsent,
          requiredConsents: result.data,
        });
      }
    })();
  }, [pendingConsent, session, requestConsentRedirect]);

  const handleConsentComplete = useCallback(() => {
    const onComplete = pendingConsent?.onComplete;
    clearConsentRedirect();
    onComplete?.();
  }, [pendingConsent, clearConsentRedirect]);

  const handleConsentCancel = useCallback(() => {
    clearConsentRedirect();
  }, [clearConsentRedirect]);

  // #32: マイク / 通知 / (Android) MANAGE_OWN_CALLS 権限拒否時のフォールバック画面
  const deniedPermission = usePermissionStore(selectDeniedPermission);
  const clearDeniedPermission = usePermissionStore((state) => state.clearDeniedPermission);
  const handlePermissionCancel = useCallback(() => {
    clearDeniedPermission();
  }, [clearDeniedPermission]);

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bgPrimary }}
        accessibilityLabel={t("common.loading")}
        accessibilityRole="none"
      >
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  const showConsentModal =
    pendingConsent != null && pendingConsent.requiredConsents.length > 0;

  return (
    <NavigationContainer ref={rootNavigationRef}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={MainOrAuth} />
        {/* #30/#68: 通話フロー (PreCall → Calling / IncomingCall → InCall) は
            全画面モーダルとして Root Stack の兄弟 screen にマウントする。
            contact-profile-screen の発信ボタンや VoIP push リスナーから
            rootNavigationRef.navigate("Call", { screen: ..., params: ... }) で到達する。 */}
        <RootStack.Screen
          name="Call"
          component={CallStack}
          options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
        />
      </RootStack.Navigator>

      {/* Global Consent Screen Modal — AUTH_CONSENT_* エラー受信時に強制表示 */}
      <Modal
        visible={showConsentModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleConsentCancel}
        accessibilityViewIsModal
      >
        {showConsentModal ? (
          <ConsentScreen
            requiredConsents={pendingConsent.requiredConsents}
            source={pendingConsent.source}
            onComplete={handleConsentComplete}
            onCancel={
              // 必須 scope のみの場合はキャンセル不可 (強制同意)
              pendingConsent.requiredConsents.some((cv) => cv.isRequired)
                ? undefined
                : handleConsentCancel
            }
          />
        ) : null}
      </Modal>

      {/* #32: 権限拒否フォールバック Modal — connect.ts / 通知起動時要求で拒否された場合に表示 */}
      <Modal
        visible={deniedPermission != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handlePermissionCancel}
        accessibilityViewIsModal
      >
        {deniedPermission === "microphone" ? (
          <PermissionRecordAudioScreen onCancel={handlePermissionCancel} />
        ) : deniedPermission === "notifications" ? (
          <PermissionNotificationsScreen onCancel={handlePermissionCancel} />
        ) : deniedPermission === "manage_own_calls" ? (
          <PermissionManageOwnCallsScreen onCancel={handlePermissionCancel} />
        ) : null}
      </Modal>
    </NavigationContainer>
  );
}
