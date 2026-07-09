/**
 * SCR-009 Pre-call setup
 *
 * 通話前設定: 翻訳 ON/OFF、語ペア、字幕 ON/OFF、コスト見積、発信ボタン
 */
import React, { useEffect, useState } from "react";
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
import {
  useBillingStore,
  selectPreCallCostEstimate,
  computeHistoryAverageMinutes,
} from "../stores/billing-store.js";
import { useRecentCallsStore } from "../stores/recent-calls-store.js";
import { PreCallCostEstimate } from "../components/PreCallCostEstimate.js";
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

  // 通話履歴から想定通話時間を算出 (5 件未満は fallback 15 分)
  const recentCalls = useRecentCallsStore((state) => state.recentCalls);
  const historyAverageMinutes = computeHistoryAverageMinutes(
    recentCalls.slice(0, 10).map((c) => c.durationSeconds),
  );

  const costEstimate = useBillingStore((state) =>
    selectPreCallCostEstimate(state, historyAverageMinutes),
  );
  const refreshSubscription = useBillingStore((s) => s.refreshSubscription);

  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Language pair
  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${myLanguage.toUpperCase()} → ${calleeLanguage.toUpperCase()}`;

  // 画面表示時にサブスクリプション状態を更新
  useEffect(() => {
    void refreshSubscription();
  }, [refreshSubscription]);

  // upgrade ブロック: upgrade 状態の場合は通話開始ボタンを無効化
  const isCallBlocked =
    costEstimate != null && costEstimate.recommendedAction === "upgrade";

  const handleUpgrade = () => {
    // TODO: Settings → Subscription 画面への cross-stack ナビゲーションは
    // Subscription 画面実装後 (T-18 以降) に実装予定。
    // 現状はキャンセルして戻る (課金ブロック)。
    navigation.goBack();
  };

  const handleProceedFromOverage = () => {
    void handleCall();
  };

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
            testID="translation-toggle"
            value={translationEnabled}
            onValueChange={setTranslationEnabled}
            accessibilityLabel={t("translation.enabled")}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor={c.subtitleText}
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
            thumbColor={c.subtitleText}
          />
        </View>

        {/* Cost estimate */}
        {costEstimate != null && (
          <View style={{ marginTop: s[8] }}>
            <PreCallCostEstimate
              estimatedMinutes={costEstimate.expectedMinutes}
              estimatedCostYen={costEstimate.predictedCostYen}
              remainingMinutes={costEstimate.remainingMinutes}
              recommendedAction={costEstimate.recommendedAction}
              onUpgradePress={handleUpgrade}
              onProceedPress={handleProceedFromOverage}
            />
          </View>
        )}

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
            disabled={isLoading || isCallBlocked}
            accessibilityLabel={t("call.startCall")}
            accessibilityRole="button"
            style={[
              styles.callButton,
              {
                width: callTokens.actionSize,
                height: callTokens.actionSize,
                borderRadius: theme.radii.full,
                backgroundColor:
                  isLoading || isCallBlocked ? c.secondary : c.primary,
              },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color={c.subtitleText} />
            ) : (
              <Text style={[styles.callButtonText, { color: c.subtitleText }]}>
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
