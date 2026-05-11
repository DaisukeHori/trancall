/**
 * StatsCard — call summary info card (duration / cost / remaining)
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, useTheme } from "@trancall/ui-kit";

export interface StatsCardProps {
  title: string;
  children: React.ReactNode;
}

export function StatsCard({ title, children }: StatsCardProps) {
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <Card padding={s[16]}>
      <Text
        style={[styles.title, { color: c.textSecondary, marginBottom: s[12] }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={{ gap: s[8] }}>{children}</View>
    </Card>
  );
}

export interface StatsRowProps {
  label: string;
  value: string;
  valueStyle?: object;
}

export function StatsRow({ label, value, valueStyle }: StatsRowProps) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <View style={styles.row} accessibilityRole="text">
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: c.textPrimary }, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
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
  value: {
    fontSize: 14,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    fontFamily: "monospace",
    textAlign: "right",
  },
});
