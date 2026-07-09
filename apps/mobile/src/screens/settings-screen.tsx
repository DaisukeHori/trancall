// SCR-006 — Settings: Profile / Translation / Plan / Notifications / About / Account
import React, { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { Avatar, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useAuthStore } from "../stores/auth-store.js";
import type { SettingsStackParamList } from "../navigation/settings-stack.js";

type SettingsNavigationProp = NativeStackNavigationProp<SettingsStackParamList, "SettingsMain">;

// expo-application for app version
function extractNativeVersion(mod: unknown): string {
  if (mod !== null && typeof mod === "object" && "nativeApplicationVersion" in mod) {
    const entry = Object.entries(mod).find(([k]) => k === "nativeApplicationVersion");
    const ver = entry?.[1];
    if (typeof ver === "string") return ver;
  }
  return "1.0.0";
}

function getAppVersion(): string {
  try {
    // Dynamic require is intentional: expo-application is optional at build time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return extractNativeVersion(require("expo-application"));
  } catch {
    return "1.0.0";
  }
}

const appVersion = getAppVersion();

function SectionHeader({ children }: { readonly children: string }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Text style={[settingsStyles.sectionHeader, { color: c.textSecondary }]}>
      {children.toUpperCase()}
    </Text>
  );
}

interface SettingsRowProps {
  label: string;
  value?: string;
  mono?: boolean;
  toggle?: boolean;
  toggleValue?: boolean;
  onToggleChange?: (val: boolean) => void;
  chevron?: boolean;
  danger?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

function SettingsRow({
  label,
  value,
  mono,
  toggle,
  toggleValue,
  onToggleChange,
  chevron,
  danger,
  onPress,
  accessibilityLabel,
  testID,
}: SettingsRowProps) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <Pressable
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityState={toggle ? { checked: toggleValue } : undefined}
      onPress={onPress}
      disabled={onPress == null && !toggle}
      style={({ pressed }) => [
        settingsStyles.row,
        { borderBottomColor: c.border, backgroundColor: pressed && onPress != null ? c.bgSecondary : c.bgPrimary },
      ]}
    >
      <Text
        style={[
          settingsStyles.rowLabel,
          { color: danger === true ? c.danger : c.textPrimary },
        ]}
      >
        {label}
      </Text>
      {toggle === true ? (
        <Switch
          value={toggleValue}
          onValueChange={onToggleChange}
          trackColor={{ false: c.bgTertiary, true: c.success }}
          thumbColor={Platform.OS === "ios" ? undefined : c.subtitleText}
          accessibilityLabel={label}
        />
      ) : (
        <View style={settingsStyles.rowRight}>
          {value != null && (
            <Text
              style={[
                settingsStyles.rowValue,
                {
                  color: c.textSecondary,
                  fontFamily: mono === true ? "monospace" : undefined,
                },
              ]}
            >
              {value}
            </Text>
          )}
          {chevron === true && (
            <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
          )}
        </View>
      )}
    </Pressable>
  );
}

function SettingsGroup({ children }: { readonly children: React.ReactNode }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View
      style={[
        settingsStyles.group,
        { backgroundColor: c.bgPrimary, borderColor: c.border, borderRadius: theme.radii[12] },
      ]}
    >
      {children}
    </View>
  );
}

type Props = NativeStackScreenProps<SettingsStackParamList, "SettingsMain">;

