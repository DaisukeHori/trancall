import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "@trancall/ui-kit";
import { SettingsScreen } from "../screens/settings-screen.js";
import { FaqScreen } from "../screens/faq-screen.js";
import { OssLicensesScreen } from "../screens/oss-licenses-screen.js";
import { AccountDeletionScreen } from "../screens/account-deletion-screen.js";
import { useTranslation } from "../i18n/index.js";

export type SettingsStackParamList = {
  SettingsMain: undefined;
  Faq: undefined;
  OssLicenses: undefined;
  AccountDeletion: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SettingsMain" component={SettingsScreen} />
      <Stack.Screen name="Faq" component={FaqScreen} />
      <Stack.Screen
        name="OssLicenses"
        component={OssLicensesScreen}
        options={{
          headerShown: true,
          title: t("oss.title"),
          headerStyle: { backgroundColor: c.bgSecondary },
          headerTintColor: c.primary,
          headerTitleStyle: { color: c.textPrimary },
        }}
      />
      <Stack.Screen name="AccountDeletion" component={AccountDeletionScreen} />
    </Stack.Navigator>
  );
}
