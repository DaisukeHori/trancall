import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../theme/index.ts";

export interface PlanCardProps {
  planName: string;
  priceYen: number;
  includedMinutes: number;
  isSelected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export function PlanCard({
  planName,
  priceYen,
  includedMinutes,
  isSelected = false,
  onPress,
  accessibilityLabel,
}: PlanCardProps) {
  const theme = useTheme();
  const c = theme.colors;

  const label =
    accessibilityLabel ??
    `${planName} plan, ¥${String(priceYen)} per month, ${String(includedMinutes)} minutes included${isSelected ? ", currently selected" : ""}`;

  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[
        styles.container,
        {
          borderRadius: theme.radii[12],
          borderColor: isSelected ? c.primary : c.border,
          borderWidth: isSelected ? 2 : 1,
          backgroundColor: isSelected ? c.primaryBg : c.bgPrimary,
          padding: theme.spacing[16],
          minHeight: 80,
        },
      ]}
    >
      <View style={styles.row}>
        <Text
          style={[
            styles.planName,
            {
              color: c.textPrimary,
              fontSize: theme.typography.heading2.fontSize,
            },
          ]}
        >
          {planName}
        </Text>
        {isSelected && (
          <View
            style={[
              styles.badge,
              { backgroundColor: c.primary, borderRadius: theme.radii.full },
            ]}
          >
            <Text style={[styles.badgeText, { color: c.textOnColor }]}>✓</Text>
          </View>
        )}
      </View>
      <View style={styles.row}>
        <Text
          style={[
            styles.price,
            { color: c.primary, fontSize: 24 },
          ]}
        >
          ¥{priceYen.toLocaleString()}
          <Text style={[styles.priceSuffix, { color: c.textSecondary }]}>
            /月
          </Text>
        </Text>
      </View>
      <Text style={[styles.minutes, { color: c.textSecondary, fontSize: 14 }]}>
        {includedMinutes}分 含む
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planName: {
    fontWeight: "600",
    marginBottom: 4,
  },
  price: {
    fontWeight: "700",
    marginBottom: 4,
  },
  priceSuffix: {
    fontSize: 14,
    fontWeight: "400",
  },
  minutes: {
    marginTop: 2,
  },
  badge: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "700",
  },
});
