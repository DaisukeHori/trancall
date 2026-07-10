/**
 * CostSummary — 通話終了後のコストサマリーカード
 *
 * docs/billing-ui-flow.md §10.3 (CostSummary UI canonical) 準拠
 * SCR-011 Call Summary 画面に埋め込む。
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CostSummaryProps {
  /** 通話時間（秒） */
  durationSeconds: number;
  /** 基本料金（円）: プラン含有分内に収まった場合は 0 */
  baseCostYen: number;
  /** 超過料金（円）: 超過なしの場合は undefined または 0 */
  overageCostYen?: number;
  /** 合計コスト（円）*/
  totalCostYen: number;
  /** 現在のプラン名 */
  plan: string;
  /** 「次回プラン提案」リンクを表示するか（超過あり等、プラン見直しを促す場合） */
  showUpgradeSuggestion?: boolean;
  /** 「次回プラン提案」タップ時のコールバック */
  onUpgradeSuggestionPress?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 秒数を mm:ss 形式にフォーマット */
function formatDurationSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** 金額を ¥1,234 形式にフォーマット */
function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostSummary({
  durationSeconds,
  baseCostYen,
  overageCostYen,
  totalCostYen,
  plan,
  showUpgradeSuggestion = false,
  onUpgradeSuggestionPress,
}: CostSummaryProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const hasOverage =
    overageCostYen != null && overageCostYen > 0;
  const durationFormatted = formatDurationSeconds(durationSeconds);

  return (
    <Card padding={s[16]}>
      {/* カードタイトル */}
      <Text
        style={[styles.cardTitle, { color: c.textSecondary, marginBottom: s[12] }]}
        accessibilityRole="header"
      >
        {t("callSummary.costSummary.title")}
      </Text>

      <View style={{ gap: s[8] }}>
        {/* 通話時間 */}
        <View style={styles.row} accessibilityRole="text">
          <Text style={[styles.label, { color: c.textSecondary }]}>
            {t("callSummary.costSummary.callDuration")}
          </Text>
          <Text
            style={[styles.monoValue, { color: c.textPrimary }]}
            accessibilityLabel={`${t("callSummary.costSummary.callDuration")}: ${durationFormatted}`}
          >
            {durationFormatted}
          </Text>
        </View>

        {/* 基本料 */}
        <View style={styles.row} accessibilityRole="text">
          <Text style={[styles.label, { color: c.textSecondary }]}>
            {t("callSummary.costSummary.baseCost")}
          </Text>
          <Text style={[styles.monoValue, { color: c.textPrimary }]}>
            {baseCostYen === 0
              ? t("callSummary.costSummary.includedInPlan")
              : formatYen(baseCostYen)}
          </Text>
        </View>

        {/* 超過料金（超過がある場合のみ表示） */}
        {hasOverage && (
          <View style={styles.row} accessibilityRole="text">
            <Text style={[styles.label, { color: c.textSecondary }]}>
              {t("callSummary.costSummary.overageCost")}
            </Text>
            <Text
              style={[styles.monoValue, { color: c.danger }]}
            >
              {formatYen(overageCostYen)}
            </Text>
          </View>
        )}

        {/* 区切り線 */}
        <View style={[styles.divider, { backgroundColor: c.border }]} />

        {/* 合計（太字・強調） */}
        <View style={styles.row} accessibilityRole="text">
          <Text style={[styles.totalLabel, { color: c.textPrimary }]}>
            {t("callSummary.costSummary.totalCost")}
          </Text>
          <Text
            style={[
              styles.totalValue,
              { color: hasOverage ? c.danger : c.textPrimary },
            ]}
            accessibilityLabel={`${t("callSummary.costSummary.totalCost")}: ${formatYen(totalCostYen)}`}
          >
            {totalCostYen === 0
              ? t("callSummary.costSummary.includedInPlan")
              : formatYen(totalCostYen)}
          </Text>
        </View>

        {/* 次回プラン提案リンク（該当時のみ） */}
        {showUpgradeSuggestion && onUpgradeSuggestionPress != null && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("callSummary.costSummary.upgradeSuggestion")}
            onPress={onUpgradeSuggestionPress}
            style={[styles.upgradeLink, { marginTop: s[4] }]}
          >
            <Text style={[styles.upgradeLinkText, { color: c.primary }]}>
              {t("callSummary.costSummary.upgradeSuggestion")}
            </Text>
          </Pressable>
        )}
      </View>

      {/* プラン名表示 */}
      <Text
        style={[styles.planLabel, { color: c.textSecondary, marginTop: s[8] }]}
        accessibilityRole="text"
      >
        {plan}
      </Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "400",
    flex: 1,
  },
  monoValue: {
    fontSize: 14,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
    textAlign: "right",
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  totalValue: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
    textAlign: "right",
  },
  divider: {
    height: 1,
    opacity: 0.2,
    marginVertical: 4,
  },
  upgradeLink: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  upgradeLinkText: {
    fontSize: 14,
    fontWeight: "500",
  },
  planLabel: {
    fontSize: 12,
    fontWeight: "400",
  },
});
