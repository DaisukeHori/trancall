// Placeholder screens for MainTabs — fully implemented in Layer 4-B/C
import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";

function PlaceholderScreen({ title }: { readonly title: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bgPrimary }]}>
      <View style={styles.inner}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.textPrimary }]}
        >
          {title}
        </Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>
          {t("dev.notImplementedYet")}
        </Text>
      </View>
    </SafeAreaView>
  );
}

export function HomeScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("home.recentCalls")} />;
}

export function ContactsScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("contacts.title")} />;
}

export function SettingsScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("settings.title")} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  sub: {
    fontSize: 14,
  },
});
