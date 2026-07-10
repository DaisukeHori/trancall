import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/index";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  size?: AvatarSize;
  uri?: string;
  fallbackInitials?: string;
  accessibilityLabel?: string;
}

const SIZE_MAP: Record<AvatarSize, number> = {
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

const FONT_SIZE_MAP: Record<AvatarSize, number> = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 32,
};

export function Avatar({
  size = "md",
  uri,
  fallbackInitials,
  accessibilityLabel,
}: AvatarProps) {
  const theme = useTheme();
  const c = theme.colors;
  const dimension = SIZE_MAP[size];
  const fontSize = FONT_SIZE_MAP[size];

  const containerStyle = {
    width: dimension,
    height: dimension,
    borderRadius: theme.radii.full,
    backgroundColor: c.primaryBg,
    overflow: "hidden" as const,
  };

  if (uri != null && uri.length > 0) {
    return (
      <View
        style={containerStyle}
        accessible
        accessibilityLabel={accessibilityLabel ?? "Avatar"}
        accessibilityRole="image"
      >
        <Image
          source={{ uri }}
          style={styles.image}
          accessibilityLabel={accessibilityLabel ?? "User avatar"}
        />
      </View>
    );
  }

  const initials = fallbackInitials != null
    ? fallbackInitials.slice(0, 2).toUpperCase()
    : "?";

  return (
    <View
      style={[styles.fallback, containerStyle]}
      accessible
      accessibilityLabel={accessibilityLabel ?? initials}
      accessibilityRole="image"
    >
      <Text style={[styles.initials, { color: c.primary, fontSize }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: "100%",
    height: "100%",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontWeight: "600",
  },
});
