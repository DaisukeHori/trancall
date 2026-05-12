/**
 * HomeBalanceBanner — SCR-002 Home 画面ヘッダー下部の残量バナー
 *
 * docs/billing-ui-flow.md §10.2.1 / §10.2.2 / §10.2.3 準拠
 * BILL-008 要件: Home 画面に残量を常時表示する
 *
 * 色閾値:
 *   > 30 分: primary (通常)
 *   10–30 分: warning
 *   1–9 分: danger (critical)
 *   0 分 (depleted): warning + 超過料金表示
 */

import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useTheme } from "@trancall/ui-kit";
import { PLAN_CONFIGS } from "@trancall/billing";
import { useTranslation } from "../i18n/index.js";
import { useBillingStore } from "../stores/billing-store.js";
import type { MainTabParamList } from "../navigation/main-tabs.js";

// ---------------------------------------------------------------------------
// 色閾値ロジック (テスト対象)
// ---------------------------------------------------------------------------

export type BalanceTier = "normal" | "warning" | "critical" | "depleted";

/**
 * 残量分数から色閾値を返す。
 * docs/billing-ui-flow.md §10.2.2 / T-16 仕様
 *   > 30 min → "normal"
 *   10–30 min → "warning"
 *   1–9 min → "critical"
 *   0 min → "depleted"
 */
export function getBalanceTier(remainingMinutes: number): BalanceTier {
  if (remainingMinutes <= 0) return "depleted";
  if (remainingMinutes < 10) return "critical";
  if (remainingMinutes <= 30) return "warning";
  return "normal";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type NavigationProp = BottomTabNavigationProp<MainTabParamList>;

export const HomeBalanceBanner: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;
  const navigation = useNavigation<NavigationProp>();

  const subscriptionState = useBillingStore((state) => state.subscriptionState);

  if (subscriptionState == null) {
    // ロード中: 薄いプレースホルダー表示
    return (
      <View
        style={[
          styles.skeleton,
          {
            backgroundColor: c.bgSecondary,
            borderRadius: theme.radii[12],
            marginHorizontal: s[16],
            marginBottom: s[8],
          },
        ]}
        accessibilityLabel={t("common.loading")}
      />
    );
  }

  const tier = subscriptionState.plan.tier;
  const remaining = subscriptionState.remainingMinutes;
  const balanceTier = getBalanceTier(remaining);
  const overageRate = PLAN_CONFIGS[tier].overageRateYen;

  // 色マッピング
  const bgColorMap: Record<BalanceTier, string> = {
    normal: c.primaryBg,
    warning: c.warningBg,
    critical: c.dangerBg,
    depleted: c.warningBg,
  };
  const textColorMap: Record<BalanceTier, string> = {
    normal: c.primary,
    warning: c.warning,
    critical: c.danger,
    depleted: c.warning,
  };
  const borderColorMap: Record<BalanceTier, string> = {
    normal: c.primary,
    warning: c.warning,
    critical: c.danger,
    depleted: c.warning,
  };

  const bgColor = bgColorMap[balanceTier];
  const textColor = textColorMap[balanceTier];
  const borderColor = borderColorMap[balanceTier];

  // 次回更新日フォーマット (YYYY-MM-DD)
  const nextBillingDate = new Date(
    subscriptionState.currentPeriodEnd,
  ).toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const handlePress = () => {
    navigation.navigate("Settings");
  };

  return (
    <TouchableOpacity
      accessibilityLabel={t("billing.balance.managePlan")}
      accessibilityRole="button"
      onPress={handlePress}
      activeOpacity={0.8}
      style={[
        styles.banner,
        {
          backgroundColor: bgColor,
          borderColor,
          borderRadius: theme.radii[12],
          marginHorizontal: s[16],
          marginBottom: s[8],
          padding: s[12],
        },
      ]}
    >
      {/* 残量テキスト */}
      {balanceTier === "depleted" ? (
        <Text
          style={[styles.remainingText, { color: textColor }]}
          numberOfLines={1}
        >
          {t("billing.balance.depleted", { overageRate: String(overageRate) })}
        </Text>
      ) : (
        <Text
          style={[styles.remainingText, { color: textColor }]}
          numberOfLines={1}
        >
          {t("billing.balance.remaining", {
            minutes: String(remaining),
            plan: tier,
          })}
        </Text>
      )}

      {/* プランラベル + 次回更新日 */}
      <View style={styles.subRow}>
        <Text style={[styles.planLabel, { color: textColor }]}>
          {t(`billing.balance.${tier}` as const)}
        </Text>
        {tier !== "free" && (
          <Text style={[styles.nextBilling, { color: textColor }]}>
            {"  "}
            {t("billing.balance.nextBilling", { date: nextBillingDate })}
          </Text>
        )}
      </View>

      {/* 管理ボタンラベル */}
      <Text style={[styles.cta, { color: textColor }]}>
        {t("billing.balance.managePlan")} {"▶"}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    height: 72,
  },
  banner: {
    borderWidth: 1,
  },
  remainingText: {
    fontSize: 16,
    fontWeight: "600",
  },
  subRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 2,
  },
  planLabel: {
    fontSize: 13,
    fontWeight: "400",
  },
  nextBilling: {
    fontSize: 13,
    fontWeight: "400",
  },
  cta: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
    textAlign: "right",
  },
});
