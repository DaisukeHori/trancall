import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@trancall/ui-kit";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
}

export function EmptyState({ title, subtitle }: EmptyStateProps) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <View style={styles.container} accessibilityRole="none">
      <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
      {subtitle != null && subtitle.length > 0 && (
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>{subtitle}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
