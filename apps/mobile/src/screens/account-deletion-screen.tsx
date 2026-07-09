// SCR-DEL — Account Deletion: 4-step flow with 30-day grace period
// Step 1: Reason selection (optional)
// Step 2: Warning (30-day grace, subscription cancel, no restore)
// Step 3: Password re-entry (re-auth)
// Step 4: Grace period confirmation
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
import { resolveErrorMessage } from "../lib/error-i18n.js";
import { useAuthStore } from "../stores/auth-store.js";
import { deleteAccount as apiDeleteAccount } from "../api/auth-api.js";
import { signInWithSupabase } from "../api/auth-api.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "../navigation/settings-stack.js";

type Props = NativeStackScreenProps<SettingsStackParamList, "AccountDeletion">;

type Step = 1 | 2 | 3 | 4;

/** Step を 1 つ戻す (1 未満にはならない)。型アサーションを使わず網羅的に分岐する。 */
function decrementStep(step: Step): Step {
  switch (step) {
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 3;
    case 1:
      return 1;
  }
}

const DELETION_REASONS = [
  "account_deletion.reason.not_using",
  "account_deletion.reason.privacy",
  "account_deletion.reason.too_expensive",
  "account_deletion.reason.found_alternative",
  "account_deletion.reason.other",
] as const;

type DeletionReasonKey = (typeof DELETION_REASONS)[number];

function StepIndicator({ current, total }: { current: Step; total: number }) {
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <View
      style={[stepIndicatorStyles.container, { marginBottom: s[16] }]}
      accessibilityLabel={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <View
          key={step}
          style={[
            stepIndicatorStyles.dot,
            {
              backgroundColor: step <= current ? c.danger : c.bgTertiary,
              width: step === current ? 20 : 8,
            },
          ]}
        />
      ))}
    </View>
  );
}

const stepIndicatorStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});

