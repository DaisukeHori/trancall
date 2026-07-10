/**
 * PreCallCostEstimate コンポーネント
 *
 * Pre-call 画面でコスト見積を表示する。
 * docs/billing-ui-flow.md §10.1 recommendedAction 別 UI 仕様準拠。
 *
 * 3 状態:
 *   "proceed"       — 緑色チェック + 「残量十分です」
 *   "warn_overage"  — 黄色警告 + 「超過 N 分 → ¥XXX の見込み」+ 2 ボタン
 *   "upgrade"       — 赤色アイコン + 「翻訳分数が不足しています」+ アップグレードボタン
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import type { PreCallCostEstimate as PreCallCostEstimateType } from "@trancall/billing/client";

export interface PreCallCostEstimateProps {
  /** 見積通話時間 (分) */
  estimatedMinutes: number;
  /** 予測コスト (円) - 超過分のみ */
  estimatedCostYen: number;
  /** 現在の残量 (分) */
  remainingMinutes: number;
  /** 推奨アクション */
  recommendedAction: PreCallCostEstimateType["recommendedAction"];
  /** アップグレード画面へのナビゲーションハンドラー */
  onUpgradePress: () => void;
  /** 通話開始ハンドラー (warn_overage 時の「このまま開始」) */
  onProceedPress: () => void;
}

export function PreCallCostEstimate({
  estimatedMinutes,
  estimatedCostYen,
  remainingMinutes,
  recommendedAction,
  onUpgradePress,
  onProceedPress,
}: PreCallCostEstimateProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const overageMinutes = Math.max(0, estimatedMinutes - remainingMinutes);

  if (recommendedAction === "proceed") {
    return (
      <View
        style={[
          styles.container,
          {
            borderRadius: theme.radii[12],
            backgroundColor: c.successBg,
            padding: s[16],
            borderWidth: 1,
            borderColor: c.success,
          },
        ]}
        accessibilityRole="summary"
        accessibilityLabel={t("precall.costEstimate.proceed.label")}
      >
        <Text style={[styles.title, { color: c.textSecondary }]}>
          {t("precall.costEstimate.title")}
        </Text>
        <Text
          style={[styles.stateLabel, { color: c.success, marginTop: s[4] }]}
        >
          {t("precall.costEstimate.proceed.label")}
        </Text>
        <Text
          style={[styles.detail, { color: c.textSecondary, marginTop: s[4] }]}
        >
          {t("precall.costEstimate.proceed.detail", {
            expectedMinutes: String(estimatedMinutes),
            remainingMinutes: String(remainingMinutes),
          })}
        </Text>
      </View>
    );
  }

  if (recommendedAction === "warn_overage") {
    return (
      <View
        style={[
          styles.container,
          {
            borderRadius: theme.radii[12],
            backgroundColor: c.warningBg,
            padding: s[16],
            borderWidth: 1,
            borderColor: c.warning,
          },
        ]}
        accessibilityRole="alert"
        accessibilityLabel={t("precall.costEstimate.warnOverage.label")}
      >
        <Text style={[styles.title, { color: c.textSecondary }]}>
          {t("precall.costEstimate.title")}
        </Text>
        <Text
          style={[styles.stateLabel, { color: c.warning, marginTop: s[4] }]}
        >
          {t("precall.costEstimate.warnOverage.label")}
        </Text>
        <Text
          style={[styles.detail, { color: c.textSecondary, marginTop: s[4] }]}
        >
          {t("precall.costEstimate.warnOverage.detail", {
            overageMinutes: String(overageMinutes),
            predictedCostYen: String(estimatedCostYen),
          })}
        </Text>
        <View style={[styles.buttonRow, { marginTop: s[12] }]}>
          <Pressable
            style={[
              styles.proceedButton,
              {
                borderRadius: theme.radii[8],
                borderWidth: 1,
                borderColor: c.warning,
                paddingVertical: s[8],
                paddingHorizontal: s[12],
                flex: 1,
              },
            ]}
            onPress={onProceedPress}
            accessibilityLabel={t(
              "precall.costEstimate.warnOverage.proceedButton",
            )}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.buttonText,
                { color: c.warning, textAlign: "center" },
              ]}
            >
              {t("precall.costEstimate.warnOverage.proceedButton")}
            </Text>
          </Pressable>
          <View style={{ width: s[8] }} />
          <Button
            variant="primary"
            size="sm"
            onPress={onUpgradePress}
            accessibilityLabel={t(
              "precall.costEstimate.warnOverage.upgradeButton",
            )}
          >
            {t("precall.costEstimate.warnOverage.upgradeButton")}
          </Button>
        </View>
      </View>
    );
  }

  // recommendedAction === "upgrade"
  return (
    <View
      style={[
        styles.container,
        {
          borderRadius: theme.radii[12],
          backgroundColor: c.dangerBg,
          padding: s[16],
          borderWidth: 1,
          borderColor: c.danger,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={t("precall.costEstimate.upgrade.label")}
    >
      <Text style={[styles.title, { color: c.textSecondary }]}>
        {t("precall.costEstimate.title")}
      </Text>
      <Text style={[styles.stateLabel, { color: c.danger, marginTop: s[4] }]}>
        {t("precall.costEstimate.upgrade.label")}
      </Text>
      <Text
        style={[styles.detail, { color: c.textSecondary, marginTop: s[4] }]}
      >
        {t("precall.costEstimate.upgrade.detail", {
          remainingMinutes: String(remainingMinutes),
        })}
      </Text>
      <View style={[styles.buttonRow, { marginTop: s[12] }]}>
        <Button
          variant="primary"
          size="md"
          onPress={onUpgradePress}
          accessibilityLabel={t("precall.costEstimate.upgrade.upgradeButton")}
        >
          {t("precall.costEstimate.upgrade.upgradeButton")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  title: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stateLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  detail: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  proceedButton: {},
  buttonText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
