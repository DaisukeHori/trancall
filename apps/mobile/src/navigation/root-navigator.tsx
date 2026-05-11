import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { useTheme } from "@trancall/ui-kit";
import { useAuthStore, selectIsAuthenticated } from "../stores/auth-store.js";
import { AuthStack } from "./auth-stack.js";
import { MainTabs } from "./main-tabs.js";

export function RootNavigator() {
  const theme = useTheme();
  const c = theme.colors;

  const restore = useAuthStore((state) => state.restore);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bgPrimary }}
        accessibilityLabel="読み込み中"
        accessibilityRole="none"
      >
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