// Step 1: Reason selection
function Step1Reason({
  selectedReason,
  onSelectReason,
  onNext,
  onBack,
}: {
  selectedReason: DeletionReasonKey | null;
  onSelectReason: (reason: DeletionReasonKey | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[step1Styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          style={[step1Styles.title, { color: c.textPrimary }]}
        >
          {t("account_deletion.reason.title")}
        </Text>
        <Text style={[step1Styles.subtitle, { color: c.textSecondary, marginBottom: s[24] }]}>
          {t("account_deletion.reason.subtitle")}
        </Text>

        {DELETION_REASONS.map((reasonKey) => (
          <Pressable
            key={reasonKey}
            accessibilityRole="radio"
            accessibilityState={{ checked: selectedReason === reasonKey }}
            accessibilityLabel={t(reasonKey)}
            onPress={() => {
              onSelectReason(selectedReason === reasonKey ? null : reasonKey);
            }}
            style={({ pressed }) => [
              step1Styles.reasonRow,
              {
                backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
                borderColor: selectedReason === reasonKey ? c.danger : c.border,
                borderRadius: theme.radii[8],
                marginBottom: s[8],
              },
            ]}
          >
            <View
              style={[
                step1Styles.radioOuter,
                {
                  borderColor: selectedReason === reasonKey ? c.danger : c.border,
                },
              ]}
            >
              {selectedReason === reasonKey && (
                <View style={[step1Styles.radioInner, { backgroundColor: c.danger }]} />
              )}
            </View>
            <Text style={[step1Styles.reasonText, { color: c.textPrimary }]}>
              {t(reasonKey)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[step1Styles.footer, { paddingHorizontal: s[24], paddingBottom: s[32] }]}>
        <Button
          variant="primary"
          size="lg"
          accessibilityLabel={t("common.next")}
          onPress={onNext}
        >
          {t("common.next")}
        </Button>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
          onPress={onBack}
          style={[step1Styles.cancelLink, { marginTop: s[12] }]}
        >
          <Text style={[step1Styles.cancelText, { color: c.textSecondary }]}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const step1Styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    minHeight: 52,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reasonText: {
    fontSize: 15,
    flex: 1,
  },
  footer: {
    gap: 0,
  },
  cancelLink: {
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
  },
});

// Step 2: Warning
function Step2Warning({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const warnings: string[] = [
    t("account_deletion.warning.grace_period"),
    t("account_deletion.warning.subscription_cancel"),
    t("account_deletion.warning.data_irrecoverable"),
    t("account_deletion.warning.iap_note"),
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[step2Styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          style={[step2Styles.title, { color: c.danger }]}
        >
          {t("account_deletion.warning.title")}
        </Text>
        <Text style={[step2Styles.subtitle, { color: c.textSecondary, marginBottom: s[24] }]}>
          {t("account_deletion.warning.subtitle")}
        </Text>

        <View
          style={[
            step2Styles.warningBox,
            {
              backgroundColor: c.bgPrimary,
              borderColor: c.danger,
              borderRadius: theme.radii[12],
              padding: s[16],
              marginBottom: s[24],
            },
          ]}
        >
          {warnings.map((warn, idx) => (
            <View key={idx} style={[step2Styles.warningRow, { marginBottom: s[12] }]}>
              <Text style={[step2Styles.warningBullet, { color: c.danger }]}>
                {"•"}
              </Text>
              <Text style={[step2Styles.warningText, { color: c.textPrimary }]}>
                {warn}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[step2Styles.footer, { paddingHorizontal: s[24], paddingBottom: s[32] }]}>
        <Button
          variant="danger"
          size="lg"
          accessibilityLabel={t("account_deletion.warning.proceed")}
          onPress={onNext}
        >
          {t("account_deletion.warning.proceed")}
        </Button>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
          onPress={onBack}
          style={[step2Styles.cancelLink, { marginTop: s[12] }]}
        >
          <Text style={[step2Styles.cancelText, { color: c.textSecondary }]}>
            {t("common.cancel")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const step2Styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  warningBox: {
    borderWidth: 1.5,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  warningBullet: {
    fontSize: 16,
    fontWeight: "700",
    marginRight: 10,
    lineHeight: 22,
  },
  warningText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  footer: {},
  cancelLink: {
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
  },
});

// Step 3: Password re-entry
function Step3Password({
  onConfirm,
  onBack,
}: {
  onConfirm: (password: string) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit = password.length >= 1;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(undefined);
    setIsLoading(true);
    try {
      await onConfirm(password);
    } catch {
      setError(t("account_deletion.confirm.auth_error"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[step3Styles.container, { paddingHorizontal: s[24] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          style={[step3Styles.title, { color: c.textPrimary }]}
        >
          {t("account_deletion.confirm.title")}
        </Text>
        <Text style={[step3Styles.subtitle, { color: c.textSecondary, marginBottom: s[24] }]}>
          {t("account_deletion.confirm.subtitle")}
        </Text>

        <Input
          label={t("auth.password")}
          placeholder="••••••••"
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            setError(undefined);
          }}
          secureTextEntry
          textContentType="password"
          error={error}
        />

        <View style={[step3Styles.buttonArea, { marginTop: s[24] }]}>
          <Button
            variant="danger"
            size="lg"
            accessibilityLabel={t("account_deletion.confirm.submit")}
            onPress={() => { void handleSubmit(); }}
            loading={isLoading}
            disabled={!canSubmit}
          >
            {t("account_deletion.confirm.submit")}
          </Button>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            onPress={onBack}
            style={[step3Styles.cancelLink, { marginTop: s[12] }]}
          >
            <Text style={[step3Styles.cancelText, { color: c.textSecondary }]}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const step3Styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 32,
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  buttonArea: {},
  cancelLink: {
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 15,
  },
});

// Step 4: Grace period confirmation
function Step4GracePeriod({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[step4Styles.container, { paddingHorizontal: s[24] }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[step4Styles.iconArea, { marginBottom: s[24] }]}>
          <View
            style={[
              step4Styles.iconCircle,
              {
                backgroundColor: c.bgSecondary,
                borderColor: c.border,
                borderRadius: 40,
              },
            ]}
          >
            <Text style={[step4Styles.iconText, { color: c.textSecondary }]}>
              {"30"}
            </Text>
            <Text style={[step4Styles.iconDays, { color: c.textTertiary }]}>
              {t("account_deletion.grace_period.days_label")}
            </Text>
          </View>
        </View>

        <Text
          accessibilityRole="header"
          style={[step4Styles.title, { color: c.textPrimary }]}
        >
          {t("account_deletion.grace_period.title")}
        </Text>
        <Text style={[step4Styles.body, { color: c.textSecondary, marginBottom: s[16] }]}>
          {t("account_deletion.grace_period.body")}
        </Text>
        <Text style={[step4Styles.body, { color: c.textSecondary, marginBottom: s[8] }]}>
          {t("account_deletion.grace_period.cancellable")}
        </Text>
        <Text style={[step4Styles.body, { color: c.textSecondary, marginBottom: s[24] }]}>
          {t("account_deletion.grace_period.email_sent")}
        </Text>
      </ScrollView>

      <View style={[step4Styles.footer, { paddingHorizontal: s[24], paddingBottom: s[32] }]}>
        <Button
          variant="primary"
          size="lg"
          accessibilityLabel={t("common.done")}
          onPress={onDone}
        >
          {t("common.done")}
        </Button>
      </View>
    </View>
  );
}

const step4Styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 16,
    alignItems: "center",
  },
  iconArea: {
    alignItems: "center",
    marginTop: 16,
  },
  iconCircle: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconText: {
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 28,
  },
  iconDays: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  footer: {},
});

// Main screen
export function AccountDeletionScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const logout = useAuthStore((state) => state.logout);

  const [step, setStep] = useState<Step>(1);
  const [selectedReason, setSelectedReason] = useState<DeletionReasonKey | null>(null);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const handleBack = () => {
    if (step === 1) {
      navigation.goBack();
    } else {
      setStep(decrementStep);
    }
  };

  const handleStep3Confirm = async (password: string): Promise<void> => {
    if (session == null) {
      setApiError(t("errors.AUTH_SESSION_MISSING"));
      return;
    }

    // Re-authenticate to verify identity
    const email = profile?.email;
    if (email == null || email.length === 0) {
      setApiError(t("account_deletion.confirm.auth_error"));
      return;
    }

    const reAuthResult = await signInWithSupabase(email, password);
    if (!reAuthResult.ok) {
      setApiError(t("account_deletion.confirm.auth_error"));
      throw new Error("re-auth failed");
    }

    // Use the fresh access token for deletion
    const deleteResult = await apiDeleteAccount(reAuthResult.data.accessToken);
    if (!deleteResult.ok) {
      const errMsg = resolveErrorMessage(deleteResult.error, t);
      setApiError(errMsg);
      throw new Error(deleteResult.error.message);
    }

    setApiError(undefined);
    setStep(4);
  };

  const handleDone = () => {
    void logout();
  };

  const stepTitles: Record<Step, string> = {
    1: t("account_deletion.reason.title"),
    2: t("account_deletion.warning.title"),
    3: t("account_deletion.confirm.title"),
    4: t("account_deletion.grace_period.title"),
  };

  return (
    <SafeAreaView style={[mainStyles.safeArea, { backgroundColor: c.bgSecondary }]}>
      {/* Header */}
      <View
        style={[
          mainStyles.header,
          { paddingHorizontal: s[16], paddingVertical: s[12], borderBottomColor: c.border },
        ]}
      >
        {step < 4 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            onPress={handleBack}
            style={mainStyles.backButton}
          >
            <Text style={[mainStyles.backText, { color: c.primary }]}>
              {t("common.back")}
            </Text>
          </Pressable>
        )}
        <Text
          style={[mainStyles.headerTitle, { color: c.textPrimary }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {t("account_deletion.title")}
        </Text>
        {step < 4 && <View style={mainStyles.backButton} />}
      </View>

      {/* Step indicator */}
      <View style={{ paddingTop: s[16] }}>
        <StepIndicator current={step} total={4} />
      </View>

      {/* Step label */}
      <Text
        style={[mainStyles.stepLabel, { color: c.textSecondary, paddingHorizontal: s[24] }]}
      >
        {stepTitles[step]}
      </Text>

      {/* Error banner */}
      {apiError != null && (
        <View
          style={[
            mainStyles.errorBanner,
            {
              backgroundColor: c.bgPrimary,
              borderColor: c.danger,
              marginHorizontal: s[16],
              marginBottom: s[8],
              borderRadius: theme.radii[8],
              padding: s[12],
            },
          ]}
        >
          <Text
            accessibilityRole="alert"
            style={[mainStyles.errorText, { color: c.danger }]}
          >
            {apiError}
          </Text>
        </View>
      )}

      {/* Step content */}
      {step === 1 && (
        <Step1Reason
          selectedReason={selectedReason}
          onSelectReason={setSelectedReason}
          onNext={() => { setStep(2); }}
          onBack={() => { navigation.goBack(); }}
        />
      )}
      {step === 2 && (
        <Step2Warning
          onNext={() => { setStep(3); }}
          onBack={() => { setStep(1); }}
        />
      )}
      {step === 3 && (
        <Step3Password
          onConfirm={handleStep3Confirm}
          onBack={() => { setStep(2); }}
        />
      )}
      {step === 4 && (
        <Step4GracePeriod onDone={handleDone} />
      )}
    </SafeAreaView>
  );
}

const mainStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
  },
  backText: {
    fontSize: 16,
    fontWeight: "500",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textAlign: "center",
    paddingBottom: 8,
    paddingTop: 4,
  },
  errorBanner: {
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
