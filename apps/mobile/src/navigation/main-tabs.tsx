import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { RecentStack } from "./recent-stack.js";
import { ContactsStack } from "./contacts-stack.js";
import { SettingsStack } from "./settings-stack.js";

export type MainTabParamList = {
  Home: undefined;
  Contacts: undefined;
  Settings: undefined;
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
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsStack}
        options={{
          tabBarLabel: t("contacts.title"),
          tabBarAccessibilityLabel: t("contacts.title"),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStack}
        options={{
          tabBarLabel: t("settings.title"),
          tabBarAccessibilityLabel: t("settings.title"),
        }}
      />
    </Tab.Navigator>
  );
}
