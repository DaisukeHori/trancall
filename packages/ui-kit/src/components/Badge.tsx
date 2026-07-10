import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/index.ts";

export type BadgeVariant = "default" | "success" | "warning" | "danger";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export function Badge({ variant = "default", children }: BadgeProps) {
  const theme = useTheme();
  const c = theme.colors;

  const bgColorMap: Record<BadgeVariant, string> = {
    default: c.primaryBg,
    success: c.successBg,
    warning: c.warningBg,
    danger: c.dangerBg,
  };

  const textColorMap: Record<BadgeVariant, string> = {
    default: c.primary,
    success: c.success,
    warning: c.warning,
    danger: c.danger,
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: bgColorMap[variant],
          borderRadius: theme.radii.full,
        },
      ]}
      accessibilityRole="text"
    >
      <Text
        style={[
          styles.text,
          {
            color: textColorMap[variant],
            fontSize: theme.typography.caption.fontSize,
          },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  text: {
    fontWeight: "500",
  },
});
