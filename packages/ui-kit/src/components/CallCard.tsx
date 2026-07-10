import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { OutputLanguage } from "@trancall/shared-kernel";
import { Avatar } from "./Avatar";
import { useTheme } from "../theme/index";

export interface CallCardProps {
  name: string;
  avatarUri?: string;
  fromLanguage: OutputLanguage;
  toLanguage: OutputLanguage;
  durationSeconds: number;
  costYen?: number;
  missed?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallCard({
  name,
  avatarUri,
  fromLanguage,
  toLanguage,
  durationSeconds,
  costYen,
  missed = false,
  onPress,
  accessibilityLabel,
}: CallCardProps) {
  const theme = useTheme();
  const c = theme.colors;

  const label =
    accessibilityLabel ??
    `${missed ? "Missed call" : "Call"} with ${name}, ${fromLanguage} to ${toLanguage}, ${formatDuration(durationSeconds)}`;

  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.container,
        {
          borderBottomColor: c.border,
          minHeight: 64,
        },
      ]}
    >
      <Avatar
        size="md"
        {...(avatarUri != null ? { uri: avatarUri } : {})}
        fallbackInitials={name.slice(0, 2)}
        accessibilityLabel={name}
      />
      <View style={styles.info}>
        <Text
          style={[
            styles.name,
            {
              color: missed ? c.danger : c.textPrimary,
              fontSize: theme.typography.body.fontSize,
            },
          ]}
        >
          {name}
        </Text>
        <Text style={[styles.sub, { color: c.textSecondary, fontSize: 13 }]}>
          {fromLanguage} → {toLanguage}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.duration, { color: c.textSecondary, fontSize: 13 }]}>
          {formatDuration(durationSeconds)}
        </Text>
        {costYen != null && (
          <Text style={[styles.cost, { color: c.textTertiary, fontSize: 12 }]}>
            ¥{costYen}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontWeight: "500",
  },
  sub: {
    marginTop: 2,
  },
  right: {
    alignItems: "flex-end",
  },
  duration: {
    fontVariant: ["tabular-nums"],
  },
  cost: {
    marginTop: 2,
  },
});
