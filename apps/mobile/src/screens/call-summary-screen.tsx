/**
 * SCR-011 — Call Summary
 *
 * Shown immediately after a call ends. Displays:
 *   - Large call duration in mm:ss (heading1, success color, tabular-nums)
 *   - Translation info card (badge + language pair + session count)
 *   - Billing card (cost + remaining minutes)
 *   - 3 action buttons: View Transcript / Call Again / Back to Home
 */

import React from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Badge, Button, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { StatsCard, StatsRow } from "../components/stats-card.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// ---------------------------------------------------------------------------
// Navigation types — these screens live inside a modal stack on top of MainTabs
// ---------------------------------------------------------------------------

export type PostCallStackParamList = {
  CallSummary: CallSummaryParams;
  FullTranscript: FullTranscriptParams;
};

export interface CallSummaryParams {
  /** Duration of the ended call in milliseconds */
  callDurationMs: number;
  /** Room ID used for transcript lookup */
  roomId: string;
  /** Language pair displayed as "JA → EN" */
  languagePair: string;
  /** Number of translation sessions (deduped by language) */
  translationSessions: number;
  /** Whether translation was enabled */
  translationEnabled: boolean;
  /** Estimated cost in yen */
  costYen: number;
  /** Remaining minutes after this call */
  remainingMinutes: number;
  /** Current plan name */
  planName: string;
}

export interface FullTranscriptParams {
  roomId: string;
  callDurationMs: number;
  callerName: string;
  calledAt: string;
}

type Props = NativeStackScreenProps<PostCallStackParamList, "CallSummary">;

/** Format milliseconds to mm:ss */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function CallSummaryScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const {
    callDurationMs,
    roomId,
    languagePair,
    translationSessions,
    translationEnabled,
    costYen,
    remainingMinutes,
    planName,
  } = route.params;

  const durationFormatted = formatDuration(callDurationMs);
  const isLowBalance = remainingMinutes <= 5;

  const handleViewTranscript = () => {
    navigation.push("FullTranscript", {
      roomId,
      callDurationMs,
      callerName: t("common.unknown"),
      calledAt: new Date().toISOString(),
    });
  };

  const handleCallAgain = () => {
    // Navigate back to the calling screen — pop to root of post-call stack
    navigation.popToTop();
  };

  const handleBackToHome = () => {
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: "Call ended" */}
        <Text
          style={[styles.headingLabel, { color: c.textSecondary, marginTop: s[48] }]}
          accessibilityRole="header"
        >
          {t("callSummary.title")}
        </Text>

        {/* Large duration */}
        <Text
          style={[
            styles.duration,
            {
              color: c.success,
              marginTop: s[8],
              marginBottom: s[32],
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`${t("callSummary.duration")}: ${durationFormatted}`}
        >
          {durationFormatted}
        </Text>

        {/* Translation info card */}
        <View style={{ marginBottom: s[16] }}>
          <StatsCard title={t("callSummary.translationCard")}>
            {/* Translation badge row */}
            <View style={styles.badgeRow}>
              <Badge variant={translationEnabled ? "success" : "default"}>
                {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
              </Badge>
              {translationEnabled && (
                <Text
                  style={[styles.langPair, { color: c.textPrimary, marginLeft: s[8] }]}
                  accessibilityRole="text"
                >
                  {languagePair}
                </Text>
              )}
            </View>
            {translationEnabled && (
              <StatsRow
                label={t("callSummary.translationSessions")}
                value={String(translationSessions)}
              />
            )}
          </StatsCard>
        </View>

        {/* Billing card */}
        <View style={{ marginBottom: s[32] }}>
          <StatsCard title={t("callSummary.billingCard")}>
            <StatsRow
              label={t("callSummary.cost", { cost: costYen })}
              value=""
            />
            <View style={styles.remainingRow}>
              <Text
                style={[styles.remainingText, { color: isLowBalance ? c.warning : c.textPrimary }]}
                accessibilityRole="text"
              >
                {t("callSummary.remaining", { minutes: remainingMinutes, plan: planName })}
              </Text>
              {isLowBalance && (
                <Badge variant="warning">{t("callSummary.lowBalance")}</Badge>
              )}
            </View>
          </StatsCard>
        </View>

        {/* Action buttons */}
        <View style={{ gap: s[12] }}>
          {translationEnabled && (
            <Button
              variant="primary"
              size="lg"
              accessibilityLabel={t("callSummary.viewTranscript")}
              onPress={handleViewTranscript}
            >
              {t("callSummary.viewTranscript")}
            </Button>
          )}

          <Button
            variant="secondary"
            size="lg"
            accessibilityLabel={t("callSummary.callAgain")}
            onPress={handleCallAgain}
          >
            {t("callSummary.callAgain")}
          </Button>

          <Pressable
            accessibilityLabel={t("callSummary.backToHome")}
            accessibilityRole="button"
            onPress={handleBackToHome}
            style={[styles.textLink, { marginTop: s[4] }]}
          >
            <Text style={[styles.textLinkText, { color: c.primary }]}>
              {t("callSummary.backToHome")}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: s[48] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingBottom: 32,
  },
  headingLabel: {
    fontSize: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  duration: {
    fontSize: 28,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  langPair: {
    fontSize: 14,
    fontWeight: "600",
  },
  remainingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  remainingText: {
    fontSize: 14,
    flex: 1,
  },
  textLink: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  textLinkText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