export function SettingsScreen(_props: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;
  const navigation = useNavigation<SettingsNavigationProp>();

  const profile = useAuthStore((state) => state.profile);
  const logout = useAuthStore((state) => state.logout);

  const [showSubtitles, setShowSubtitles] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);

  const handleSignOut = () => {
    Alert.alert(
      t("settings.danger.signOutConfirmTitle"),
      t("settings.danger.signOutConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("auth.signOut"),
          style: "destructive",
          onPress: () => { void logout(); },
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    navigation.navigate("AccountDeletion");
  };

  const displayName = profile?.display_name ?? t("common.unknown");
  const trancallId = profile?.id ? `@${profile.id.slice(0, 8)}` : "--";
  const nativeLanguage = profile?.native_language ?? "ja";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[16] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.textPrimary }]}
        >
          {t("settings.title")}
        </Text>

        {/* Profile avatar area */}
        <View style={[styles.avatarArea, { paddingVertical: s[16] }]}>
          <Avatar
            size="xl"
            {...(profile?.avatar_url != null ? { uri: profile.avatar_url } : {})}
            fallbackInitials={displayName.slice(0, 2)}
            accessibilityLabel={displayName}
          />
          <Text style={[styles.profileName, { color: c.textPrimary, marginTop: s[8] }]}>
            {displayName}
          </Text>
          <Text style={[styles.profileId, { color: c.textSecondary }]}>
            {trancallId}
          </Text>
        </View>

        {/* Section: Profile */}
        <SectionHeader>{t("settings.profile")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.displayName")}
            value={displayName}
          />
          <SettingsRow
            label={t("settings.trancallId")}
            value={trancallId}
            mono
          />
          <SettingsRow
            testID="settings-nativeLanguage-row"
            label={t("settings.nativeLanguage")}
            value={t(`language.${nativeLanguage}`)}
            chevron
          />
        </SettingsGroup>

        {/* Section: Translation */}
        <SectionHeader>{t("settings.translation.sectionTitle")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.translation.subtitles")}
            toggle
            toggleValue={showSubtitles}
            onToggleChange={setShowSubtitles}
          />
        </SettingsGroup>

        {/* Section: Plan */}
        <SectionHeader>{t("settings.planSection.sectionTitle")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.planSection.manage")}
            chevron
            onPress={() => { navigation.navigate("Subscription"); }}
            accessibilityLabel={t("settings.planSection.manage")}
          />
        </SettingsGroup>

        {/* Section: Notifications */}
        <SectionHeader>{t("settings.notificationsSection.sectionTitle")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.notificationsSection.push")}
            toggle
            toggleValue={pushEnabled}
            onToggleChange={setPushEnabled}
          />
        </SettingsGroup>

        {/* Section: About */}
        <SectionHeader>{t("settings.aboutSection.sectionTitle")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.aboutSection.version")}
            value={appVersion}
          />
          <SettingsRow
            label={t("settings.aboutSection.terms")}
            chevron
          />
          <SettingsRow
            label={t("settings.aboutSection.privacy")}
            chevron
          />
          <SettingsRow
            label={t("settings.aboutSection.contact")}
            chevron
            onPress={() => { navigation.navigate("Support"); }}
            accessibilityLabel={t("settings.aboutSection.contact")}
          />
          <SettingsRow
            label={t("faq.title")}
            chevron
            onPress={() => { navigation.navigate("Faq"); }}
            accessibilityLabel={t("faq.title")}
          />
          <SettingsRow
            label={t("settings.aboutSection.ossLicenses")}
            chevron
            onPress={() => { navigation.navigate("OssLicenses"); }}
            accessibilityLabel={t("settings.aboutSection.ossLicenses")}
          />
        </SettingsGroup>

        {/* Section: Account / Danger */}
        <SectionHeader>{t("settings.danger.sectionTitle")}</SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.danger.signOut")}
            onPress={handleSignOut}
            danger
            accessibilityLabel={t("settings.danger.signOut")}
          />
          <SettingsRow
            testID="settings-deleteAccount-row"
            label={t("settings.danger.deleteAccount")}
            onPress={handleDeleteAccount}
            danger
            accessibilityLabel={t("settings.danger.deleteAccount")}
          />
        </SettingsGroup>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  avatarArea: {
    alignItems: "center",
  },
  profileName: {
    fontSize: 20,
    fontWeight: "600",
  },
  profileId: {
    fontSize: 14,
    fontFamily: "monospace",
  },
  bottomPad: {
    height: 32,
  },
});

const settingsStyles = StyleSheet.create({
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowValue: {
    fontSize: 14,
  },
  chevron: {
    fontSize: 20,
    fontWeight: "300",
  },
});
