/**
 * permission-record-audio-screen.tsx
 *
 * マイク許可拒否時 (PERMISSION_MICROPHONE_DENIED) に表示するフォールバック画面。
 * 通話開始前の mic permission check で拒否されたときにナビゲートされる。
 *
 * canonical: docs/legal-and-consent.md §6.5.1 / §6.5.4
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

export interface PermissionRecordAudioScreenProps {
  /** [キャンセル] タップ時のハンドラ (Home へ戻る等) */
  onCancel: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function PermissionRecordAudioScreen({
  onCancel,
}: PermissionRecordAudioScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const handleOpenSettings = useCallback(() => {
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
              backgroundColor: c.dangerBg,
              borderRadius: theme.radii[12],
              marginBottom: s[24],
            },
          ]}
          accessibilityRole="image"
          accessibilityLabel={t("permissions.microphoneDeniedTitle")}
        >
          <Ionicons name="mic-off" size={32} color={c.danger} />
        </View>

        {/* Title */}
        <Text
          style={[styles.title, { color: c.textPrimary, marginBottom: s[12] }]}
          accessibilityRole="header"
        >
          {t("permissions.microphoneDeniedTitle")}
        </Text>

        {/* Description */}
        <Text
          style={[
            styles.description,
            { color: c.textSecondary, marginBottom: s[32] },
          ]}
        >
          {t("permissions.microphoneDeniedDescription")}
        </Text>

        {/* Open Settings button */}
        <View style={styles.button}>
          <Button
            variant="primary"
            size="lg"
            onPress={handleOpenSettings}
            accessibilityLabel={t("permissions.microphoneDeniedAction")}
            accessibilityRole="button"
          >
            {t("permissions.microphoneDeniedAction")}
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
