import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { NavigatorScreenParams } from "@react-navigation/native";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { RecentStack } from "./recent-stack";
import { ContactsStack } from "./contacts-stack";
import { SettingsStack } from "./settings-stack";
import type { SettingsStackParamList } from "./settings-stack";

export type MainTabParamList = {
  Home: undefined;
  Contacts: undefined;
  // M-5: pre-call-screen.tsx / call-summary-screen.tsx から Subscription 画面へ
  // cross-stack ナビゲーションできるよう、ネストした Settings スタックの画面/params を
  // 受け取れる型にする (HomeBalanceBanner.tsx の navigate("Settings") のように
  // params なしの呼び出しも引き続き有効)。
  Settings: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const theme = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.bgPrimary,
          borderTopColor: c.border,
        },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textSecondary,
      }}
    >
      <Tab.Screen
        name="Home"
        component={RecentStack}
        options={{
          tabBarLabel: t("home.recentCalls"),
          tabBarAccessibilityLabel: t("home.recentCalls"),
          // E2E (Maestro `id:` selector, apps/mobile/e2e/maestro/flows/) — testID を
          // Maestro accessibility id として使うため、react-navigation v7 の
          // tabBarButtonTestID を明示指定する。
          tabBarButtonTestID: "tab-home",
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsStack}
        options={{
          tabBarLabel: t("contacts.title"),
          tabBarAccessibilityLabel: t("contacts.title"),
          tabBarButtonTestID: "tab-contacts",
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStack}
        options={{
          tabBarLabel: t("settings.title"),
          tabBarAccessibilityLabel: t("settings.title"),
          tabBarButtonTestID: "tab-settings",
        }}
      />
    </Tab.Navigator>
  );
}
