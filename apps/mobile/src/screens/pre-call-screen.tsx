/**
 * SCR-009 Pre-call setup
 *
 * 通話前設定: 翻訳 ON/OFF、語ペア、字幕 ON/OFF、コスト見積、発信ボタン
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Avatar, Badge, Button, useTheme } from "@trancall/ui-kit";
import { callTokens } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useCallStore } from "../stores/call-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { createCall } from "../api/room-api.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CallStackParamList } from "../navigation/call-overlay.js";

type Props = NativeStackScreenProps<CallStackParamList, "PreCall">;

export function PreCallScreen({ route, navigation }: Props) {
  const { calleeId, calleeName, calleeLanguage, calleeAvatarUri } = route.params;
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);

  const startCallAction = useCallStore((state) => state.startCall);
  const setRoomId = useCallStore((state) => state.setRoomId);
  const setError = useCallStore((state) => state.setError);

  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Language pair
  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${myLanguage.toUpperCase()} → ${calleeLanguage.toUpperCase()}`;

  // Cost estimate (placeholder — billing module integration in Phase 2)
  const costPerMin = 3;
  const remainingMin = 60;
  const plan = "Free";

  const handleCall = async () => {
    if (session == null) return;

    setIsLoading(true);
    setErrorMessage(null);

    startCallAction(calleeId, calleeName, calleeLanguage);

    const result = await createCall(
      { calleeId, creatorId: session.userId, translationEnabled },
      session.accessToken,
    );

    setIsLoading(false);

    if (!result.ok) {
      // Look up i18n key; fall back to raw message if no translation found
      const errMessage = result.error.message;
      setErrorMessage(errMessage);
      setError(errMessage);
      return;
    }

    setRoomId(result.data.roomId);
    navigation.replace("Calling", {
      roomId: result.data.roomId,
      calleeName,
      calleeLanguage,
      calleeAvatarUri,
      translationEnabled,
    });
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Callee info */}
        <View style={[styles.calleeSection, { marginTop: s[32] }]}>
          <Avatar
            size="xl"
            fallbackInitials={calleeName.slice(0, 2)}
            {...(calleeAvatarUri != null ? { uri: calleeAvatarUri } : {})}
            accessibilityLabel={calleeName}
          />
          <Text
            style={[styles.calleeName, { color: c.textPrimary, marginTop: s[12] }]}
            accessibilityRole="header"
          >
            {calleeName}
          </Text>
          <Text style={[styles.calleeLanguage, { color: c.textSecondary, marginTop: s[4] }]}>
            {calleeLanguage.toUpperCase()}
          </Text>
        </View>

        {/* Translation ON/OFF */}
        <View
          style={[
            styles.row,
            {
              marginTop: s[32],
              borderRadius: theme.radii[12],
              backgroundColor: c.bgSecondary,
              paddingHorizontal: s[16],
              paddingVertical: s[12],
            },
          ]}
        >
          <View style={styles.rowLeft}>
            <Badge variant={translationEnabled ? "default" : "danger"}>
              {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
            </Badge>
            <Text style={[styles.langPairText, { color: c.textSecondary, marginTop: s[4] }]}>
              {langPair}
            </Text>
          </View>
          <Switch
            value={translationEnabled}
            onValueChange={setTranslationEnabled}
            accessibilityLabel={t("translation.enabled")}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Subtitles ON/OFF */}
        <View
          style={[
            styles.row,
            {
              marginTop: s[8],
              borderRadius: theme.radii[12],
              backgroundColor: c.bgSecondary,
              paddingHorizontal: s[16],
              paddingVertical: s[12],
            },
          ]}
        >
          <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
            {t("precall.liveSubtitles")}
          </Text>
          <Switch
            value={subtitlesEnabled}
            onValueChange={setSubtitlesEnabled}
            accessibilityLabel={t("precall.liveSubtitles")}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Cost estimate */}
        <View
          style={[
            styles.costSection,
            {
              marginTop: s[8],
              borderRadius: theme.radii[12],
              backgroundColor: c.bgSecondary,
              padding: s[16],
            },
          ]}
        >
          <Text style={[styles.costLabel, { color: c.textSecondary }]}>
            {t("precall.estimatedCost")}
          </Text>
          <Text style={[styles.costValue, { color: c.textPrimary, marginTop: s[4] }]}>
            {t("precall.perMinute", { cost: String(costPerMin) })}
          </Text>
          <Text style={[styles.costRemaining, { color: c.textTertiary, marginTop: s[4] }]}>
            {t("precall.remainingMinutes", {
              minutes: String(remainingMin),
              plan,
            })}
          </Text>
        </View>

        {/* Error banner */}
        {errorMessage != null && (
          <View
            style={[
              styles.errorBanner,
              {
                marginTop: s[16],
                backgroundColor: c.dangerBg,
                borderRadius: theme.radii[8],
                padding: s[12],
              },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[styles.errorText, { color: c.danger }]}>{errorMessage}</Text>
          </View>
        )}

        {/* Call button */}
        <View style={[styles.footer, { marginTop: s[32] }]}>
          <Pressable
            onPress={() => { void handleCall(); }}
            disabled={isLoading}
            accessibilityLabel={t("call.startCall")}
            accessibilityRole="button"
            style={[
              styles.callButton,
              {
                width: callTokens.actionSize * 2,
                height: callTokens.actionSize,
                borderRadius: theme.radii.full,
                backgroundColor: isLoading ? c.secondary : c.primary,
              },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.callButtonText, { color: "#FFFFFF" }]}>
                {t("call.startCall")}
              </Text>
            )}
          </Pressable>

          <Button
            variant="ghost"
            size="md"
            onPress={handleCancel}
            accessibilityLabel={t("common.cancel")}
          >
            {t("common.cancel")}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingBottom: 48,
  },
  calleeSection: {
    alignItems: "center",
  },
  calleeName: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  calleeLanguage: {
    fontSize: 14,
    fontWeight: "500",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLeft: {
    flex: 1,
    gap: 4,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  langPairText: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  costSection: {},
  costLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  costValue: {
    fontSize: 16,
    fontWeight: "500",
  },
  costRemaining: {
    fontSize: 13,
  },
  errorBanner: {},
  errorText: {
    fontSize: 14,
    fontWeight: "500",
  },
  footer: {
    alignItems: "center",
    gap: 16,
  },
  callButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  callButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
