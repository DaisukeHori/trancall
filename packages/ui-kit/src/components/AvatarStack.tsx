import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "./Avatar.tsx";
import { useTheme } from "../theme/index.ts";

export interface AvatarStackItem {
  uri?: string;
  fallbackInitials?: string;
  accessibilityLabel?: string;
}

export interface AvatarStackProps {
  items: readonly AvatarStackItem[];
  maxVisible?: number;
}

/**
 * Calculates how many avatars to show and the overflow count.
 * Pure function, separated for testability.
 */
export function calcAvatarStackDisplay(
  totalCount: number,
  maxVisible: number,
): { visibleCount: number; overflowCount: number } {
  if (totalCount <= maxVisible) {
    return { visibleCount: totalCount, overflowCount: 0 };
  }
  return { visibleCount: maxVisible - 1, overflowCount: totalCount - (maxVisible - 1) };
}

export function AvatarStack({ items, maxVisible = 3 }: AvatarStackProps) {
  const theme = useTheme();
  const c = theme.colors;

  const { visibleCount, overflowCount } = calcAvatarStackDisplay(
    items.length,
    maxVisible,
  );

  const visibleItems = items.slice(0, visibleCount);

  return (
    <View
      style={styles.container}
      accessibilityLabel={`${String(items.length)} participants`}
      accessibilityRole="none"
    >
      {visibleItems.map((item, index) => (
        <View
          key={index}
          style={[
            styles.avatarWrapper,
            {
              marginLeft: index > 0 ? -8 : 0,
              zIndex: visibleCount - index,
              borderColor: c.bgPrimary,
            },
          ]}
        >
          <Avatar
            size="sm"
            {...(item.uri != null ? { uri: item.uri } : {})}
            {...(item.fallbackInitials != null ? { fallbackInitials: item.fallbackInitials } : {})}
            {...(item.accessibilityLabel != null ? { accessibilityLabel: item.accessibilityLabel } : {})}
          />
        </View>
      ))}
      {overflowCount > 0 && (
        <View
          style={[
            styles.avatarWrapper,
            styles.overflow,
            {
              marginLeft: -8,
              backgroundColor: c.primaryBg,
              borderColor: c.bgPrimary,
              borderRadius: theme.radii.full,
              zIndex: 0,
            },
          ]}
          accessibilityLabel={`+${String(overflowCount)} more`}
          accessibilityRole="text"
        >
          <Text style={[styles.overflowText, { color: c.primary }]}>
            +{String(overflowCount)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrapper: {
    borderWidth: 2,
    borderRadius: 9999,
  },
  overflow: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
