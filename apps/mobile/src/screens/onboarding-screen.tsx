// SCR-001 — Onboarding: 13-language grid for native language selection
import React, { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, LANGUAGE_LIST, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useAuthStore } from "../stores/auth-store.js";
import type { OutputLanguage } from "@trancall/shared-kernel";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../navigation/auth-stack.js";

type Props = NativeStackScreenProps<AuthStackParamList, "Onboarding">;

export function OnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const setPreferredLanguage = useAuthStore((state) => state.setPreferredLanguage);
  const [selected, setSelected] = useState<OutputLanguage>("ja");

  const handleContinue = () => {
    setPreferredLanguage(selected);
    navigation.replace("Login");
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[styles.wordmark, { color: c.textPrimary }]}
            accessibilityRole="header"
          >
            {t("onboarding.title")}
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {t("onboarding.subtitle")}
          </Text>
        </View>

        {/* Language selection prompt */}
        <Text
          style={[styles.chooseLabel, { color: c.textSecondary, marginTop: s[32] }]}
        >
          {t("onboarding.chooseLanguage")}
        </Text>

        {/* 13-language grid (3 columns) */}
        <View style={[styles.grid, { marginTop: s[12] }]}>
          {LANGUAGE_LIST.map((lang) => {
            const isSelected = selected === lang.code;
            return (
              <Pressable
                key={lang.code}
                accessibilityLabel={`${lang.englishName} (${lang.nativeName})`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => { setSelected(lang.code); }}
                style={[
                  styles.langCell,
                  {
                    borderRadius: theme.radii[12],
                    borderWidth: isSelected ? 2 : StyleSheet.hairlineWidth,
                    borderColor: isSelected ? c.primary : c.border,
                    backgroundColor: isSelected ? c.primaryBg : c.bgPrimary,
                  },
                ]}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.langName,
                    {
                      color: isSelected ? c.primary : c.textPrimary,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {lang.nativeName}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Powered by note */}
        <Text
          style={[
            styles.poweredBy,
            { color: c.textTertiary, marginTop: s[16] },
          ]}
        >
          {t("onboarding.poweredBy")}
        </Text>

        {/* Continue button */}
        <View style={[styles.footer, { marginTop: s[16] }]}>
          <Button
            variant="primary"
            size="lg"
            accessibilityLabel={t("common.next")}
            onPress={handleContinue}
          >
            {t("common.next")}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingTop: 48,
    paddingBottom: 32,
  },
  header: {
    alignItems: "center",
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    marginTop: 6,
    textAlign: "center",
  },
  chooseLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  langCell: {
    width: "31%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 64,
    gap: 4,
  },
  flag: {
    fontSize: 22,
    lineHeight: 26,
  },
  langName: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  poweredBy: {
    fontSize: 11,
    textAlign: "center",
  },
  footer: {
    gap: 8,
  },
});
