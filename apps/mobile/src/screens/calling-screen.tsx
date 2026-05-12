/**
 * SCR-010 Calling (ringing)
 *
 * 発信中画面: 大 Avatar、名前、呼び出し中表示、キャンセルボタン
 * 翻訳 ON バッジと語ペア常時表示
 */
import React, { useEffect } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar, Badge, useTheme, callTokens } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useCallStore } from "../stores/call-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { endCall as apiEndCall } from "../api/room-api.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CallStackParamList } from "../navigation/call-overlay.js";

type Props = NativeStackScreenProps<CallStackParamList, "Calling">;

export function CallingScreen({ route, navigation }: Props) {
  const { roomId, calleeName, calleeLanguage, calleeAvatarUri, translationEnabled } = route.params;
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const endCallAction = useCallStore((state) => state.endCall);
  const resetToIdle = useCallStore((state) => state.resetToIdle);

  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${myLanguage.toUpperCase()} → ${calleeLanguage.toUpperCase()}`;

  // Poll for answer — real implementation uses WebSocket / push event
  // Phase 2 で Signaling module との結合予定
  useEffect(() => {
    // TODO Phase 2: subscribe to signaling event for callee answer
    return () => undefined;
  }, [roomId]);

  const handleCancel = async () => {
    if (session != null && roomId != null) {
      await apiEndCall(roomId, session.accessToken);
    }
    endCallAction();
    setTimeout(() => {
      resetToIdle();
    }, 500);
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.callBg }]}
      accessibilityLabel={t("call.calling")}
    >
      {/* Status */}
      <View style={[styles.statusRow, { paddingTop: s[48] }]}>
        <Text style={[styles.statusText, { color: c.textSecondary }]}>
          {t("call.calling")}
        </Text>
      </View>

      {/* Translation badge + lang pair — always visible */}
      <View style={styles.badgeRow}>
        <Badge variant={translationEnabled ? "default" : "danger"}>
          {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
        </Badge>
        <Text style={[styles.langPair, { color: c.textSecondary }]}>
          {langPair}
        </Text>
      </View>

      {/* Hero avatar */}
      <View style={[styles.heroSection, { marginTop: s[48] }]}>
        <Avatar
          size="xl"
          fallbackInitials={calleeName.slice(0, 2)}
          {...(calleeAvatarUri != null ? { uri: calleeAvatarUri } : {})}
          accessibilityLabel={calleeName}
        />
        <Text
          style={[styles.calleeName, { color: c.subtitleText, marginTop: s[16] }]}
          accessibilityRole="header"
        >
          {calleeName}
        </Text>
        <Text style={[styles.ringing, { color: c.textSecondary, marginTop: s[8] }]}>
          {t("call.ringing")}
        </Text>
      </View>

      {/* Cancel button */}
      <View style={[styles.footer, { paddingBottom: s[48] }]}>
        <Pressable
          onPress={() => { void handleCancel(); }}
          accessibilityLabel={t("common.cancel")}
          accessibilityRole="button"
          style={[
            styles.cancelButton,
            {
              width: callTokens.actionSize,
              height: callTokens.actionSize,
              borderRadius: theme.radii.full,
              backgroundColor: c.danger,
            },
          ]}
        >
          <Text style={[styles.cancelIcon, { color: c.subtitleText }]}>X</Text>
        </Pressable>
        <Text style={[styles.cancelLabel, { color: c.textSecondary, marginTop: s[8] }]}>
          {t("common.cancel")}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: "center",
  },
  statusRow: {
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    letterSpacing: 0.3,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  langPair: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  heroSection: {
    flex: 1,
    alignItems: "center",
  },
  calleeName: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  ringing: {
    fontSize: 16,
    fontWeight: "500",
  },
  footer: {
    alignItems: "center",
  },
  cancelButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  cancelIcon: {
    fontSize: 24,
    fontWeight: "700",
  },
  cancelLabel: {
    fontSize: 13,
  },
});
