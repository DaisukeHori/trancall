import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Avatar } from "./Avatar.js";
import { useTheme } from "../theme/index.js";
import { useTranslation } from "../i18n/index.js";

export interface ContactRowProps {
  name: string;
  trancallId: string;
  avatarUri?: string;
  isFavorite?: boolean;
  onPress?: () => void;
  onFavoritePress?: () => void;
  accessibilityLabel?: string;
}

export function ContactRow({
  name,
  trancallId,
  avatarUri,
  isFavorite = false,
  onPress,
  onFavoritePress,
  accessibilityLabel,
}: ContactRowProps) {
  const theme = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel ?? `${name}, ${trancallId}`}
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
              color: c.textPrimary,
              fontSize: theme.typography.body.fontSize,
            },
          ]}
        >
          {name}
        </Text>
        <Text style={[styles.id, { color: c.textSecondary, fontSize: 13 }]}>
          {trancallId}
        </Text>
      </View>
      <TouchableOpacity
        accessibilityLabel={isFavorite ? t("contactProfile.unfavorite") : t("contactProfile.favorite")}
        accessibilityRole="button"
        accessibilityState={{ selected: isFavorite }}
        onPress={onFavoritePress}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        style={styles.star}
      >
        <Text style={{ fontSize: 20, color: isFavorite ? c.warning : c.border }}>
          {isFavorite ? "★" : "☆"}
        </Text>
      </TouchableOpacity>
      <Text style={[styles.chevron, { color: c.textTertiary }]}>›</Text>
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
  id: {
    marginTop: 2,
  },
  star: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: {
    fontSize: 20,
    marginLeft: 4,
  },
});
