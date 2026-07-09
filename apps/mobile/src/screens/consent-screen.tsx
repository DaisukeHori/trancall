/**
 * consent-screen.tsx — 同意画面
 *
 * canonical: docs/legal-and-consent.md v1.2 §6 (同意フロー UI シーケンス)
 *
 * props:
 *   - requiredConsents: RequiredConsentView[] — 同意対象 scope 一覧 (API から取得済み)
 *   - source: ConsentRecord["source"] — 同意取得文脈
 *   - onComplete: () => void — 必須 scope 全同意後に呼ばれる
 *   - onSkip?: () => void — optional scope のみの場合に「翻訳なしで続ける」として呼ばれる
 *   - onCancel?: () => void — キャンセル (通話取消等)
 */

import React, { useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, useTheme } from "@trancall/ui-kit";
import type { RequiredConsentView } from "@trancall/shared-kernel";
import { useTranslation } from "../i18n/index.js";
import { recordConsent } from "../api/consent-api.js";
import { useAuthStore, selectSession } from "../stores/auth-store.js";

// ============================================================
// Props
// ============================================================

export interface ConsentScreenProps {
  /** 同意対象 scope 一覧 (getRequiredConsents() の返り値) */
  requiredConsents: RequiredConsentView[];
  /**
   * 同意取得文脈。ConsentRecord["source"] と一致させること。
   * - "onboarding": オンボーディング画面
   * - "incoming_call_first_time": 着信応答後初回通話前
   * - "settings_screen": Settings → プライバシーと同意 画面
   * - "terms_revision_prompt": 規約改訂バナー経由
   */
  source:
    | "onboarding"
    | "incoming_call_first_time"
    | "settings_screen"
    | "terms_revision_prompt";
  /** 必須 scope 全同意後 (または settings_screen で更新後) に呼ばれる */
  onComplete: () => void;
  /**
   * 任意 scope のみ残っていて翻訳なしで続ける場合に呼ばれる。
   * undefined なら「翻訳なしで通話」ボタンは表示しない。
   */
  onSkip?: () => void;
  /** キャンセル (通話取消・画面離脱) */
  onCancel?: () => void;
}

// ============================================================
// Helper: i18n key for scope
// ============================================================

function scopeI18nKey(scope: string): {
  label: string;
  description: string;
} {
  return {
    label: `consent.scope.${scope}.label`,
    description: `consent.scope.${scope}.description`,
  };
}

// ============================================================
// ScopeRow — 個々の scope のチェックボックス行
// ============================================================

interface ScopeRowProps {
  view: RequiredConsentView;
  checked: boolean;
  onToggle: (scope: string) => void;
}

