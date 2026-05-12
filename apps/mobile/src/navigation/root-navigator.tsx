import React, { useEffect, useCallback } from "react";
import { Modal, View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useAuthStore, selectIsAuthenticated } from "../stores/auth-store.js";
import {
  useConsentStore,
  selectPendingConsentRedirect,
} from "../stores/consent-store.js";
import { getRequiredConsents } from "../api/consent-api.js";
import { AuthStack } from "./auth-stack.js";
import { MainTabs } from "./main-tabs.js";
import { ConsentScreen } from "../screens/consent-screen.js";

export function RootNavigator() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;

  const restore = useAuthStore((state) => state.restore);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
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
    <NavigationContainer>
      {isAuthenticated ? <MainTabs /> : <AuthStack />}

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
    </NavigationContainer>
  );
}
