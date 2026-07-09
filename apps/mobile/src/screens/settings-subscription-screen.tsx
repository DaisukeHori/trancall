/**
 * SCR-Subscription — Settings → Subscription (プラン管理)
 *
 * docs/billing-ui-flow.md v1.2 §9 canonical 準拠
 * T-41: subscription screen + T-42: Stripe Web Checkout UI 結合 + T-45: Restore Purchases UI
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, PlanCard, useTheme } from "@trancall/ui-kit";
import type { UpgradePreview } from "@trancall/billing";
import { useTranslation } from "../i18n/index.js";
import { useBillingStore } from "../stores/billing-store.js";
import { handleStripeDeepLink } from "../lib/billing/stripe-deep-link.js";

// =============================================================================
// CurrentPlanCard — 現在のプラン概要 + 残量プログレスバー
// docs/billing-ui-flow.md §9.1 Wireframe
// =============================================================================

function CurrentPlanCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const subscriptionState = useBillingStore((st) => st.subscriptionState);

  if (subscriptionState == null) {
    return (
      <View
        style={[
          currentCardStyles.container,
          {
            backgroundColor: c.bgPrimary,
            borderColor: c.border,
            borderRadius: theme.radii[12],
          },
        ]}
        accessibilityLabel={t("common.loading")}
        accessibilityRole="none"
      >
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const { plan, usedMinutes, remainingMinutes, currentPeriodEnd, cancelAtPeriodEnd } =
    subscriptionState;
  const totalMinutes = plan.includedMinutes;
  const usedRatio = totalMinutes > 0 ? Math.min(1, usedMinutes / totalMinutes) : 0;
  const usagePercent = Math.round(usedRatio * 100);

  const nextRenewalText = cancelAtPeriodEnd
    ? t("billing.subscription.cancelAtPeriodEnd")
    : t("billing.balance.nextBilling", { date: currentPeriodEnd.slice(0, 10) });

  return (
    <View
      style={[
        currentCardStyles.container,
        {
          backgroundColor: c.bgPrimary,
          borderColor: c.primary,
          borderRadius: theme.radii[12],
        },
      ]}
      accessibilityLabel={t("billing.subscription.currentPlan")}
      accessibilityRole="none"
    >
      <View style={currentCardStyles.header}>
        <Text style={[currentCardStyles.planName, { color: c.textPrimary }]}>
          {t(`billing.plans.${plan.tier}.name`)}
        </Text>
        <Text style={[currentCardStyles.price, { color: c.primary }]}>
          ¥{plan.monthlyPriceYen.toLocaleString()}/
          {t("billing.subscription.perMonth")}
        </Text>
      </View>
      <Text
        style={[
          currentCardStyles.renewal,
          { color: c.textSecondary, marginBottom: s[8] },
        ]}
      >
        {nextRenewalText}
      </Text>

      {/* 残量プログレスバー */}
      <View
        style={[currentCardStyles.progressTrack, { backgroundColor: c.bgTertiary }]}
        accessibilityRole="progressbar"
        accessibilityLabel={t("billing.subscription.includedMinutes", {
          minutes: remainingMinutes,
        })}
      >
        <View
          style={[
            currentCardStyles.progressFill,
            {
              width: `${usagePercent}%`,
              backgroundColor: usagePercent >= 90 ? c.warning : c.primary,
            },
          ]}
        />
      </View>
      <Text style={[currentCardStyles.usageText, { color: c.textSecondary }]}>
        {t("billing.balance.remaining", { minutes: remainingMinutes })}
        {" / "}
        {t("billing.subscription.includedMinutes", { minutes: totalMinutes })}
        {` (${usagePercent}%)`}
      </Text>
    </View>
  );
}

