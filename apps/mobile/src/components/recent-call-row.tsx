// RecentCallRow — moved from _design-ref/components/CallRow.jsx to RN
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar, Badge, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import type { RecentCallEntry } from "../stores/recent-calls-store.js";

interface RecentCallRowProps {
  call: RecentCallEntry;
  onPress?: () => void;
  onLongPress?: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    // Yesterday
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function RecentCallRow({ call, onPress, onLongPress }: RecentCallRowProps) {
  const theme = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  const initials = call.contactDisplayName.slice(0, 2);

  return (
    <Pressable
      accessibilityLabel={`${call.contactDisplayName}, ${call.missed ? t("home.missed") : formatDuration(call.durationSeconds)}`}
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.container,
        {
          borderBottomColor: c.border,
          backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
        },
      ]}
    >
      <Avatar
        size="md"
        {...(call.contactAvatarUrl != null ? { uri: call.contactAvatarUrl } : {})}
        fallbackInitials={initials}
        accessibilityLabel={call.contactDisplayName}
      />
      <View style={styles.info}>
        <Text
          style={[styles.name, { color: call.missed ? c.danger : c.textPrimary }]}
          numberOfLines={1}
        >
          {call.contactDisplayName}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: c.textSecondary }]}>
            {call.direction === "inbound" ? "↓ " : "↑ "}
            {formatDuration(call.durationSeconds)}
          </Text>
          {call.translationEnabled &&
            call.fromLanguage != null &&
            call.toLanguage != null && (
              <Badge variant="default">
                {call.fromLanguage.toUpperCase()} → {call.toLanguage.toUpperCase()}
              </Badge>
            )}
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.time, { color: c.textTertiary }]}>
          {formatTime(call.startedAt)}
        </Text>
        {call.costYen > 0 && (
          <Text style={[styles.cost, { color: c.textSecondary }]}>
            ¥{call.costYen}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "500",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 13,
  },
  right: {
    alignItems: "flex-end",
    gap: 2,
  },
  time: {
    fontSize: 12,
  },
  cost: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
});
