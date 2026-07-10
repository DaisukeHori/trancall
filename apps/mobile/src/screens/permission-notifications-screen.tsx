/**
 * permission-notifications-screen.tsx
 *
 * 通知許可拒否時 (PERMISSION_NOTIFICATION_DENIED) に表示するソフトバナー画面。
 * Android 13+ / iOS 全対応。着信 push が受けられない状態を UI で通知する。
 *
 * canonical: docs/legal-and-consent.md §6.5.2 / §6.5.4
 */

import React, { useCallback } from "react";
import {
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";

// =============================================================================
// Props
// =============================================================================

export interface PermissionNotificationsScreenProps {
  /** [キャンセル] タップ時のハンドラ */
  onCancel: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function PermissionNotificationsScreen({
  onCancel,
}: PermissionNotificationsScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const handleAllow = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}
      accessibilityViewIsModal
    >
      <View style={[styles.container, { paddingHorizontal: s[24] }]}>
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: c.warningBg,
              borderRadius: theme.radii[12],
              marginBottom: s[24],
            },
          ]}
          accessibilityRole="image"
          accessibilityLabel={t("permissions.notificationDeniedTitle")}
        >
          <Ionicons name="notifications-off" size={32} color={c.warning} />
        </View>

        {/* Title */}
        <Text
          style={[styles.title, { color: c.textPrimary, marginBottom: s[12] }]}
          accessibilityRole="header"
        >
          {t("permissions.notificationDeniedTitle")}
        </Text>

        {/* Description */}
        <Text
          style={[
            styles.description,
            { color: c.textSecondary, marginBottom: s[32] },
          ]}
        >
          {t("permissions.notificationDeniedDescription")}
        </Text>

        {/* Allow button → opens system settings */}
        <View style={styles.button}>
          <Button
            variant="primary"
            size="lg"
            onPress={handleAllow}
            accessibilityLabel={t("permissions.notificationDeniedAction")}
            accessibilityRole="button"
          >
            {t("permissions.notificationDeniedAction")}
          </Button>
        </View>

        {/* Cancel button */}
        <View style={[styles.button, { marginTop: s[12] }]}>
          <Button
            variant="ghost"
            size="md"
            onPress={onCancel}
            accessibilityLabel={t("permissions.openSettingsCancel")}
            accessibilityRole="button"
          >
            {t("permissions.openSettingsCancel")}
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  description: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    alignSelf: "stretch",
  },
});
