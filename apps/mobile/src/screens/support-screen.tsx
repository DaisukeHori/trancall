// SCR-Support — Settings → お問い合わせ画面
// canonical: docs/support-flow.md §4, §5, §6

import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { useAuthStore } from "../stores/auth-store";
import type { AuthState } from "../stores/auth-store";
import { useRecentCallsStore } from "../stores/recent-calls-store";
import type { RecentCallsState } from "../stores/recent-calls-store";
import {
  submitInquiry,
  type SupportCategory,
} from "../api/support-api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "../navigation/settings-stack";

// ---------------------------------------------------------------------------
// expo-* helpers — optional deps, fallback gracefully
// ---------------------------------------------------------------------------

function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require("expo-application");
    if (mod !== null && typeof mod === "object" && "nativeApplicationVersion" in mod) {
      const v = mod.nativeApplicationVersion;
      if (typeof v === "string") return v;
    }
  } catch {
    // fallback
  }
  return "1.0.0";
}

function getOsVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require("expo-device");
    if (mod !== null && typeof mod === "object" && "osVersion" in mod) {
      const v = mod.osVersion;
      if (typeof v === "string") return v;
    }
  } catch {
    // fallback
  }
  return Platform.OS === "ios" ? "iOS" : "Android";
}

function getDeviceModel(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require("expo-device");
    if (mod !== null && typeof mod === "object" && "modelName" in mod) {
      const v = mod.modelName;
      if (typeof v === "string") return v;
    }
  } catch {
    // fallback
  }
  return Platform.OS === "ios" ? "iPhone" : "Android Device";
}

// ---------------------------------------------------------------------------
// collectDiagnosticData
// ---------------------------------------------------------------------------

interface DiagnosticDataCollected {
  appVersion: string;
  osVersion: string;
  deviceModel: string;
  submittedAt: string;
  locale: string;
  timeZone: string;
  callHistoryLast7d: number;
  last5RoomIds: string[];
}

