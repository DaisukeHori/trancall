// Login screen — email + password Supabase Auth
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Input, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useAuthStore } from "../stores/auth-store.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../navigation/auth-stack.js";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const login = useAuthStore((state) => state.login);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [authError, setAuthError] = useState<string | undefined>(undefined);

  const validateFields = (): boolean => {
    let valid = true;
    if (!isValidEmail(email)) {
      setEmailError(t("auth.email") + "が正しくありません");
      valid = false;
    } else {
      setEmailError(undefined);
    }
    if (password.length < 8) {
      setPasswordError("パスワードは8文字以上です");
      valid = false;
    } else {
      setPasswordError(undefined);
    }
    return valid;
  };

  const handleLogin = async () => {
    setAuthError(undefined);
    if (!validateFields()) return;

    const result = await login(email, password);
    if (!result.ok) {
      // Use error message from the result directly (i18n key lookup is handled in error store in 4-B)
      setAuthError(result.error.message);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingHorizontal: s[24] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text
              style={[styles.wordmark, { color: c.textPrimary }]}
              accessibilityRole="header"
            >
              TranCall
            </Text>
            <Text style={[styles.tagline, { color: c.textSecondary }]}>
              {t("onboarding.subtitle")}
            </Text>
          </View>

          <View style={styles.spacer} />

          {/* Form */}
          <View style={[styles.form, { gap: s[12] }]}>
            <Input
              label={t("auth.email")}
              placeholder="you@example.com"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setAuthError(undefined);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              error={emailError}
            />

            <Input
              label={t("auth.password")}
              placeholder="••••••••"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setAuthError(undefined);
              }}
              secureTextEntry
              textContentType="password"
              error={passwordError}
            />

            {authError != null && (
              <Text
                accessibilityRole="alert"
                style={[styles.authError, { color: c.danger }]}
              >
                {authError}
              </Text>
            )}

            <Button
              variant="primary"
              size="lg"
              accessibilityLabel={t("auth.signIn")}
              onPress={() => { void handleLogin(); }}
              loading={isLoading}
            >
              {t("auth.signIn")}
            </Button>

            <Pressable
              accessibilityLabel={t("auth.signUp")}
              accessibilityRole="link"
              onPress={() => { navigation.navigate("SignUp"); }}
              style={styles.linkContainer}
            >
              <Text style={[styles.link, { color: c.primary }]}>
                {t("auth.signUp")}
              </Text>
            </Pressable>
          </View>

          {/* Legal */}
          <Text style={[styles.legal, { color: c.textTertiary, marginTop: s[16] }]}>
            {t("consent.title")}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  container: {
    paddingTop: 64,
    paddingBottom: 32,
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    textAlign: "center",
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 22,
  },
  spacer: {
    flex: 1,
    minHeight: 32,
  },
  form: {
    width: "100%",
  },
  authError: {
    fontSize: 13,
    textAlign: "center",
  },
  linkContainer: {
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  link: {
    fontSize: 14,
    fontWeight: "600",
  },
  legal: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
