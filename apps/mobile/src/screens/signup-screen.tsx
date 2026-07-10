// SignUp screen — display name / email / password / nativeLanguage + consent
import React, { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
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
import { Button, Input, LanguagePicker, useTheme } from "@trancall/ui-kit";
import type { OutputLanguage } from "@trancall/shared-kernel";
import { useTranslation } from "../i18n/index";
import { resolveErrorMessage } from "../lib/error-i18n";
import { useAuthStore } from "../stores/auth-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../navigation/auth-stack";

type Props = NativeStackScreenProps<AuthStackParamList, "SignUp">;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function SignUpScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const signup = useAuthStore((state) => state.signup);
  const isLoading = useAuthStore((state) => state.isLoading);
  const preferredLanguage = useAuthStore((state) => state.preferredLanguage);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nativeLanguage, setNativeLanguage] = useState<OutputLanguage>(preferredLanguage);
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [authError, setAuthError] = useState<string | undefined>(undefined);

  const validateFields = (): boolean => {
    let valid = true;
    if (displayName.trim().length < 1) {
      setNameError(t("auth.errors.displayNameRequired"));
      valid = false;
    } else {
      setNameError(undefined);
    }
    if (!isValidEmail(email)) {
      setEmailError(t("auth.errors.emailInvalid"));
      valid = false;
    } else {
      setEmailError(undefined);
    }
    if (password.length < 8) {
      setPasswordError(t("auth.errors.passwordTooShort"));
      valid = false;
    } else {
      setPasswordError(undefined);
    }
    return valid;
  };

  const handleSignUp = async () => {
    setAuthError(undefined);
    if (!validateFields()) return;

    if (!consentAccepted) {
      setAuthError(t("auth.errors.consentRequired"));
      return;
    }

    const result = await signup(email, password, displayName.trim(), nativeLanguage, consentAccepted);
    if (!result.ok) {
      if (result.error.code === "AUTH_EMAIL_NOT_VERIFIED") {
        setAuthError(t("auth.signupVerificationEmailSent"));
      } else {
        setAuthError(resolveErrorMessage(result.error, t));
      }
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
          <Text
            style={[styles.heading, { color: c.textPrimary }]}
            accessibilityRole="header"
          >
            {t("auth.signUp")}
          </Text>

          {/* Form */}
          <View style={[styles.form, { marginTop: s[24], gap: s[12] }]}>
            <Input
              testID="displayName-input"
              label={t("auth.displayName")}
              placeholder={t("auth.placeholders.displayName")}
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                setAuthError(undefined);
              }}
              autoCorrect={false}
              textContentType="name"
              error={nameError}
            />

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
              testID="password-input"
              label={t("auth.password")}
              placeholder="••••••••"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setAuthError(undefined);
              }}
              secureTextEntry
              textContentType="newPassword"
              error={passwordError}
            />

            <LanguagePicker
              label={t("auth.nativeLanguage")}
              value={nativeLanguage}
              onChange={setNativeLanguage}
              accessibilityLabel={t("auth.nativeLanguage")}
            />

            {/* Consent checkbox */}
            <Pressable
              testID="consent-checkbox"
              accessibilityLabel={t("auth.consent.checkboxLabel")}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentAccepted }}
              onPress={() => { setConsentAccepted((v) => !v); }}
              style={[styles.consentRow, { gap: s[12] }]}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: consentAccepted ? c.primary : c.border,
                    backgroundColor: consentAccepted ? c.primary : "transparent",
                    borderRadius: theme.radii[4],
                  },
                ]}
              >
                {consentAccepted && (
                  <Ionicons name="checkmark" size={16} color={c.bgPrimary} />
                )}
              </View>
              <Text style={[styles.consentText, { color: c.textSecondary }]}>
                <Text style={{ color: c.primary }}>{t("settings.terms")}</Text>
                {t("auth.consent.and")}
                <Text style={{ color: c.primary }}>{t("settings.privacy")}</Text>
                {t("auth.consent.agree")}
              </Text>
            </Pressable>

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
              accessibilityLabel={t("auth.signUp")}
              onPress={() => { void handleSignUp(); }}
              loading={isLoading}
              disabled={!consentAccepted}
            >
              {t("auth.signUp")}
            </Button>

            <Pressable
              accessibilityLabel={t("auth.signIn")}
              accessibilityRole="link"
              onPress={() => { navigation.goBack(); }}
              style={styles.linkContainer}
            >
              <Text style={[styles.link, { color: c.primary }]}>
                {t("auth.consent.back")}{t("auth.signIn")}
              </Text>
            </Pressable>
          </View>
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
    paddingTop: 48,
    paddingBottom: 32,
    flexGrow: 1,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  form: {
    width: "100%",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 44,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: "700",
  },
  consentText: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
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
});