export function collectDiagnosticData(recentCallIds: string[]): DiagnosticDataCollected {
  const locale =
    typeof Intl !== "undefined" && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : "ja-JP";
  const timeZone =
    typeof Intl !== "undefined" && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "Asia/Tokyo";

  return {
    appVersion: getAppVersion(),
    osVersion: getOsVersion(),
    deviceModel: getDeviceModel(),
    submittedAt: new Date().toISOString(),
    locale,
    timeZone,
    callHistoryLast7d: recentCallIds.length,
    last5RoomIds: recentCallIds.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Navigation types
// ---------------------------------------------------------------------------

export type SupportScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  "Support"
>;

// ---------------------------------------------------------------------------
// Category picker (ActionSheet / Modal)
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: SupportCategory[] = [
  "bug",
  "billing",
  "feature_request",
  "privacy",
  "other",
];

// ---------------------------------------------------------------------------
// SupportScreen
// ---------------------------------------------------------------------------

export function SupportScreen(_props: SupportScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state: AuthState) => state.session);
  const recentCalls = useRecentCallsStore((state: RecentCallsState) => state.recentCalls);
  const recentCallIds = recentCalls.map((call) => call.id);

  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const isSubmitEnabled = category !== null && body.trim().length > 0 && !isSubmitting;

  const handleCategoryPress = useCallback(() => {
    const options = ALL_CATEGORIES.map((cat) => t(`support.category.${cat}`));
    options.push(t("common.cancel"));

    Alert.alert(
      t("support.category.label"),
      undefined,
      options.map((label, index) => {
        if (index === options.length - 1) {
          return { text: label, style: "cancel" as const };
        }
        const cat = ALL_CATEGORIES[index];
        return {
          text: label,
          onPress: () => {
            if (cat !== undefined) {
              setCategory(cat);
            }
          },
        };
      }),
    );
  }, [t]);

  const handleSubmit = useCallback(async () => {
    if (!isSubmitEnabled || category === null) return;
    if (session == null) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const diagnosticRaw = collectDiagnosticData(recentCallIds);

    const result = await submitInquiry(
      {
        category,
        subject: subject.trim().length > 0 ? subject.trim() : undefined,
        body: body.trim(),
        diagnosticData: {
          appVersion: diagnosticRaw.appVersion,
          osVersion: `${diagnosticRaw.osVersion} (${diagnosticRaw.timeZone})`,
          deviceModel: diagnosticRaw.deviceModel,
          submittedAt: diagnosticRaw.submittedAt,
          locale: diagnosticRaw.locale,
          callHistoryLast7d: diagnosticRaw.callHistoryLast7d,
        },
      },
      session.accessToken,
    );

    setIsSubmitting(false);

    if (!result.ok) {
      const errorCode = result.error.code;
      let errorMessage: string;
      if (errorCode === "SUPPORT_RATE_LIMIT_EXCEEDED") {
        errorMessage = t("support.error.rateLimitExceeded");
      } else if (errorCode === "SUPPORT_MAIL_SEND_FAILED") {
        errorMessage = t("support.error.mailSendFailed");
      } else if (errorCode === "NETWORK_ERROR") {
        errorMessage = t("errors.NETWORK_ERROR");
      } else {
        errorMessage = t("support.error.generic");
      }
      setSubmitError(errorMessage);
      return;
    }

    setTicketId(result.data.data.ticketId);
    setSubmitSuccess(true);
  }, [isSubmitEnabled, category, session, recentCallIds, subject, body, t]);

  // Success view
  if (submitSuccess) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
        <View style={[styles.successContainer, { paddingHorizontal: s[16] }]}>
          <Text
            accessibilityRole="header"
            style={[styles.successTitle, { color: c.textPrimary }]}
          >
            {t("support.success.title")}
          </Text>
          <Text style={[styles.successMessage, { color: c.textSecondary }]}>
            {t("support.success.message")}
          </Text>
          {ticketId !== null && (
            <Text style={[styles.ticketId, { color: c.textSecondary }]}>
              {t("support.success.ticketId")}: {ticketId}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const bodyCharCount = body.length;
  const categoryLabel = category !== null ? t(`support.category.${category}`) : t("support.category.placeholder");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[16] }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.textPrimary }]}
        >
          {t("support.title")}
        </Text>

        {/* Section: メールでのお問い合わせ */}
        <Text style={[styles.sectionHeader, { color: c.textSecondary }]}>
          {t("support.section.email").toUpperCase()}
        </Text>

        {/* Category picker */}
        <View style={[styles.fieldGroup, { backgroundColor: c.bgPrimary, borderColor: c.border, borderRadius: theme.radii[12] }]}>
          <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>
            {t("support.category.label")}
            <Text style={{ color: c.danger }}> *</Text>
          </Text>
          <Pressable
            accessibilityLabel={t("support.category.label")}
            accessibilityRole="button"
            accessibilityHint={t("support.category.hint")}
            onPress={handleCategoryPress}
            style={({ pressed }: { pressed: boolean }) => [
              styles.categoryButton,
              {
                borderColor: c.border,
                backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
              },
            ]}
          >
            <Text
              style={[
                styles.categoryText,
                { color: category !== null ? c.textPrimary : c.textTertiary },
              ]}
            >
              {categoryLabel}
            </Text>
            <Text style={[styles.chevron, { color: c.textTertiary }]}>▼</Text>
          </Pressable>
        </View>

        {/* Subject (optional) */}
        <View style={[styles.fieldGroup, { backgroundColor: c.bgPrimary, borderColor: c.border, borderRadius: theme.radii[12] }]}>
          <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>
            {t("support.subject.label")}
          </Text>
          <TextInput
            accessibilityLabel={t("support.subject.label")}
            accessibilityHint={t("support.subject.hint")}
            placeholder={t("support.subject.placeholder")}
            placeholderTextColor={c.textTertiary}
            value={subject}
            onChangeText={setSubject}
            maxLength={200}
            returnKeyType="next"
            style={[styles.textInput, { color: c.textPrimary, borderColor: c.border }]}
          />
        </View>

        {/* Body (required) */}
        <View style={[styles.fieldGroup, { backgroundColor: c.bgPrimary, borderColor: c.border, borderRadius: theme.radii[12] }]}>
          <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>
            {t("support.body.label")}
            <Text style={{ color: c.danger }}> *</Text>
          </Text>
          <TextInput
            accessibilityLabel={t("support.body.label")}
            accessibilityHint={t("support.body.hint")}
            placeholder={t("support.message_placeholder")}
            placeholderTextColor={c.textTertiary}
            value={body}
            onChangeText={setBody}
            maxLength={5000}
            multiline
            style={[styles.textArea, { color: c.textPrimary, borderColor: c.border }]}
            textAlignVertical="top"
          />
          <Text style={[styles.charCount, { color: c.textTertiary }]}>
            {bodyCharCount} / 5000
          </Text>
        </View>

        {/* Diagnostic info badge */}
        <View style={[styles.infoBadge, { backgroundColor: c.bgPrimary, borderColor: c.border, borderRadius: theme.radii[8] }]}>
          <Text style={[styles.infoBadgeTitle, { color: c.textSecondary }]}>
            {t("support.diagnosticInfo.title")}
          </Text>
          <Text style={[styles.infoBadgeItem, { color: c.textTertiary }]}>
            {`• ${t("support.diagnosticInfo.appVersion")}`}
          </Text>
          <Text style={[styles.infoBadgeItem, { color: c.textTertiary }]}>
            {`• ${t("support.diagnosticInfo.osDevice")}`}
          </Text>
          <Text style={[styles.infoBadgeItem, { color: c.textTertiary }]}>
            {`• ${t("support.diagnosticInfo.locale")}`}
          </Text>
          <Text style={[styles.infoBadgeItem, { color: c.textTertiary }]}>
            {`• ${t("support.diagnosticInfo.recentCalls")}`}
          </Text>
        </View>

        {/* Error message + retry */}
        {submitError !== null && (
          <View style={[styles.errorContainer, { borderColor: c.danger }]}>
            <Text style={[styles.errorText, { color: c.danger }]}>
              {submitError}
            </Text>
            <Pressable
              accessibilityLabel={t("common.retry")}
              accessibilityRole="button"
              onPress={() => { void handleSubmit(); }}
              style={({ pressed }: { pressed: boolean }) => [
                styles.retryButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.retryButtonText, { color: c.primary }]}>
                {t("common.retry")}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Submit button */}
        <Pressable
          accessibilityLabel={t("support.submit")}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isSubmitEnabled }}
          disabled={!isSubmitEnabled}
          onPress={() => { void handleSubmit(); }}
          style={({ pressed }: { pressed: boolean }) => [
            styles.submitButton,
            {
              backgroundColor: isSubmitEnabled
                ? pressed ? c.primaryBg : c.primary
                : c.bgTertiary,
            },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={c.textOnColor} />
          ) : (
            <Text
              style={[
                styles.submitButtonText,
                { color: isSubmitEnabled ? c.textOnColor : c.textTertiary },
              ]}
            >
              {t("support.submit")}
            </Text>
          )}
        </Pressable>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  fieldGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryText: {
    flex: 1,
    fontSize: 15,
  },
  chevron: {
    fontSize: 12,
    fontWeight: "600",
  },
  textInput: {
    height: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  textArea: {
    minHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  charCount: {
    fontSize: 12,
    textAlign: "right",
    marginTop: 4,
  },
  infoBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  infoBadgeTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  infoBadgeItem: {
    fontSize: 12,
    lineHeight: 18,
  },
  errorContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  submitButton: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  bottomPad: {
    height: 32,
  },
  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 48,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  successMessage: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 16,
  },
  ticketId: {
    fontSize: 14,
    fontFamily: "monospace",
    textAlign: "center",
  },
});