const currentCardStyles = StyleSheet.create({
  container: {
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  planName: {
    fontSize: 17,
    fontWeight: "600",
  },
  price: {
    fontSize: 15,
    fontWeight: "600",
  },
  renewal: {
    fontSize: 13,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  usageText: {
    fontSize: 12,
  },
});

// =============================================================================
// UpgradeConfirmModal — アップグレード確認ダイアログ
// docs/billing-ui-flow.md §9.2
// =============================================================================

interface UpgradeConfirmModalProps {
  visible: boolean;
  preview: UpgradePreview | null;
  targetTierName: string;
  currentTierName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function UpgradeConfirmModal({
  visible,
  preview,
  targetTierName,
  currentTierName,
  onConfirm,
  onCancel,
}: UpgradeConfirmModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View style={modalStyles.overlay}>
        <View
          style={[
            modalStyles.sheet,
            { backgroundColor: c.bgPrimary, borderRadius: theme.radii[16] },
          ]}
          accessibilityRole="none"
        >
          <Text
            style={[modalStyles.title, { color: c.textPrimary, marginBottom: s[8] }]}
            accessibilityRole="header"
          >
            {t("billing.subscription.confirmUpgrade")}
          </Text>

          {preview != null && (
            <>
              <Text style={[modalStyles.row, { color: c.textPrimary }]}>
                {currentTierName} → {targetTierName}
              </Text>
              {preview.proratedAmountYen > 0 && (
                <Text style={[modalStyles.row, { color: c.textSecondary }]}>
                  ¥{preview.proratedAmountYen.toLocaleString()}
                </Text>
              )}
              <Text style={[modalStyles.row, { color: c.textSecondary }]}>
                {t("billing.balance.nextBilling", {
                  date: preview.nextBillingDate.slice(0, 10),
                })}
              </Text>
            </>
          )}

          <View style={[modalStyles.buttonRow, { marginTop: s[24] }]}>
            <View style={modalStyles.buttonWrap}>
              <Button
                variant="ghost"
                size="md"
                onPress={onCancel}
                accessibilityLabel={t("common.cancel")}
              >
                {t("common.cancel")}
              </Button>
            </View>
            <View style={[modalStyles.buttonWrap, { marginLeft: s[8] }]}>
              <Button
                variant="primary"
                size="md"
                onPress={onConfirm}
                accessibilityLabel={t("billing.subscription.upgradeButton")}
              >
                {t("billing.subscription.upgradeButton")}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  row: {
    fontSize: 15,
    marginBottom: 6,
  },
  buttonRow: {
    flexDirection: "row",
  },
  buttonWrap: {
    flex: 1,
  },
});

// =============================================================================
// BillingErrorSheet — エラー表示 bottom sheet
// docs/billing-ui-flow.md §11.4
// =============================================================================

function BillingErrorSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const lastError = useBillingStore((st) => st.lastError);
  const clearError = useBillingStore((st) => st.clearError);

  if (lastError == null) return null;

  return (
    <View
      style={[
        errorSheetStyles.container,
        { backgroundColor: c.bgPrimary, borderTopColor: c.border },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[errorSheetStyles.title, { color: c.danger }]}>
        {t(lastError.title)}
      </Text>
      <Text style={[errorSheetStyles.message, { color: c.textSecondary }]}>
        {t(lastError.message)}
      </Text>
      <View style={[errorSheetStyles.buttonRow, { marginTop: s[12] }]}>
        <View style={errorSheetStyles.buttonWrap}>
          <Button
            variant="ghost"
            size="sm"
            onPress={clearError}
            accessibilityLabel={t("common.close")}
          >
            {t("common.close")}
          </Button>
        </View>
        {lastError.retryable && (
          <View style={[errorSheetStyles.buttonWrap, { marginLeft: s[8] }]}>
            <Button
              variant="primary"
              size="sm"
              onPress={clearError}
              accessibilityLabel={t(lastError.actionLabel)}
            >
              {t(lastError.actionLabel)}
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}

const errorSheetStyles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: "row",
  },
  buttonWrap: {
    flex: 1,
  },
});

// =============================================================================
// SectionHeader
// =============================================================================

function SectionHeader({ children }: { readonly children: string }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Text style={[sectionHeaderStyles.text, { color: c.textSecondary }]}>
      {children.toUpperCase()}
    </Text>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  text: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
});

// =============================================================================
// SettingsSubscriptionScreen — メイン画面
// docs/billing-ui-flow.md §9 canonical 準拠
// =============================================================================

export function SettingsSubscriptionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  // Zustand store selectors
  const subscriptionState = useBillingStore((st) => st.subscriptionState);
  const planComparison = useBillingStore((st) => st.planComparison);
  const pendingTransaction = useBillingStore((st) => st.pendingTransaction);
  const isRestoring = useBillingStore((st) => st.isRestoring);

  // Actions
  const refresh = useBillingStore((st) => st.refresh);
  const loadUpgradePreview = useBillingStore((st) => st.loadUpgradePreview);
  const startExternalPurchaseAction = useBillingStore((st) => st.startExternalPurchase);
  const restorePurchasesAction = useBillingStore((st) => st.restorePurchases);
  const cancelSubscriptionAction = useBillingStore((st) => st.cancelSubscription);
  const clearError = useBillingStore((st) => st.clearError);
  const onStripeSuccess = useBillingStore((st) => st.onStripeSuccess);
  const onExternalPurchaseSuccess = useBillingStore((st) => st.onExternalPurchaseSuccess);

  // ローカル UI 状態
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  // 画面マウント時にサブスク状態を取得
  // docs/billing-ui-flow.md §13.2
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // deep link ハンドラー登録 (Stripe/ExternalPurchase からの戻り処理)
  // docs/billing-ui-flow.md §6.3 Step 5 / §8.3 Step 6
  useEffect(() => {
    const subscription = Linking.addEventListener("url", (event) => {
      void handleStripeDeepLink(event.url, {
        onStripeSuccess: async (sessionId) => {
          await onStripeSuccess(sessionId);
        },
        onStripeCanceled: () => {
          // キャンセルはエラー表示なし (docs/billing-ui-flow.md §6.4)
          clearError();
        },
        onExternalPurchaseSuccess: async (redirect) => {
          await onExternalPurchaseSuccess(redirect);
        },
      });
    });
    return () => { subscription.remove(); };
  }, [onStripeSuccess, onExternalPurchaseSuccess, clearError]);

  // =========================================================================
  // プランカードの押下 → アップグレードプレビュー取得 → 確認ダイアログ
  // docs/billing-ui-flow.md §9.3 showing → confirming
  // =========================================================================
  const handlePlanSelect = useCallback(
    async (tier: string) => {
      if (subscriptionState == null) return;
      if (tier === subscriptionState.plan.tier) return;

      clearError();
      setSelectedTier(tier);

      const preview = await loadUpgradePreview(tier);
      setUpgradePreview(preview);
      if (preview != null) {
        setConfirmModalVisible(true);
      }
    },
    [subscriptionState, loadUpgradePreview, clearError],
  );

  // =========================================================================
  // 確認ダイアログ → External Purchase 開始 (Stripe Web チャネル)
  // docs/billing-ui-flow.md §6.3 Step 3 / §8.3 Step 3-4
  // =========================================================================
  const handleConfirmUpgrade = useCallback(async () => {
    setConfirmModalVisible(false);
    if (selectedTier == null) return;

    const result = await startExternalPurchaseAction(selectedTier);
    if (result != null) {
      // Linking.openURL で外部ブラウザ (Stripe Checkout) を起動
      // docs/billing-ui-flow.md §6.3 Step 3
      void Linking.openURL(result.redirectUrl);
    }
    setSelectedTier(null);
    setUpgradePreview(null);
  }, [selectedTier, startExternalPurchaseAction]);

  const handleCancelModal = useCallback(() => {
    setConfirmModalVisible(false);
    setSelectedTier(null);
    setUpgradePreview(null);
  }, []);

  // =========================================================================
  // Restore Purchases — iOS App Store ガイドライン必須
  // docs/billing-ui-flow.md §12
  // =========================================================================
  const handleRestorePurchases = useCallback(async () => {
    // StoreKit.Transaction.currentEntitlements は iOS runtime でのみ動作する。
    // react-native-iap 経由で取得した IapTransactionResult[] を渡すのが本番実装だが、
    // Sprint 3 では空配列でサーバーに問い合わせる (server 側で Stripe/IAP 履歴を再確認)
    // docs/billing-ui-flow.md §12.4 注意事項
    await restorePurchasesAction([]);
  }, [restorePurchasesAction]);

  // =========================================================================
  // サブスクリプションキャンセル
  // docs/billing-ui-flow.md §5.1 atPeriodEnd=true
  // =========================================================================
  const handleCancelSubscription = useCallback(() => {
    Alert.alert(
      t("billing.subscription.confirmCancel"),
      t("billing.subscription.cancelAtPeriodEnd"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("billing.subscription.cancel"),
          style: "destructive",
          onPress: () => { void cancelSubscriptionAction(true); },
        },
      ],
    );
  }, [t, cancelSubscriptionAction]);

  const isProcessing = pendingTransaction != null || isRestoring;

  const currentTierName =
    subscriptionState != null
      ? t(`billing.plans.${subscriptionState.plan.tier}.label`)
      : "";
  const selectedTierName =
    selectedTier != null ? t(`billing.plans.${selectedTier}.label`) : "";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingHorizontal: s[16] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* タイトル */}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.textPrimary }]}
        >
          {t("billing.subscription.title")}
        </Text>

        {/* 現在のプランカード */}
        <SectionHeader>{t("billing.subscription.currentPlan")}</SectionHeader>
        <CurrentPlanCard />

        {/* プラン比較リスト */}
        {planComparison != null && (
          <>
            <SectionHeader>{t("billing.managePlan")}</SectionHeader>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("billing.managePlan")}
            >
              {planComparison.plans.map((plan) => {
                const isCurrent = plan.tier === subscriptionState?.plan.tier;
                const isRecommended = plan.isRecommended;
                return (
                  <View key={plan.tier} style={{ marginBottom: s[8] }}>
                    {isRecommended && (
                      <View
                        style={[
                          recommendedStyles.badge,
                          { backgroundColor: c.primary },
                        ]}
                      >
                        <Text style={[recommendedStyles.badgeText, { color: c.textOnColor }]}>
                          {t("billing.subscription.recommended")}
                        </Text>
                      </View>
                    )}
                    <PlanCard
                      planName={plan.name}
                      priceYen={plan.monthlyPriceYen}
                      includedMinutes={plan.includedMinutes}
                      isSelected={isCurrent}
                      onPress={
                        isCurrent || isProcessing
                          ? undefined
                          : () => { void handlePlanSelect(plan.tier); }
                      }
                      accessibilityLabel={
                        isCurrent
                          ? `${plan.name} ${t("billing.subscription.currentPlanBadge")}`
                          : `${plan.name} ¥${plan.monthlyPriceYen.toLocaleString()}`
                      }
                    />
                    {/* アップグレードボタン (現在プラン以外 / free 以外) */}
                    {!isCurrent && plan.tier !== "free" && (
                      <View style={{ marginTop: s[8] }}>
                        <Button
                          variant="primary"
                          size="sm"
                          onPress={() => { void handlePlanSelect(plan.tier); }}
                          accessibilityLabel={`${plan.name}: ${t("billing.subscription.upgradeButton")}`}
                          disabled={isProcessing}
                        >
                          {t("billing.subscription.upgradeButton")}
                        </Button>
                      </View>
                    )}
                    {/* プラン詳細テキスト */}
                    <Text
                      style={[planDetailStyles.detail, { color: c.textSecondary }]}
                    >
                      {t("billing.subscription.overageRate", {
                        rate: plan.overageRateYen,
                      })}
                      {" · "}
                      {t("billing.subscription.transcriptRetention", {
                        days: plan.transcriptRetentionDays,
                      })}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* 区切り線 */}
        <View
          style={[
            dividerStyles.line,
            { backgroundColor: c.border, marginVertical: s[16] },
          ]}
        />

        {/* Restore Purchases — iOS App Store ガイドライン必須 §12 */}
        <Button
          variant="ghost"
          size="md"
          onPress={() => { void handleRestorePurchases(); }}
          loading={isRestoring}
          disabled={isRestoring}
          accessibilityLabel={t("billing.subscription.restore")}
        >
          {isRestoring
            ? t("billing.subscription.restoring")
            : t("billing.subscription.restore")}
        </Button>

        {/* キャンセルボタン (Free プランの場合は非表示) */}
        {subscriptionState != null &&
          subscriptionState.plan.tier !== "free" && (
            <View style={{ marginTop: s[8] }}>
              <Button
                variant="danger"
                size="md"
                onPress={handleCancelSubscription}
                disabled={isProcessing || subscriptionState.cancelAtPeriodEnd}
                accessibilityLabel={t("billing.subscription.cancel")}
              >
                {t("billing.subscription.cancel")}
              </Button>
            </View>
          )}

        {/* 法的リンク */}
        <View style={[legalStyles.row, { marginTop: s[16] }]}>
          <Pressable
            onPress={() => undefined}
            accessibilityLabel={t("settings.aboutSection.terms")}
            accessibilityRole="link"
          >
            <Text style={[legalStyles.link, { color: c.primary }]}>
              {t("settings.aboutSection.terms")}
            </Text>
          </Pressable>
          <Text style={[legalStyles.separator, { color: c.textTertiary }]}>
            {"  ·  "}
          </Text>
          <Pressable
            onPress={() => undefined}
            accessibilityLabel={t("settings.aboutSection.privacy")}
            accessibilityRole="link"
          >
            <Text style={[legalStyles.link, { color: c.primary }]}>
              {t("settings.aboutSection.privacy")}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: s[32] }} />
      </ScrollView>

      {/* エラー表示シート */}
      <BillingErrorSheet />

      {/* Loading Overlay — upgrading/restoring 状態中に全体に表示 §9.4 */}
      {isProcessing && (
        <View
          style={[overlayStyles.container, { backgroundColor: "rgba(0,0,0,0.3)" }]}
          accessibilityLabel={t("common.loading")}
          accessibilityRole="none"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator size="large" color={c.textOnColor} />
        </View>
      )}

      {/* アップグレード確認ダイアログ */}
      <UpgradeConfirmModal
        visible={confirmModalVisible}
        preview={upgradePreview}
        targetTierName={selectedTierName}
        currentTierName={currentTierName}
        onConfirm={() => { void handleConfirmUpgrade(); }}
        onCancel={handleCancelModal}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// Styles
// =============================================================================

const recommendedStyles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
});

const planDetailStyles = StyleSheet.create({
  detail: {
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
});

const dividerStyles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
  },
});

const legalStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  link: {
    fontSize: 13,
  },
  separator: {
    fontSize: 13,
  },
});

const overlayStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});

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
});