function ScopeRow({ view, checked, onToggle }: ScopeRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;
  const keys = scopeI18nKey(view.scope);

  const handleOpenDoc = useCallback(() => {
    if (view.documentUrl != null) {
      void Linking.openURL(view.documentUrl);
    }
  }, [view.documentUrl]);

  const handleToggle = useCallback(() => {
    onToggle(view.scope);
  }, [view.scope, onToggle]);

  // optional scope で既に同意済み (isUpToDate=true) は読み取り専用表示
  const isReadOnly = !view.isRequired && view.isUpToDate;

  return (
    <View style={[rowStyles.container, { borderBottomColor: c.border }]}>
      <Pressable
        style={rowStyles.row}
        onPress={isReadOnly ? undefined : handleToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: isReadOnly }}
        accessibilityLabel={t(keys.label)}
        disabled={isReadOnly}
      >
        {/* Checkbox */}
        <View
          style={[
            rowStyles.checkbox,
            {
              borderColor: checked ? c.primary : c.border,
              backgroundColor: checked ? c.primary : "transparent",
            },
          ]}
        >
          {checked ? (
            <Ionicons name="checkmark" size={16} color={c.textOnColor} />
          ) : null}
        </View>

        {/* Label + description */}
        <View style={[rowStyles.labelContainer, { paddingLeft: s[12] }]}>
          <View style={rowStyles.labelRow}>
            <Text style={[rowStyles.labelText, { color: c.textPrimary }]}>
              {t(keys.label)}
            </Text>
            {view.isRequired ? (
              <View style={[rowStyles.requiredBadge, { backgroundColor: c.danger }]}>
                <Text style={[rowStyles.requiredBadgeText, { color: c.textOnColor }]}>
                  {t("consent.required")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[rowStyles.descriptionText, { color: c.textSecondary, marginTop: s[4] }]}>
            {t(keys.description)}
          </Text>
          {view.documentUrl != null ? (
            <Pressable
              onPress={handleOpenDoc}
              accessibilityRole="link"
              accessibilityLabel={t("consent.readFullText")}
            >
              <Text style={[rowStyles.linkText, { color: c.primary, marginTop: s[4] }]}>
                {t("consent.readFullText")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  checkmark: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
  },
  labelContainer: {
    flex: 1,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  labelText: {
    fontSize: 15,
    fontWeight: "500",
  },
  requiredBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  requiredBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 18,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
});

// ============================================================
// ConsentScreen
// ============================================================

export function ConsentScreen({
  requiredConsents,
  source,
  onComplete,
  onSkip,
  onCancel,
}: ConsentScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore(selectSession);

  // checked state: scope -> boolean
  // 初期値: isUpToDate=true のものは既にチェック済み扱い
  const [checkedScopes, setCheckedScopes] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cv of requiredConsents) {
      initial[cv.scope] = cv.isUpToDate;
    }
    return initial;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // 必須 scope がすべてチェックされているか
  const requiredScopes = requiredConsents.filter((cv) => cv.isRequired);
  const allRequiredChecked = requiredScopes.every((cv) => checkedScopes[cv.scope] === true);

  const handleToggle = useCallback((scope: string) => {
    setCheckedScopes((prev) => ({
      ...prev,
      [scope]: !prev[scope],
    }));
  }, []);

  const handleAccept = useCallback(async () => {
    if (!allRequiredChecked || session == null) return;
    setIsSubmitting(true);

    try {
      // チェックが入っている scope を並列記録 (冪等)
      const scopesToRecord = requiredConsents.filter(
        (cv) => checkedScopes[cv.scope] === true && !cv.isUpToDate,
      );

      const results = await Promise.all(
        scopesToRecord.map((cv) =>
          recordConsent(cv.scope, cv.currentVersion, source, session.accessToken),
        ),
      );

      const failed = results.find((r) => !r.ok);
      if (failed != null && !failed.ok) {
        Alert.alert(
          t("errors.INTERNAL_ERROR"),
          failed.error.message,
        );
        return;
      }

      onComplete();
    } finally {
      setIsSubmitting(false);
    }
  }, [allRequiredChecked, session, requiredConsents, checkedScopes, source, t, onComplete]);

  const handleSkip = useCallback(() => {
    onSkip?.();
  }, [onSkip]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // 表示する scope: data_deletion_request は除外 (退会フロー専用)
  const displayConsents = requiredConsents.filter((cv) => cv.scope !== "data_deletion_request");

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text
          style={[styles.title, { color: c.textPrimary, marginTop: s[32] }]}
          accessibilityRole="header"
        >
          {t("consent.title")}
        </Text>

        {/* Subtitle / context description */}
        <Text style={[styles.subtitle, { color: c.textSecondary, marginTop: s[8] }]}>
          {t("consent.subtitle")}
        </Text>

        {/* Scope rows */}
        <View style={[styles.scopeList, { marginTop: s[24], borderTopColor: c.border }]}>
          {displayConsents.map((cv) => (
            <ScopeRow
              key={cv.scope}
              view={cv}
              checked={checkedScopes[cv.scope] ?? false}
              onToggle={handleToggle}
            />
          ))}
        </View>

        {/* Spacer */}
        <View style={{ height: s[32] }} />
      </ScrollView>

      {/* Footer buttons */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: c.bgPrimary,
            borderTopColor: c.border,
            paddingHorizontal: s[24],
            paddingBottom: s[32],
            paddingTop: s[16],
          },
        ]}
      >
        {/* Primary: 同意して続ける */}
        <Button
          onPress={() => { void handleAccept(); }}
          disabled={!allRequiredChecked || isSubmitting || session == null}
          accessibilityLabel={t("consent.accept_button")}
          size="lg"
        >
          {isSubmitting ? t("common.loading") : t("consent.accept_button")}
        </Button>

        {/* Secondary (optional): 翻訳なしで通話 */}
        {onSkip != null ? (
          <View style={{ marginTop: s[12] }}>
            <Button
              onPress={handleSkip}
              variant="ghost"
              disabled={isSubmitting}
              accessibilityLabel={t("consent.skip_button")}
            >
              {t("consent.skip_button")}
            </Button>
          </View>
        ) : null}

        {/* Tertiary: キャンセル */}
        {onCancel != null ? (
          <View style={{ marginTop: s[8] }}>
            <Button
              onPress={handleCancel}
              variant="ghost"
              disabled={isSubmitting}
              accessibilityLabel={t("common.cancel")}
            >
              {t("common.cancel")}
            </Button>
          </View>
        ) : null}

        {isSubmitting ? (
          <ActivityIndicator
            size="small"
            color={c.primary}
            style={{ marginTop: s[12] }}
            accessibilityLabel={t("common.loading")}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  scopeList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
