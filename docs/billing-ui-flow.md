# TranCall Billing UI フロー設計書

| 項目 | 内容 |
|------|------|
| ドキュメント ID | BILLING-UI-001 |
| Status | Draft v1.0 (2026-05-12) |
| Sprint | Sprint 2 D5 |
| 上位文書 | `docs/architecture.md` §7/§8 / `docs/module-contracts.md` v1.1.0 §2.3 / `docs/billing-detail.md` (canonical heartbeat 課金) |
| 関連文書 | `docs/legal-and-consent.md` (D7 法務、別 PR で並行作成) / `docs/app-store-submission.md` (D6) / `docs/design/design-system.md` |
| 下位実装対象 | `apps/mobile/src/screens/settings-subscription-screen.tsx` (新規)、`apps/mobile/src/stores/billing-store.ts` (新規)、`packages/billing/src/facade.ts` 拡張、`apps/server/src/routes/billing.ts` 拡張 |

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [用語と前提](#2-用語と前提)
3. [課金チャネル全体構成](#3-課金チャネル全体構成)
4. [Zod スキーマ定義](#4-zod-スキーマ定義)
5. [BillingFacade 拡張](#5-billingfacade-拡張)
6. [Stripe Web 課金フロー](#6-stripe-web-課金フロー)
7. [iOS App Store IAP (StoreKit 2) フロー](#7-ios-app-store-iap-storekit-2-フロー)
8. [StoreKit External Purchase フロー](#8-storekit-external-purchase-フロー)
9. [プラン管理 UI (Settings → Subscription)](#9-プラン管理-ui-settings--subscription)
10. [Pre-call コスト見積 UI + Home 残量表示](#10-pre-call-コスト見積-ui--home-残量表示)
11. [エラーハンドリングと UI 文言 (i18n)](#11-エラーハンドリングと-ui-文言-i18n)
12. [Restore Purchases (iOS 必須)](#12-restore-purchases-ios-必須)
13. [状態遷移と source of truth](#13-状態遷移と-source-of-truth)
14. [テスト戦略](#14-テスト戦略)
15. [セキュリティとリプレイ攻撃対策](#15-セキュリティとリプレイ攻撃対策)
16. [改訂履歴](#16-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の目的

本書は Sprint 2 D5 として、TranCall における課金 UI フローの **canonical 設計書**である。Sprint 3 で `apps/mobile/src/screens/settings-subscription-screen.tsx` 等を実装する engineer と reviewer が、本書 1 冊で実装に必要な情報を得られることを目標とする。

### 1.2 本書がカバーする範囲

- Apple App Store 提出 (Phase 1c) に必要な 4 チャネルの課金 UI フロー確定
  - Stripe Web 課金
  - iOS App Store IAP (StoreKit 2)
  - StoreKit External Purchase (日本・EU 等の対象国向け)
  - Google Play IAP (スキーマのみ、UI 詳述は本書スコープ外)
- `BillingFacade` の新規拡張メソッド 7 種の契約
- Settings → Subscription 画面の状態遷移と wireframe
- Pre-call コスト見積 UI および Home 残量表示
- エラーハンドリングと i18n (ja/en/zh)
- Restore Purchases (iOS App Store ガイドライン必須)
- テスト戦略とサンドボックス検証方針
- セキュリティとリプレイ攻撃対策

### 1.3 本書がカバーしない範囲

- **heartbeat 課金のシーケンス** — `docs/billing-detail.md` が canonical。本書は重複しない
- **Google Play IAP の UI 詳細** — Phase 1c では iOS を優先。Google Play は §3 のチャネル比較表に留め、Sprint 3 後半以降で別途設計書作成予定
- **法務・プライバシーポリシー・利用規約** — `docs/legal-and-consent.md` (D7) が canonical
- **App Store 審査提出手続き** — `docs/app-store-submission.md` (D6) が canonical

### 1.4 関連設計書との位置関係

```
docs/requirements.md          Phase 1c 定義 (BILL-003 〜 BILL-009)
docs/architecture.md          §7 API エンドポイント / §8 モバイルアーキテクチャ
docs/module-contracts.md      §2.3 BillingFacade 契約 / §5 Error Code 所有
docs/billing-detail.md        heartbeat 課金 canonical (reservation → heartbeat → reconcile)
docs/design/design-system.md  UI canonical (colors / spacing / PlanCard 等)
docs/billing-ui-flow.md       ★本書 (課金 UI フロー canonical)
docs/legal-and-consent.md     D7 法務・同意 (別 PR 並行)
docs/app-store-submission.md  D6 審査提出手続き (別 PR 並行)
```

---

## 2. 用語と前提

### 2.1 用語定義

| 用語 | 定義 |
|------|------|
| PlanTier | `free` / `light` / `standard` / `business` の 4 値 enum (`packages/billing/src/schemas.ts` canonical) |
| PurchaseChannel | `free` / `iap_apple` / `iap_google` / `storekit_external` / `stripe_web` の 5 値 enum |
| SubscriptionState | billing facade が返す現在のサブスク状態 (plan, usedMinutes, remainingMinutes 等) |
| StoreKit 2 | iOS 15+ の Apple In-App Purchase フレームワーク (swift-native) |
| StoreKit External Purchase | Apple StoreKit External Link Entitlement を使用した外部決済リンク。日本・EU・韓国・インド等で利用可 |
| IAP | In-App Purchase。App Store / Google Play 経由の課金 |
| Stripe Checkout Session | Stripe がホストする決済 URL。ブラウザ経由でカード入力を受け付ける |
| redirectToken | StoreKit External Purchase 完了後、server が発行する 1 回限り・5 分 TTL のトークン |
| `originalTransactionId` | Apple が付与する購入の原始 ID (更新・Restore でも不変) |
| reconcile | 通話終了時に予約分数と実消費分数を突き合わせる精算処理 (`billing-detail.md` canonical) |
| billingStore | Sprint 3 で新規作成する Zustand store (`apps/mobile/src/stores/billing-store.ts`) |

### 2.2 プラン定義 (canonical)

`packages/billing/src/schemas.ts` の `PLAN_CONFIGS` が single source of truth。以下は本書での参照用抜粋。

| PlanTier | 月額 (税込) | 含有分数/月 | 超過料金/分 | transcript 保持 |
|----------|------------|-----------|-----------|----------------|
| `free` | ¥0 | 5 分 | 利用不可 | 7 日 |
| `light` | ¥980 | 30 分 | ¥40 | 30 日 |
| `standard` | ¥2,980 | 120 分 | ¥30 | 90 日 |
| `business` | ¥9,800 | 500 分 | ¥25 | 365 日 |

**注意**: `requirements.md` の超過料金 (Light: ¥40、Standard: ¥35、Business: ¥30) と実装値 (`packages/billing/src/schemas.ts`: Standard: ¥30、Business: ¥25) が乖離している。実装値を canonical とする。`requirements.md` は Sprint 3 開始前に修正すること (Sprint 3 タスク化)。

### 2.3 非機能要件 (参照元: `docs/requirements.md` §4)

| ID | 要件 | 目標値 |
|----|------|--------|
| PERF-001 | 通話開始までの接続時間 | 3 秒以内 |
| AVAIL-001 | サービス稼働率 | 99.9% |
| AVAIL-002 | 通話ドロップ率 | 1% 未満 |

課金 UI に直接関係する追加制約:
- Subscription 画面の初期表示: API レスポンス 2 秒以内
- IAP トランザクション検証: Apple App Store Server API 応答待ち最大 10 秒、タイムアウト時は `BILLING_IAP_RECEIPT_INVALID` で UI にエラー表示

---

## 3. 課金チャネル全体構成

### 3.1 チャネル比較表

| チャネル | `purchase_channel` | 対象市場 | 認証方式 | 手数料 | 実装状態 |
|---|---|---|---|---|---|
| Stripe Web | `stripe_web` | Web ブラウザ全般、海外向け B2B | Stripe Checkout Session | 約 3.6% | adapter 実装済、UI 結合未 |
| iOS App Store IAP | `iap_apple` | iOS App Store 経由 | StoreKit 2 | 30% (Small Business Program: 15%) | adapter 実装済、UI 結合未 |
| Google Play IAP | `iap_google` | Google Play 経由 | Google Play Billing Library | 30% (Small Business: 15%) | adapter 実装済、UI 結合未 (本書スコープ外、iOS のみ詳述) |
| StoreKit External Purchase | `storekit_external` | iOS 日本・EU・韓国・インド等の対象国 | Apple StoreKit External Link Entitlement + Stripe | 27% (Small Business: 12%) | スキーマのみ確定、実装未 |

### 3.2 チャネル選択ロジック

mobile クライアントが実行時に以下の順序でチャネルを判定する。

```
判定順序 (iOS):

1. Locale.current.region が ExternalPurchase 対象国か？
   対象国: JP / EU 加盟国 (DE/FR/IT/ES 等) / KR / IN
     → YES: 「App Store 決済」と「外部リンク決済」の 2 択を UI に表示
     → NO : 「App Store 決済」のみ表示

2. ユーザーが「App Store 決済」を選択
     → チャネル: iap_apple
     → フロー: §7 (StoreKit 2 フロー)

3. ユーザーが「外部リンク決済」を選択 (対象国のみ)
     → チャネル: storekit_external
     → フロー: §8 (StoreKit External Purchase フロー)

判定順序 (Android):
   → チャネル: iap_google (本書スコープ外)

判定順序 (Web / B2B):
   → チャネル: stripe_web
   → フロー: §6 (Stripe Web フロー)
```

### 3.3 DB 状態とチャネル整合性

`trancall_billing.subscriptions` の `purchase_channel_id_consistency` CHECK 制約により、チャネルに応じた外部 ID 列の必須/null が強制される (`docs/architecture.md` §6.2 参照)。

| purchase_channel | iap_original_transaction_id | stripe_subscription_id |
|---|---|---|
| `free` | NULL | NULL |
| `iap_apple` | NOT NULL | NULL |
| `iap_google` | NOT NULL | NULL |
| `storekit_external` | NULL | NOT NULL |
| `stripe_web` | NULL | NOT NULL |

---

## 4. Zod スキーマ定義

本セクションで定義するスキーマはすべて Sprint 3 実装の対象。`packages/billing/src/schemas.ts` への追加分と `apps/mobile/src/stores/billing-store.ts` の store 状態型をまとめる。

import 省略表記: `z` = `zod`、`PlanTier` / `SubscriptionState` は `packages/billing/src/schemas.ts` から import。

### 4.1 PlanComparisonView

Settings → Subscription 画面でプラン一覧を表示するためのビューモデル。

```ts
// packages/billing/src/schemas.ts (Sprint 3 拡張)
export const PlanComparisonViewSchema = z.object({
  currentTier: PlanTier,
  plans: z.array(
    z.object({
      tier: PlanTier,
      name: z.string(),                        // i18n key 解決済の表示名
      monthlyPriceYen: z.number().int().nonnegative(),
      includedMinutes: z.number().int().nonnegative(),
      overageRateYen: z.number().int().nonnegative(),
      transcriptRetentionDays: z.number().int().positive(),
      features: z.array(z.string()),           // i18n key 解決済の機能リスト
      isRecommended: z.boolean(),              // ハイライト表示用 (standard が true)
      isCurrent: z.boolean(),
    })
  ).length(4),                                 // free/light/standard/business 固定 4 件
});
export type PlanComparisonView = z.infer<typeof PlanComparisonViewSchema>;
```

**注意**: `plans` 配列の順序は `free → light → standard → business` 固定。UI は配列順で表示。

### 4.2 UpgradePreview

現在プランから目標プランへの upgrade preview (日割り計算結果)。

```ts
// packages/billing/src/schemas.ts (Sprint 3 拡張)
export const UpgradePreviewSchema = z.object({
  currentTier: PlanTier,
  targetTier: PlanTier,
  proratedAmountYen: z.number().int().nonnegative(),   // 当月日割り差額 (0 ならダウングレード/同額)
  nextBillingDate: z.iso.datetime(),                    // 次回請求日
  effectiveImmediately: z.boolean(),                   // true: 即日反映 / false: 次回更新時反映
  confirmationRequired: z.boolean(),                   // true: 確認ダイアログを表示
});
export type UpgradePreview = z.infer<typeof UpgradePreviewSchema>;
```

**契約**: `proratedAmountYen` は Stripe の proration preview API 結果をそのまま返す。Stripe が計算するため server 側での二重計算は不要。

### 4.3 CheckoutSessionViewModel

Stripe Web Checkout 表示用 ViewModel。mobile が deep link 復帰後に billingStore へ保持する。

```ts
// apps/mobile/src/stores/billing-store.ts (Sprint 3 新規)
export const CheckoutSessionViewModelSchema = z.object({
  checkoutUrl: z.url(),                     // Stripe が発行する決済 URL
  sessionId: z.string(),                    // Stripe Checkout Session ID
  expiresAt: z.iso.datetime(),              // セッション有効期限 (通常 24h)
  targetTier: PlanTier,
  returnUrl: z.string(),                    // アプリ復帰用 deep link (trancall://billing/stripe-success?session_id=...)
});
export type CheckoutSessionViewModel = z.infer<typeof CheckoutSessionViewModelSchema>;
```

### 4.4 IapTransactionResult (StoreKit 2)

iOS StoreKit 2 の `Transaction` オブジェクトから取り出す情報。mobile → server に送信する際の型。

```ts
// packages/billing/src/schemas.ts (Sprint 3 拡張)
export const IapTransactionResultSchema = z.object({
  originalTransactionId: z.string(),        // Apple が付与する原始 ID (更新・Restore 時も不変)
  productId: z.string(),                    // 例: "com.trancall.subscription.light.monthly"
  purchaseDate: z.iso.datetime(),
  expirationDate: z.iso.datetime().nullable(),
  signedJws: z.string(),                    // AppleIapAdapter が JWS 検証に使用する署名済みトランザクション情報
  isUpgrade: z.boolean(),                   // 既存プランからのアップグレードか
});
export type IapTransactionResult = z.infer<typeof IapTransactionResultSchema>;
```

**productId 命名規則**: `com.trancall.subscription.{tier}.monthly`
- `com.trancall.subscription.light.monthly`
- `com.trancall.subscription.standard.monthly`
- `com.trancall.subscription.business.monthly`
- (Free プランは IAP 対象外)

### 4.5 StoreKitExternalRedirectResult

External Purchase 完了後のコールバック deep link (`trancall://billing/external-success?token=...`) からパースする情報。

```ts
// packages/billing/src/schemas.ts (Sprint 3 拡張)
export const StoreKitExternalRedirectResultSchema = z.object({
  redirectToken: z.string(),                // server 発行の Stripe session 完了 token (5 分 TTL、1 回限り)
  stripeSubscriptionId: z.string(),         // Stripe Subscription ID
  completedAt: z.iso.datetime(),
});
export type StoreKitExternalRedirectResult = z.infer<typeof StoreKitExternalRedirectResultSchema>;
```

### 4.6 BillingScreenState (Settings → Subscription 画面の全状態)

`billingStore` (Zustand) の型定義。

```ts
// apps/mobile/src/stores/billing-store.ts (Sprint 3 新規)
export const BillingScreenStateSchema = z.object({
  subscriptionState: SubscriptionState.nullable(),      // null: 未ロード
  planComparison: PlanComparisonViewSchema.nullable(),  // null: 未ロード
  pendingTransaction: z.object({
    channel: z.enum(["iap_apple", "storekit_external", "stripe_web"]),
    targetTier: PlanTier,
    startedAt: z.iso.datetime(),
  }).nullable(),                                         // 購入処理中の状態 (ローディング UI 用)
  lastError: z.object({
    code: z.string(),
    title: z.string(),
    message: z.string(),
    actionLabel: z.string(),
    retryable: z.boolean(),
  }).nullable(),
  isRestoring: z.boolean(),                             // Restore Purchases 処理中
  checkoutSession: CheckoutSessionViewModelSchema.nullable(), // Stripe Checkout Session 保持用
});
export type BillingScreenState = z.infer<typeof BillingScreenStateSchema>;
```

**初期値**:
```ts
const initialBillingScreenState: BillingScreenState = {
  subscriptionState: null,
  planComparison: null,
  pendingTransaction: null,
  lastError: null,
  isRestoring: false,
  checkoutSession: null,
};
```

### 4.7 BillingErrorViewModel (UI 表示用エラー文言マッピング)

`AppError` から UI 表示用ビューモデルに変換するマッピング型。`§11` のエラー文言テーブルの型定義。

```ts
// apps/mobile/src/stores/billing-store.ts (Sprint 3 新規)
export const BillingErrorViewModelSchema = z.object({
  code: z.string(),                         // AppError["code"] に対応
  title: z.string(),                        // i18n key 解決済のタイトル
  message: z.string(),                      // i18n key 解決済の本文
  actionLabel: z.string(),                  // ボタン文言
  retryable: z.boolean(),
});
export type BillingErrorViewModel = z.infer<typeof BillingErrorViewModelSchema>;

// AppError → BillingErrorViewModel 変換関数のシグネチャ
export type AppErrorCode = string;
export type BillingErrorMap = Map<AppErrorCode, Omit<BillingErrorViewModel, "code">>;
```

### 4.8 新規 DomainEvent (billing 内)

billing モジュールが発行する新規 DomainEvent 2 種。発行元: `billing` モジュール、購読先: 将来の analytics モジュール。

```ts
// packages/billing/src/schemas.ts (Sprint 3 拡張)
// import { DomainEventBase } from "@trancall/shared-kernel/schemas/events";

export const BillingSubscriptionUpgradedEventSchema = DomainEventBase.extend({
  type: z.literal("billing.subscription_upgraded"),
  payload: z.object({
    userId: UserIdSchema,
    fromTier: PlanTier,
    toTier: PlanTier,
    channel: PurchaseChannel,
    effectiveAt: z.iso.datetime(),
  }),
});
export type BillingSubscriptionUpgradedEvent = z.infer<typeof BillingSubscriptionUpgradedEventSchema>;

export const BillingSubscriptionCanceledEventSchema = DomainEventBase.extend({
  type: z.literal("billing.subscription_canceled"),
  payload: z.object({
    userId: UserIdSchema,
    fromTier: PlanTier,
    channel: PurchaseChannel,
    cancelAtPeriodEnd: z.boolean(),       // true: 期末キャンセル / false: 即時キャンセル
    effectiveAt: z.iso.datetime(),
  }),
});
export type BillingSubscriptionCanceledEvent = z.infer<typeof BillingSubscriptionCanceledEventSchema>;
```

**EventBus 登録**: `docs/module-contracts.md` §3.1 の発行/購読マトリクスに以下を Sprint 3 で追加する。

| イベント名 | 発行モジュール | 購読モジュール | 配信手段 |
|---|---|---|---|
| `billing.subscription_upgraded` | billing | (将来) analytics | EventBus (in-process) |
| `billing.subscription_canceled` | billing | (将来) analytics | EventBus (in-process) |

### 4.9 PreCallCostEstimate

Pre-call 画面で通話前コスト見積を表示するビューモデル。

```ts
// apps/mobile/src/stores/billing-store.ts (Sprint 3 新規)
export const PreCallCostEstimateSchema = z.object({
  expectedMinutes: z.number().int().positive(),           // 見積通話時間 (分)
  remainingMinutes: z.number().nonnegative(),             // 現在の残量
  predictedCostYen: z.number().int().nonnegative(),       // 予測超過コスト (残量超過分のみ)
  willExceedQuota: z.boolean(),                           // true: 含有分を超える見込み
  recommendedAction: z.enum(["proceed", "upgrade", "warn_overage"]),
  // "proceed"       : 残量十分、そのまま通話開始可
  // "upgrade"       : Free プランで残量なし、アップグレードを促す
  // "warn_overage"  : 超過課金が発生するが続行可
});
export type PreCallCostEstimate = z.infer<typeof PreCallCostEstimateSchema>;
```

**計算式**:
```
predictedCostYen = max(0, expectedMinutes - remainingMinutes) * overageRateYen
willExceedQuota  = expectedMinutes > remainingMinutes
```

---

## 5. BillingFacade 拡張

### 5.1 拡張後インターフェース全体

```ts
// packages/billing/src/facade.ts (Sprint 3 拡張)
export interface BillingFacade {
  // =========================================================================
  // 既存メソッド (docs/module-contracts.md §2.3 canonical)
  // =========================================================================
  getSubscription(userId: UserId): Promise<Result<SubscriptionState>>;
  recordUsage(cmd: RecordUsageCommand): Promise<Result<SubscriptionState>>;
  canStartCall(userId: UserId): Promise<Result<true>>;
  reserveMinutes(
    userId: UserId,
    sessionId: TranslationSessionId,
    minutes: number,
  ): Promise<Result<true>>;
  reconcile(
    userId: UserId,
    sessionId: TranslationSessionId,
  ): Promise<Result<SubscriptionState>>;
  refundMinutes(sessionId: TranslationSessionId): Promise<Result<true>>;
  createCheckoutSession(
    userId: UserId,
    tier: PlanTier,
    channel: "stripe_web" | "storekit_external",
  ): Promise<Result<{ url: string }>>;
  handleStripeWebhook(rawBody: string, signature: string): Promise<Result<true>>;
  handleAppleIapWebhook(payload: unknown): Promise<Result<true>>;
  handleGoogleIapWebhook(payload: unknown): Promise<Result<true>>;

  // =========================================================================
  // 新規メソッド (D5 本書で確定)
  // =========================================================================

  /**
   * プラン比較ビューを取得する。
   * @idempotent 副作用なし
   * @retryable true
   */
  getPlanComparison(userId: UserId): Promise<Result<PlanComparisonView>>;

  /**
   * アップグレードの日割り計算プレビューを取得する。
   * Stripe Proration Preview API を呼び出す。Free プランからのアップグレードは proratedAmountYen=0。
   * @idempotent 副作用なし
   * @retryable true
   */
  previewUpgrade(userId: UserId, targetTier: PlanTier): Promise<Result<UpgradePreview>>;

  /**
   * StoreKit 2 の Transaction を server に送信し、サブスクリプションを更新する。
   * AppleIapAdapter で JWS 署名を検証してから subscriptions を update する。
   * originalTransactionId の UNIQUE 制約で重複処理を防止 (冪等)。
   * @idempotent originalTransactionId で重複排除
   * @retryable false (署名失敗は再試行不可)
   */
  recordIapTransaction(
    userId: UserId,
    transaction: IapTransactionResult,
  ): Promise<Result<SubscriptionState>>;

  /**
   * StoreKit External Purchase 開始。server が Stripe Checkout Session を作成し、
   * Apple External Purchase Server API に externalPurchaseToken を報告する。
   * redirectUrl は Safari で開く外部 URL。
   * @idempotent false (呼び出しごとに新規 Stripe Session を作成)
   * @retryable true
   */
  startExternalPurchase(
    userId: UserId,
    targetTier: PlanTier,
  ): Promise<Result<{ redirectUrl: string }>>;

  /**
   * StoreKit External Purchase 完了。deep link から受け取った redirectToken を検証し、
   * サブスクリプションを更新する。
   * redirectToken は 5 分 TTL + 1 回限り使い切り。
   * @idempotent redirectToken で重複排除
   * @retryable false (TTL 切れは再試行不可)
   */
  completeExternalPurchase(
    userId: UserId,
    redirect: StoreKitExternalRedirectResult,
  ): Promise<Result<SubscriptionState>>;

  /**
   * サブスクリプションをキャンセルする。
   * atPeriodEnd=true: 現在の請求期間末にキャンセル (cancelAtPeriodEnd=true をセット)
   * atPeriodEnd=false: 即時キャンセル (Free プランに戻す)
   * IAP チャネルの場合、App Store 側のキャンセルは iOS 設定アプリ経由のため、
   * atPeriodEnd=true のみ許容 (即時キャンセル不可)。
   * @idempotent true (既にキャンセル済みなら OK を返す)
   * @retryable true
   */
  cancelSubscription(
    userId: UserId,
    atPeriodEnd: boolean,
  ): Promise<Result<SubscriptionState>>;

  /**
   * 購入を復元する (iOS App Store ガイドライン必須機能)。
   * StoreKit.Transaction.currentEntitlements から列挙した transactions を検証し、
   * 有効なサブスクリプションがあれば subscriptions テーブルを更新する。
   * restoredCount: 検証に成功した transaction 数。
   * subscription: 復元後の SubscriptionState (復元対象がなければ null)。
   * @idempotent true (同一 originalTransactionId は重複スキップ)
   * @retryable true
   */
  restorePurchases(
    userId: UserId,
    transactions: IapTransactionResult[],
  ): Promise<Result<{ restoredCount: number; subscription: SubscriptionState | null }>>;
}
```

### 5.2 新規 API エンドポイント (server 側追加)

`docs/architecture.md` §7.1 の既存エンドポイントに加え、Sprint 3 で以下を追加する。

| メソッド | パス | 対応 facade メソッド | 概要 |
|---------|------|-------------------|------|
| GET | `/api/billing/plans` | `getPlanComparison` | プラン比較ビュー取得 |
| POST | `/api/billing/upgrade-preview` | `previewUpgrade` | アップグレード日割り計算 |
| POST | `/api/billing/iap/apple/transaction` | `recordIapTransaction` | IAP トランザクション記録 |
| POST | `/api/billing/iap/apple/restore` | `restorePurchases` | 購入復元 |
| POST | `/api/billing/external-purchase/start` | `startExternalPurchase` | External Purchase 開始 |
| POST | `/api/billing/external-purchase/complete` | `completeExternalPurchase` | External Purchase 完了 |
| DELETE | `/api/billing/subscription` | `cancelSubscription` | サブスクリプションキャンセル |

**Rate limit** (server middleware で実装、facade 側は非実装):
- `POST /api/billing/iap/apple/restore`: 5 req/min/user
- `POST /api/billing/upgrade-preview`: 10 req/min/user

---

## 6. Stripe Web 課金フロー

### 6.1 概要

Web ブラウザ上の Stripe Checkout Session を使った課金フロー。mobile からブラウザを起動し、決済完了後に deep link でアプリに戻る。主に海外向け B2B / Stripe Web チャネルを選択したユーザー向け。

### 6.2 シーケンス図

```
mobile UI          apps/server         BillingFacade       StripeAdapter        Stripe
    |                   |                    |                    |                |
    |-- タップ: アップグレード -->|            |                    |                |
    |                   |                    |                    |                |
    |-- POST /api/billing/checkout -------->|                    |                |
    |   { tier, channel: "stripe_web" }     |                    |                |
    |                   |--- createCheckoutSession ------------->|                |
    |                   |                   |--- createCheckoutSession ---------->|
    |                   |                   |                    |<-- { url, id } |
    |                   |<-- { url: string } -------------------|                |
    |<-- { checkoutUrl, sessionId, expiresAt } ------------------|               |
    |                   |                   |                    |                |
    |-- Linking.openURL(checkoutUrl) →ブラウザ起動                 |                |
    |                   |                   |                    |                |
    |                                       Stripe Checkout 画面 (ブラウザ)        |
    |                                       ユーザーがカード入力 → 決済             |
    |                                       success_url へリダイレクト             |
    |                                       trancall://billing/stripe-success     |
    |                                       ?session_id=cs_xxx                   |
    |                   |                   |                    |                |
    |<-- deep link 受信 (AppLinkHandler)    |                    |                |
    |-- billingStore.refreshSubscription() -->|                  |                |
    |                   |--- getSubscription ------------------->|                |
    |                   |<-- SubscriptionState ------------------|                |
    |<-- UI 反映 (プラン更新済み)             |                    |                |
    |                   |                   |                    |                |
    |                   |   (並列) Stripe webhook POST /api/billing/webhook/stripe  |
    |                   |<-- webhook { type: "checkout.session.completed" } -------|
    |                   |--- handleStripeWebhook --------------->|                |
    |                   |                   |--- verifyWebhook ----------------->|
    |                   |                   |                    |<-- verified    |
    |                   |                   |--- subscriptionRepo.updatePlan()   |
    |                   |                   |--- EventBus.publish("billing.subscription_upgraded")
    |                   |<-- ok(true) -------|                    |                |
```

### 6.3 ステップ詳細

**Step 1: アップグレードタップ**
- ユーザーが Settings → Subscription 画面でプランを選択し「アップグレード」をタップ
- billingStore が `pendingTransaction = { channel: "stripe_web", targetTier, startedAt }` をセット
- loading インジケータを表示

**Step 2: Checkout Session 作成**
- `POST /api/billing/checkout { tier, channel: "stripe_web" }`
- server: `createCheckoutSession(userId, tier, "stripe_web")`
- StripeAdapter が `success_url = "trancall://billing/stripe-success?session_id={CHECKOUT_SESSION_ID}"` を Stripe に渡す
- `cancel_url = "trancall://billing/stripe-cancel"` も設定

**Step 3: ブラウザ起動**
- `Linking.openURL(checkoutUrl)` で外部ブラウザ (iOS: SFSafariViewController 推奨) を起動
- billingStore は `checkoutSession` に `{ checkoutUrl, sessionId, expiresAt, targetTier, returnUrl }` を保存

**Step 4: 決済**
- Stripe Checkout でユーザーがカード情報を入力し決済
- 成功時: `success_url` (`trancall://billing/stripe-success?session_id=cs_xxx`) にリダイレクト
- キャンセル時: `cancel_url` (`trancall://billing/stripe-cancel`) にリダイレクト

**Step 5: deep link 受信**
- AppLinkHandler が `trancall://billing/stripe-success` を受信
- `billingStore.onStripeSuccess(sessionId)` を呼び出し
- `GET /api/billing/subscription` でサブスク状態を再取得 (楽観的更新は禁止)
- `pendingTransaction = null`、UI を最新状態に反映

**Step 6: Webhook 処理 (並列)**
- Stripe が server に `POST /api/billing/webhook/stripe` を送信
- `handleStripeWebhook` が署名検証 → `checkout.session.completed` を処理
- `subscriptionRepo.updatePlan` で DB 更新
- EventBus で `billing.subscription_upgraded` を発行

### 6.4 失敗ケース

| 失敗ケース | 発生タイミング | 対応 |
|---|---|---|
| `createCheckoutSession` タイムアウト | Step 2 | `BILLING_UPGRADE_PREVIEW_FAILED` で UI にエラー表示、`pendingTransaction = null` |
| ユーザーがブラウザでキャンセル | Step 4 | `trancall://billing/stripe-cancel` deep link → `pendingTransaction = null`、通常 UI に戻る |
| deep link 未受信 (ブラウザを閉じた) | Step 5 | アプリ前景復帰時に `billingStore.refreshSubscription()` を自動呼び出し |
| Webhook 未着 (Stripe 側の遅延) | Step 6 | deep link で先に UI 反映済み。Webhook は後から到着して DB を確定更新 (冪等なので問題なし) |
| Checkout Session 期限切れ | Step 3-4 | Stripe が 24h 後に期限切れ。`billingStore.checkoutSession.expiresAt` を監視し、期限切れなら再作成を促す |

---

## 7. iOS App Store IAP (StoreKit 2) フロー

### 7.1 概要

iOS App Store の In-App Purchase (StoreKit 2) を使った課金フロー。Apple 標準の決済 UI (Face ID / Touch ID 認証付き) を使うため、ユーザー体験が最もシームレス。

### 7.2 productId 定義

| PlanTier | productId |
|---|---|
| `light` | `com.trancall.subscription.light.monthly` |
| `standard` | `com.trancall.subscription.standard.monthly` |
| `business` | `com.trancall.subscription.business.monthly` |

App Store Connect でこれらの productId を事前登録すること (Sprint 3 タスク)。

### 7.3 シーケンス図

```
mobile UI          react-native-iap    iOS StoreKit 2      apps/server         BillingFacade   AppleIapAdapter
    |                   |                    |                   |                   |               |
    |-- タップ: アップグレード -->|            |                   |                   |               |
    |                   |                    |                   |                   |               |
    |-- getProducts(["com.trancall.subscription.light.monthly", ...]) -->|          |               |
    |<-- [{ productId, price, localizedPrice, title, ... }] ------------|          |               |
    |-- 価格表示更新 (App Store の現地通貨価格)                          |           |               |
    |                   |                    |                   |                   |               |
    |-- タップ: 購入確定 -->|                  |                   |                   |               |
    |                   |-- requestSubscription(productId) -->|   |                   |               |
    |                   |                    |                   |                   |               |
    |                   |     iOS native 決済 UI 表示 (Face ID / Touch ID)           |               |
    |                   |     ユーザー認証 → Apple 課金処理                            |               |
    |                   |                    |                   |                   |               |
    |                   |<-- Transaction { originalTransactionId, signedJws, ... } --|              |
    |                   |                    |                   |                   |               |
    |-- Transaction 受信 (IapTransactionResult に変換)             |                   |               |
    |-- pendingTransaction をセット                                |                   |               |
    |                   |                    |                   |                   |               |
    |-- POST /api/billing/iap/apple/transaction ----------------->|                   |               |
    |   { originalTransactionId, productId, signedJws, ... }      |                   |               |
    |                   |                    |-- recordIapTransaction ----------->|   |               |
    |                   |                    |                   |--- verifyJws -->|  |               |
    |                   |                    |                   |   (App Store Server API)           |
    |                   |                    |                   |<-- { valid: true, tier } ---------|
    |                   |                    |                   |--- subscriptionRepo.updatePlan()   |
    |                   |                    |<-- { subscription: SubscriptionState } |               |
    |<-- { subscription } ----------------------------------------------------------|               |
    |                   |                    |                   |                   |               |
    |-- billingStore.subscription = subscription                  |                   |               |
    |-- pendingTransaction = null                                  |                   |               |
    |-- UI 反映 (プラン更新済み)                                   |                   |               |
    |                   |                    |                   |                   |               |
    |   (並列) App Store → server: S2S Notification               |                   |               |
    |                   |                    |-- POST /api/billing/webhook/apple -->|  |               |
    |                   |                    |                   |--- handleAppleIapWebhook -------->|
    |                   |                    |                   |<-- ok(true) ------|               |
```

### 7.4 ステップ詳細

**Step 1: 価格取得**
- `react-native-iap` の `getSubscriptions([productIds])` で App Store から現地通貨の価格を取得
- `PlanComparisonView` の `monthlyPriceYen` は参考値。**App Store が返す `localizedPrice` が課金画面の表示価格**
- (理由: App Store は税・為替・価格調整を自動適用する)

**Step 2: 購入リクエスト**
- `requestSubscription({ sku: productId })` → iOS native 決済 UI が表示される
- ユーザーが Face ID / Touch ID / パスコードで認証 → Apple が課金処理

**Step 3: Transaction 受信**
- `react-native-iap` の `purchaseUpdatedListener` で `Transaction` を受信
- `IapTransactionResult` に変換して billingStore に一時保存
- `pendingTransaction` をセット

**Step 4: server に送信**
- `POST /api/billing/iap/apple/transaction { ...IapTransactionResult }`
- server: `recordIapTransaction(userId, transaction)`
- `AppleIapAdapter.verifyJws(signedJws)` で Apple App Store Server API を使い JWS 署名を検証
- 検証成功: `productId` から `tier` を解決し `subscriptionRepo.updatePlan` で DB 更新

**Step 5: UI 反映**
- server から返ってきた `SubscriptionState` を billingStore に反映
- `pendingTransaction = null`、success toast を表示

**Step 6: S2S Notification (並列)**
- App Store が server に `POST /api/billing/webhook/apple` で通知を送信
- `handleAppleIapWebhook` で処理 (購入確定・更新・キャンセル等)

### 7.5 失敗ケース

| 失敗ケース | 発生タイミング | 対応 |
|---|---|---|
| ユーザーがキャンセル | Step 2 | `E_USER_CANCELLED` → `pendingTransaction = null`、エラー表示なしで通常 UI に戻る |
| Apple 課金失敗 (カード不足等) | Step 2 | `BILLING_PAYMENT_FAILED` UI エラー + 「再試行」ボタン |
| JWS 検証失敗 | Step 4 | `BILLING_IAP_RECEIPT_INVALID` → 「購入を復元」ボタンを促す |
| server タイムアウト | Step 4 | 10 秒タイムアウト後に `BILLING_IAP_RECEIPT_INVALID` → 「購入を復元」で再試行 |
| `originalTransactionId` 重複 | Step 4 | server が 409 相当で `ok(true)` を返す (冪等)。DB は既存状態を維持 |

---

## 8. StoreKit External Purchase フロー

### 8.1 前提: 対象国と法的要件

Apple の **StoreKit External Link Entitlement** は国・地域によって利用可否が異なる:

| 地域 | 利用可否 | 手数料 | 備考 |
|---|---|---|---|
| 日本 | 可 (MSCA 対象) | 27% (Small Business: 12%) | Apple 月次レポート義務あり |
| EU 加盟国 | 可 (DMA 対象) | 27% (Small Business: 12%) | 開示画面表示が法的義務 |
| 韓国 | 可 | 26% (Small Business: 11%) | |
| インド | 可 | 27% (Small Business: 12%) | |
| 米国 (一般) | 不可 | — | Reader App 限定、TranCall は該当しない |

**重要**: External Purchase は IAP に比べて手続き・義務が複雑。以下を厳守すること:
- Apple 規定の「開示シート」("`Apple との取引でなくなります`" 旨の警告) を表示してユーザーの同意を得てから外部リンクを開く
- Stripe での決済完了後、Apple External Purchase Server API に取引報告が必要

### 8.2 シーケンス図

```
mobile UI            apps/server          BillingFacade       StripeAdapter    Apple ExtPurchase API
    |                     |                    |                    |                   |
    |-- 対象国判定 (Locale.current.region) -->  |                    |                   |
    |<-- "外部リンク決済" ボタン表示            |                    |                   |
    |                     |                    |                    |                   |
    |-- タップ: 外部リンク決済 -->|              |                    |                   |
    |                     |                    |                    |                   |
    | [規約上必須: 開示ダイアログ表示]           |                    |                   |
    | "アプリ外のウェブサイトで購入します。        |                    |                   |
    |  Apple との取引ではなくなります。"          |                    |                   |
    |                     |                    |                    |                   |
    |-- ユーザーが同意 -->  |                    |                    |                   |
    |                     |                    |                    |                   |
    |-- POST /api/billing/external-purchase/start ------------------>|                   |
    |   { targetTier }    |                    |                    |                   |
    |                     |--- startExternalPurchase ------------->|                   |
    |                     |                   |--- createCheckoutSession ------------>|
    |                     |                   |<-- { url, sessionId } --------------|
    |                     |                   |--- reportExternalPurchaseToken() --->|  (Apple へ取引開始報告)
    |                     |<-- { redirectUrl } --------------------|                   |
    |<-- { redirectUrl } --|                   |                    |                   |
    |                     |                    |                    |                   |
    |-- StoreKit.ExternalPurchaseLink.open(redirectUrl) → Safari   |                   |
    |                     |                    |                    |                   |
    |           Safari: Stripe Checkout (外部ブラウザ)               |                   |
    |           ユーザーがカード入力 → 決済完了                        |                   |
    |           success_url = "trancall://billing/external-success  |                   |
    |                         ?token=REDIRECT_TOKEN"               |                   |
    |                     |                    |                    |                   |
    |<-- deep link 受信 (trancall://billing/external-success)       |                   |
    |-- POST /api/billing/external-purchase/complete  ------------>|                   |
    |   { redirectToken, stripeSubscriptionId, completedAt }        |                   |
    |                     |--- completeExternalPurchase ---------->|                   |
    |                     |                   |--- validateRedirectToken()            |
    |                     |                   |--- subscriptionRepo.updatePlan()      |
    |                     |                   |--- reportTransactionCompletion() ---->|  (Apple へ取引完了報告)
    |                     |<-- { subscription: SubscriptionState } |                   |
    |<-- { subscription } --|                  |                    |                   |
    |-- billingStore.subscription = subscription                    |                   |
    |-- UI 反映 (プラン更新済み)                |                    |                   |
```

### 8.3 ステップ詳細

**Step 1: 対象国判定**
- `Locale.current.region` (例: `"JP"`) を確認
- 対象国リスト (`["JP", "DE", "FR", "IT", "ES", "KR", "IN", ...]`) に含まれる場合、「外部リンク決済」ボタンを表示
- 非対象国では「App Store 決済」のみ表示

**Step 2: 開示ダイアログ (必須)**
- Apple ガイドライン必須: ユーザーに "App Store 外での購入になる" 旨を明示
- `StoreKit.ExternalPurchase.requestUserConfirmation()` を使用 (iOS 17.5+) または独自ダイアログ
- ユーザーが「同意」を選択した場合のみ次ステップへ
- 「キャンセル」選択: ダイアログを閉じて通常 UI に戻る

**Step 3: External Purchase 開始**
- `POST /api/billing/external-purchase/start { targetTier }`
- server: `startExternalPurchase(userId, targetTier)`
- StripeAdapter が Checkout Session を作成
- Apple External Purchase Server API に `externalPurchaseToken` を報告 (Stripe 側への連携完了通知)
- `success_url = "trancall://billing/external-success?token={SERVER_ISSUED_REDIRECT_TOKEN}"`

**Step 4: 外部ブラウザ起動**
- `Linking.openURL(redirectUrl)` または `StoreKit.ExternalPurchaseLink.open(url)`
- Safari / 外部ブラウザで Stripe Checkout が開く

**Step 5: 決済完了 → deep link**
- ユーザーがカード情報を入力 → Stripe が決済処理
- `success_url` (`trancall://billing/external-success?token=REDIRECT_TOKEN`) にリダイレクト
- mobile が deep link を受信

**Step 6: 完了処理**
- `POST /api/billing/external-purchase/complete { redirectToken, stripeSubscriptionId, completedAt }`
- server: `completeExternalPurchase(userId, redirect)`
- `redirectToken` の TTL (5 分) と使用済みフラグを検証
- `subscriptionRepo.updatePlan` で DB 更新
- Apple External Purchase Server API に取引完了を報告 (義務)

### 8.4 失敗ケース

| 失敗ケース | 対応 |
|---|---|
| ユーザーが開示ダイアログでキャンセル | 通常 UI に戻る、エラー表示なし |
| `startExternalPurchase` 失敗 | `BILLING_UPGRADE_PREVIEW_FAILED`、再試行ボタン |
| ユーザーが Safari で購入をキャンセル | deep link なし → アプリ前景復帰時に `refreshSubscription()` を実行 |
| `redirectToken` の TTL 切れ | `BILLING_CHANNEL_NOT_AVAILABLE`、「もう一度お試しください」+ 再開始ボタン |
| deep link 未受信 | アプリ前景復帰時に `billingStore.refreshSubscription()` を自動呼び出し |

---

## 9. プラン管理 UI (Settings → Subscription)

### 9.1 画面 Wireframe

```
┌─────────────────────────────────────────────────────────┐
│ ← Settings  /  Subscription                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  現在のプラン                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Light プラン              ¥980/月 (税込)         │   │
│  │ 次回更新: 2026-06-12                             │   │
│  │ ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  60% 使用                │   │
│  │ 残 12 分 / 30 分                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ──────────────── プラン変更 ────────────────            │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Free                   ¥0/月                    │   │
│  │ 5 分/月 · 保持 7 日                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Light [現在のプラン]    ¥980/月                   │   │
│  │ 30 分/月 · 超過 ¥40/分 · 保持 30 日              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ★ Standard [おすすめ]  ¥2,980/月                 │   │
│  │ 120 分/月 · 超過 ¥30/分 · 保持 90 日             │   │
│  │ [ この プランにアップグレード ]                   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Business                ¥9,800/月                │   │
│  │ 500 分/月 · 超過 ¥25/分 · 保持 365 日            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ─────────────────────────────────────────────────     │
│  [ 購入を復元 (Restore Purchases) ]                     │
│  [ サブスクリプションをキャンセル ]                      │
│  ─────────────────────────────────────────────────     │
│  [利用規約]  [プライバシーポリシー]                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 9.2 アップグレード確認ダイアログ (Stripe Web)

```
┌────────────────────────────────────────┐
│  アップグレードの確認                    │
├────────────────────────────────────────┤
│  Light → Standard                      │
│                                        │
│  今月の日割り請求: ¥1,240              │
│  (当月残り日数に基づいて計算)           │
│                                        │
│  次回請求日: 2026-06-12                │
│  ¥2,980/月                             │
│                                        │
│  [キャンセル]    [確認・続行]           │
└────────────────────────────────────────┘
```

### 9.3 状態遷移図

```
                   ┌────────────┐
  画面マウント      │   loading  │
 ─────────────── → │            │
                   │ API 呼び出し│
                   └─────┬──────┘
                         │ 成功
                   ┌─────↓──────┐
                   │  showing   │ ← refreshSubscription()
                   │            │
                   │ プラン一覧  │
                   │ 表示中     │
                   └─────┬──────┘
                         │ アップグレードタップ
                   ┌─────↓──────┐
                   │ confirming │
                   │            │
                   │ 確認ダイアログ│
                   └──┬─────┬───┘
             キャンセル│     │確認
                   ↙         ↘
          ┌────────┐     ┌──────────┐
          │showing │     │upgrading │
          └────────┘     │          │
                         │ 決済処理中│
                         │ loading  │
                         └────┬─────┘
                              │
                   ┌──────────┴──────────┐
                   │ 成功                 │ 失敗
                   ↓                      ↓
             ┌─────────┐         ┌──────────────┐
             │ success │         │    error      │
             │         │         │               │
             │ toast 表示│        │ エラーダイアログ│
             │ UI 更新  │         └──────┬────────┘
             └────┬────┘                │ 再試行 or 閉じる
                  │                     │
                  └──────────┬──────────┘
                             ↓
                       ┌─────────┐
                       │ showing │ (再度プラン一覧表示)
                       └─────────┘
```

### 9.4 コンポーネント構成

```
SettingsSubscriptionScreen
├── CurrentPlanCard                 # 現在のプラン概要 + 残量プログレスバー
│   ├── PlanBadge                   # @trancall/ui-kit PlanCard
│   └── UsageProgressBar            # 残量 / 含有分数のバー
├── PlanList                        # プラン比較リスト
│   └── PlanCard × 4               # @trancall/ui-kit PlanCard (free/light/standard/business)
│       └── UpgradeButton           # 選択中プランのみ表示
├── ActionSection
│   ├── RestorePurchasesButton      # iOS 必須 (§12)
│   └── CancelSubscriptionButton   # iOS プランのみ表示 (Stripe は Stripe ポータルへ誘導)
├── LegalLinks                     # 利用規約 / プライバシーポリシー
├── LoadingOverlay                 # upgrading 状態中に全体に表示
└── BillingErrorSheet              # エラー発生時の bottom sheet (§11)
```

### 9.5 UI 実装ルール

- 共通コンポーネントは `@trancall/ui-kit` 経由 (`PlanCard` / `Button` / `Card`)
- 画面内で直接スタイルを書かない、tokens (`colors` / `spacing` / `typography` / `radii`) のみ参照
- 文言は `@trancall/ui-kit/src/i18n/locales/{ja,en,zh}.json` から取得
- light / dark テーマ対応必須
- WCAG 2.1 AA: コントラスト 4.5:1、全 Pressable に `accessibilityLabel` + `accessibilityRole`
- `isRecommended=true` のプラン (standard) は `★ おすすめ` バッジを表示 (`colors.primary` のアクセント)
- App Store の価格表示ルール: IAP チャネルでは App Store が返す `localizedPrice` を優先表示

---

## 10. Pre-call コスト見積 UI + Home 残量表示

### 10.1 Pre-call 画面でのコスト見積

SCR-009 Pre-call setup 画面で通話開始前にコストを表示する (BILL-008 要件)。

**表示位置**: 翻訳設定セクションの下、「通話を開始」ボタンの上

**Wireframe**:

```
┌──────────────────────────────────────────────┐
│  コスト見積                                    │
│  ─────────────────────────────────────────  │
│  想定通話時間: 15 分                           │
│  残り分数: 12 分 (Light プラン)                │
│  ⚠ 超過 3 分 → 予測コスト ¥120               │
│                                              │
│  [ アップグレードして始める ]                  │
│  [ このまま通話を開始 ]                        │
└──────────────────────────────────────────────┘
```

**計算ロジック**:

```ts
// apps/mobile/src/stores/billing-store.ts
function computePreCallCostEstimate(
  subscriptionState: SubscriptionState,
  expectedMinutes: number,
): PreCallCostEstimate {
  const { remainingMinutes, plan } = subscriptionState;
  const overageMinutes = Math.max(0, expectedMinutes - remainingMinutes);
  const predictedCostYen = Math.ceil(overageMinutes * plan.overageRateYen);
  const willExceedQuota = expectedMinutes > remainingMinutes;

  let recommendedAction: PreCallCostEstimate["recommendedAction"];
  if (!willExceedQuota) {
    recommendedAction = "proceed";
  } else if (plan.tier === "free") {
    recommendedAction = "upgrade";   // Free は超過課金なし → アップグレード必須
  } else {
    recommendedAction = "warn_overage";
  }

  return {
    expectedMinutes,
    remainingMinutes,
    predictedCostYen,
    willExceedQuota,
    recommendedAction,
  };
}
```

**`expectedMinutes` の推定方法**: Sprint 3 では固定値 15 分を使用。Sprint 3 後半で通話履歴から平均を算出する予定 (Sprint 3 タスク化)。

**`recommendedAction` 別 UI**:

| recommendedAction | UI 表示 |
|---|---|
| `"proceed"` | 緑色チェック + 「残量十分です」、「通話を開始」ボタンのみ表示 |
| `"warn_overage"` | 黄色警告 + 「超過 N 分 → ¥XXX の見込み」、「このまま通話を開始」+「アップグレードして始める」を表示 |
| `"upgrade"` | 赤色アイコン + 「翻訳分数が不足しています」、「プランをアップグレード」ボタンのみ表示 (通話開始ブロック) |

### 10.2 Home 画面での残量表示

SCR-002 Home (Recent) 画面のヘッダー下部に残量を常時表示する (BILL-008 要件、design-system.md canonical)。

**表示文言**: `残り {{minutes}} 分（{{plan}}プラン）`  (ja) / `{{minutes}} min remaining ({{plan}})` (en)

**更新タイミング**:
1. アプリ起動時: `billingStore` が `GET /api/billing/subscription` を呼び出し
2. 通話終了後: `reconcile` 完了後に `refreshSubscription()` を自動呼び出し
3. heartbeat 受信: Agent からの heartbeat response に含まれる `remainingMinutes` で即時更新
4. Settings → Subscription 画面表示時: `refreshSubscription()` を呼び出し

**残量が 0 以下の場合**: `¥0 / 翻訳利用不可（Freeプラン）` または `残 0 分（Lightプラン）` と表示。通話開始時に Pre-call 画面でブロック (BILL-009 要件)。

### 10.3 通話終了後コストサマリー (Call Summary)

SCR-011 Call summary 画面でのコスト表示 (BILL-010 要件)。heartbeat 課金の詳細は `billing-detail.md` canonical のため本書では触れない。

**表示項目**:
- 翻訳通話時間: N 分 M 秒
- 含有分数消費: N 分
- 超過分数: N 分 (0 の場合は非表示)
- 今回のコスト: ¥XXX (超過分のみ、0 なら「含有分内」と表示)
- 残り分数: N 分 (reconcile 後の最新値)

---

## 11. エラーハンドリングと UI 文言 (i18n)

### 11.1 新規 Error Code (本書で追加)

以下は Sprint 3 で `docs/module-contracts.md` §5 に追加する新規 error code。billing モジュール所有。

| エラーコード | 所有モジュール | HTTP | retryable |
|---|---|---|---|
| `BILLING_IAP_RECEIPT_INVALID` | billing | 400 | true |
| `BILLING_UPGRADE_PREVIEW_FAILED` | billing | 503 | true |
| `BILLING_RESTORE_NO_PURCHASE` | billing | 200 (正常系) | false |
| `BILLING_CHANNEL_NOT_AVAILABLE` | billing | 400 | false |

※ `BILLING_INSUFFICIENT_BALANCE` / `BILLING_PAYMENT_FAILED` / `BILLING_INVALID_RECEIPT` / `BILLING_CHANNEL_NOT_AVAILABLE` は `docs/module-contracts.md` §5 に既存定義あり。

### 11.2 BillingErrorViewModel テーブル (ja / en / zh)

i18n キー命名規則: `billing.error.{code}.{title|message|action}`
追加先: `@trancall/ui-kit/src/i18n/locales/{ja,en,zh}.json`

| code | ja タイトル | ja 本文 | ja action label | retryable |
|---|---|---|---|---|
| `BILLING_INSUFFICIENT_BALANCE` | 翻訳分数が足りません | プランの上限を超えています。アップグレードまたは購入で続けられます。 | アップグレード | false |
| `BILLING_PAYMENT_FAILED` | 決済に失敗しました | カード情報をご確認ください。 | 再試行 | true |
| `BILLING_INVALID_RECEIPT` | 購入情報の検証に失敗しました | 購入を復元してください。 | 復元 | false |
| `BILLING_IAP_RECEIPT_INVALID` | レシート検証エラー | App Store での購入処理が完了していない可能性があります。 | 復元 | true |
| `BILLING_UPGRADE_PREVIEW_FAILED` | 見積取得に失敗しました | 接続を確認して再試行してください。 | 再試行 | true |
| `BILLING_RESTORE_NO_PURCHASE` | 復元できる購入がありません | このアカウントには有効な購入履歴がありません。 | 閉じる | false |
| `BILLING_CHANNEL_NOT_AVAILABLE` | この地域では利用できません | お住まいの地域では選択された購入方法が利用できません。 | 別の方法を選ぶ | false |
| `NETWORK_ERROR` | 接続できません | ネットワークを確認してください。 | 再試行 | true |
| `INTERNAL_ERROR` | エラーが発生しました | 時間をおいて再試行してください。 | 再試行 | true |

| code | en title | en message | en action label |
|---|---|---|---|
| `BILLING_INSUFFICIENT_BALANCE` | Insufficient minutes | You've reached your plan limit. Upgrade to continue. | Upgrade |
| `BILLING_PAYMENT_FAILED` | Payment failed | Please check your payment details. | Try again |
| `BILLING_INVALID_RECEIPT` | Purchase verification failed | Please restore your purchases. | Restore |
| `BILLING_IAP_RECEIPT_INVALID` | Receipt verification error | Your App Store purchase may not have completed. | Restore |
| `BILLING_UPGRADE_PREVIEW_FAILED` | Failed to load estimate | Check your connection and try again. | Try again |
| `BILLING_RESTORE_NO_PURCHASE` | No purchases to restore | No active purchases found for this account. | Close |
| `BILLING_CHANNEL_NOT_AVAILABLE` | Not available in your region | The selected payment method is not available in your region. | Choose another |
| `NETWORK_ERROR` | Can't connect | Check your network connection. | Try again |
| `INTERNAL_ERROR` | Something went wrong | Please try again later. | Try again |

| code | zh 标题 | zh 正文 | zh 操作 |
|---|---|---|---|
| `BILLING_INSUFFICIENT_BALANCE` | 翻译时长不足 | 您已超出套餐限额，请升级以继续使用。 | 升级 |
| `BILLING_PAYMENT_FAILED` | 支付失败 | 请检查您的支付信息。 | 重试 |
| `BILLING_INVALID_RECEIPT` | 购买验证失败 | 请恢复您的购买记录。 | 恢复 |
| `BILLING_IAP_RECEIPT_INVALID` | 收据验证错误 | App Store 的购买可能未完成。 | 恢复 |
| `BILLING_UPGRADE_PREVIEW_FAILED` | 获取估算失败 | 请检查网络连接后重试。 | 重试 |
| `BILLING_RESTORE_NO_PURCHASE` | 无可恢复的购买 | 该账户没有有效的购买记录。 | 关闭 |
| `BILLING_CHANNEL_NOT_AVAILABLE` | 此地区不可用 | 所选支付方式在您所在的地区不可用。 | 选择其他方式 |
| `NETWORK_ERROR` | 无法连接 | 请检查您的网络连接。 | 重试 |
| `INTERNAL_ERROR` | 发生错误 | 请稍后重试。 | 重试 |

### 11.3 AppError → BillingErrorViewModel 変換関数

```ts
// apps/mobile/src/stores/billing-store.ts
import { t } from "@trancall/ui-kit/src/i18n";
import type { BillingErrorViewModel, AppErrorCode } from "./billing-store.js";

export function mapAppErrorToBillingErrorViewModel(
  code: AppErrorCode,
  retryable: boolean,
): BillingErrorViewModel {
  return {
    code,
    title: t(`billing.error.${code}.title`),
    message: t(`billing.error.${code}.message`),
    actionLabel: t(`billing.error.${code}.action`),
    retryable,
  };
}
```

### 11.4 エラー UI パターン

| エラー分類 | UI 表示パターン |
|---|---|
| `retryable: true` | bottom sheet + 「再試行」ボタン + 「閉じる」ボタン |
| `retryable: false` + `actionLabel: "閉じる"` | bottom sheet + 「閉じる」ボタンのみ |
| `retryable: false` + アクション付き | bottom sheet + アクションボタン (アップグレード/復元/別の方法) + 「閉じる」 |
| ユーザーキャンセル | エラー表示なし、通常 UI に戻るだけ |

---

## 12. Restore Purchases (iOS 必須)

### 12.1 要件

Apple App Store ガイドラインにより、iOS アプリは「以前の購入を復元」機能を Settings 画面に必置。本機能を欠く場合、App Store 審査でリジェクトされる。

### 12.2 シーケンス図

```
mobile UI           iOS StoreKit 2       apps/server          BillingFacade      AppleIapAdapter
    |                    |                    |                    |                   |
    |-- タップ: 購入を復元 -->|               |                    |                   |
    |-- billingStore.isRestoring = true       |                    |                   |
    |                    |                    |                    |                   |
    |-- StoreKit.Transaction.currentEntitlements -->|              |                   |
    |<-- [Transaction, Transaction, ...]  ----|                    |                   |
    |                    |                    |                    |                   |
    | (IapTransactionResult[] に変換)         |                    |                   |
    |                    |                    |                    |                   |
    |-- POST /api/billing/iap/apple/restore ------------------------>|                |
    |   { transactions: [IapTransactionResult, ...] }              |                   |
    |                    |                   |--- restorePurchases(userId, transactions) -->|
    |                    |                   |                    | (各 transaction を検証)     |
    |                    |                   |                    |--- verifyJws() ---------> |
    |                    |                   |                    |<-- { valid } -------------|
    |                    |                   |                    |--- subscriptionRepo.updatePlan()
    |                    |                   |<-- { restoredCount, subscription } --|        |
    |<-- { restoredCount, subscription } ----|                    |                   |
    |-- billingStore.subscription = subscription                   |                   |
    |-- billingStore.isRestoring = false      |                    |                   |
    |-- toast 表示: "N件の購入を復元しました"  |                    |                   |
```

### 12.3 ステップ詳細

**Step 1: ユーザータップ**
- Settings → Subscription 画面の「購入を復元」ボタン
- `billingStore.isRestoring = true` → ボタンを disabled にし loading インジケータ表示

**Step 2: currentEntitlements 取得**
- `StoreKit.Transaction.currentEntitlements` (iOS 15+) で現在有効な subscription transaction を列挙
- `IapTransactionResult[]` に変換

**Step 3: server に送信**
- `POST /api/billing/iap/apple/restore { transactions: [...] }`
- Rate limit: 5 req/min/user (middleware で実装)

**Step 4: server 側処理**
- `restorePurchases(userId, transactions)`
- 各 transaction に対して `AppleIapAdapter.verifyJws` で検証
- 最新の有効な transaction から `tier` を解決し `subscriptionRepo.updatePlan` で DB 更新
- `restoredCount`: 検証に成功した transaction 数
- `subscription`: 更新後の `SubscriptionState` (有効な transaction がなければ `null`)

**Step 5: UI 反映**
- `billingStore.subscription = subscription`
- `billingStore.isRestoring = false`
- toast 表示:
  - `restoredCount > 0`: `"${restoredCount}件の購入を復元しました"` (ja) / `"${restoredCount} purchase(s) restored"` (en)
  - `restoredCount === 0` (subscription = null): `BILLING_RESTORE_NO_PURCHASE` エラー表示

### 12.4 注意事項

- **Restore 時は新たな課金は発生しない**: 既存 transaction の再確認のみ
- **Restore は冪等**: 同一 `originalTransactionId` は重複スキップ
- **`currentEntitlements` が空の場合**: `transactions = []` で server に送り、`restoredCount=0` として処理
- **Restore 失敗時**: `BILLING_IAP_RECEIPT_INVALID` を表示し再試行を促す

---

## 13. 状態遷移と source of truth

### 13.1 Subscription の真実

- **source of truth = server 側 `trancall_billing.subscriptions` テーブル**
- mobile `billingStore` (Zustand) はミラー。楽観的更新は**禁止** (課金は事実上の整合性が必要)

### 13.2 billingStore の同期戦略

| トリガー | アクション |
|---|---|
| アプリ起動時 | `GET /api/billing/subscription` を呼び出し |
| 通話終了 (reconcile 完了後) | `GET /api/billing/subscription` を呼び出し |
| Stripe success deep link 受信 | `GET /api/billing/subscription` を呼び出し |
| External Purchase success deep link 受信 | `GET /api/billing/subscription` を呼び出し |
| IAP transaction 送信完了 | `recordIapTransaction` の Result から直接 `SubscriptionState` を取得 |
| Settings → Subscription 画面表示時 | `GET /api/billing/subscription` を呼び出し |
| heartbeat response 受信 (通話中) | response 内の `remainingMinutes` で `billingStore.subscriptionState.remainingMinutes` を部分更新 |

**heartbeat での部分更新について**: heartbeat は全体の `SubscriptionState` を返さない (billing-detail.md 参照)。`remainingMinutes` のみ更新し、他のフィールドは前回取得値を維持する。

### 13.3 billingStore の Zustand パターン

既存の `call-store.ts` / `auth-store.ts` と同じパターンを踏襲:

```ts
// apps/mobile/src/stores/billing-store.ts (Sprint 3 新規、パターン概要)
import { create } from "zustand";
import type { BillingScreenState } from "./billing-store.types.js";

interface BillingStoreActions {
  refreshSubscription: () => Promise<void>;
  startUpgrade: (targetTier: PlanTier, channel: PurchaseChannel) => Promise<void>;
  onStripeSuccess: (sessionId: string) => Promise<void>;
  onExternalPurchaseSuccess: (redirect: StoreKitExternalRedirectResult) => Promise<void>;
  onIapTransaction: (transaction: IapTransactionResult) => Promise<void>;
  restorePurchases: (transactions: IapTransactionResult[]) => Promise<void>;
  cancelSubscription: (atPeriodEnd: boolean) => Promise<void>;
  clearError: () => void;
}

export const useBillingStore = create<BillingScreenState & BillingStoreActions>((set, get) => ({
  // 初期状態 (BillingScreenState の初期値)
  subscriptionState: null,
  planComparison: null,
  pendingTransaction: null,
  lastError: null,
  isRestoring: false,
  checkoutSession: null,

  // Actions は Sprint 3 で実装
}));
```

### 13.4 楽観的更新の禁止

課金情報の楽観的更新は禁止する。理由:
- 決済の失敗・遅延で UI と DB が乖離すると、ユーザーが無効なプランで通話できる
- サーバーの `subscriptionRepo.updatePlan` が完了してから UI を更新する
- `pendingTransaction` で処理中状態を表現し、完了まで loading UI を表示する

---

## 14. テスト戦略

### 14.1 テスト階層

| 階層 | フレームワーク | 対象 | 場所 |
|---|---|---|---|
| unit (billing facade) | vitest | 新規 facade メソッド 7 種 | `packages/billing/__tests__/` |
| unit (mobile store) | vitest + jest (RN) | billingStore の actions | `apps/mobile/src/__tests__/billing-store.test.ts` |
| unit (schema) | vitest | Zod スキーマ §4 の 9 種 | `packages/billing/__tests__/schemas.test.ts` |
| integration | vitest | Webhook 受信 → state 反映 / IAP transaction → DB 更新 | `packages/integration-tests/__tests__/billing-ui.integration.test.ts` |
| sandbox | Stripe test mode / Apple Sandbox Tester | 4 チャネルの実 SDK 通過 | 手動 + Maestro |
| E2E | Maestro | Settings → Subscription → upgrade → success | `apps/mobile/e2e/billing-upgrade.yaml` |

### 14.2 unit テスト詳細 (facade)

新規 facade メソッドごとに以下のテストケースを必須とする:

**`getPlanComparison`**:
- 正常系: Free プランユーザーが 4 プランの比較を取得
- 正常系: Business プランユーザーが `isCurrent=true` を持つ Business を含む比較を取得

**`previewUpgrade`**:
- 正常系: Light → Standard で `proratedAmountYen > 0`
- 正常系: Free → Standard で `proratedAmountYen = 0` (Stripe 側で計算)
- 異常系: 同じプランへのアップグレードで `BILLING_UPGRADE_PREVIEW_FAILED`

**`recordIapTransaction`**:
- 正常系: 有効な signedJws で `SubscriptionState` が更新される
- 異常系: 無効な signedJws で `BILLING_IAP_RECEIPT_INVALID`
- 冪等性: 同一 `originalTransactionId` で 2 回呼び出しても 1 回のみ更新

**`startExternalPurchase`**:
- 正常系: `redirectUrl` が返る
- 異常系: Stripe API 失敗で `BILLING_UPGRADE_PREVIEW_FAILED`

**`completeExternalPurchase`**:
- 正常系: 有効な `redirectToken` でサブスク更新
- 異常系: TTL 切れ `redirectToken` で `BILLING_CHANNEL_NOT_AVAILABLE`
- 異常系: 使用済み `redirectToken` で `BILLING_CHANNEL_NOT_AVAILABLE`

**`cancelSubscription`**:
- 正常系: `atPeriodEnd=true` で `cancelAtPeriodEnd=true` がセットされる
- 異常系: IAP チャネルで `atPeriodEnd=false` を渡した場合にエラー (即時キャンセル不可)

**`restorePurchases`**:
- 正常系: 有効な transaction 1 件で `restoredCount=1`
- 正常系: transactions=[] で `restoredCount=0, subscription=null`
- 異常系: 全て無効な signedJws で `restoredCount=0`

### 14.3 integration テスト

```ts
// packages/integration-tests/__tests__/billing-ui.integration.test.ts (Sprint 3 新規)
describe("BillingFacade integration", () => {
  describe("Stripe Web flow", () => {
    it("handleStripeWebhook で checkout.session.completed を受信後、subscription が更新される")
    it("同一 externalEventId の webhook は冪等処理される")
  })
  describe("Apple IAP flow", () => {
    it("recordIapTransaction で有効な JWS を受信後、subscription が iap_apple チャネルで更新される")
    it("restorePurchases で複数の transaction を一括検証し、最新の tier が反映される")
  })
  describe("StoreKit External flow", () => {
    it("startExternalPurchase → completeExternalPurchase で subscription が storekit_external チャネルで更新される")
    it("TTL 切れ redirectToken で BILLING_CHANNEL_NOT_AVAILABLE が返る")
  })
  describe("cancelSubscription", () => {
    it("atPeriodEnd=true で cancelAtPeriodEnd=true がセットされる")
    it("billing.subscription_canceled DomainEvent が EventBus に発行される")
  })
})
```

### 14.4 サンドボックス検証手順

**Stripe test mode**:
1. `STRIPE_SECRET_KEY` を test キー (`sk_test_...`) に設定
2. Stripe test card (`4242 4242 4242 4242`) で Stripe Web チャネルを通す
3. Stripe CLI で webhook をローカルに転送: `stripe listen --forward-to localhost:3000/api/billing/webhook/stripe`
4. `checkout.session.completed` を受信し、DB の `purchase_channel=stripe_web` を確認

**Apple Sandbox Tester**:
1. App Store Connect で Sandbox Tester アカウントを作成
2. iOS の設定 → App Store → Sandbox アカウントでログイン
3. TestFlight ビルドで IAP を実行
4. Apple Sandbox では S2S Notification が送信されること、JWS 検証が通ることを確認

**StoreKit External (日本地域設定)**:
1. iPhone の言語・地域を「日本」に設定
2. `Locale.current.region === "JP"` で「外部リンク決済」ボタンが表示されることを確認
3. 開示ダイアログが表示され、同意後に Stripe Checkout (test mode) が開くことを確認
4. deep link `trancall://billing/external-success?token=...` が受信されることを確認

### 14.5 E2E (Maestro)

```yaml
# apps/mobile/e2e/billing-upgrade.yaml (Sprint 3 新規)
# Settings → Subscription → upgrade → success の手動シナリオ自動化

appId: com.trancall.app
---
- launchApp
- assertVisible: "Settings"
- tapOn: "Subscription"
- assertVisible: "現在のプラン"
- tapOn: "Standard [おすすめ]"
- tapOn: "このプランにアップグレード"
- assertVisible: "アップグレードの確認"
- tapOn: "確認・続行"
# (Stripe Checkout を Maestro では通せないため、Stripe test mode での WebView 操作は手動)
```

---

## 15. セキュリティとリプレイ攻撃対策

### 15.1 Apple JWS 検証

- `AppleIapAdapter.verifyJws(signedJws)` は Apple App Store Server API (`/inApps/v1/transactions/{originalTransactionId}`) を呼び出して検証
- ECDSA 署名検証: Apple が公開している Root CA 証明書 (Apple Root CA - G3) を使って検証
- **JWS を client 側で解析・信頼するのは禁止** (改ざん可能)。必ず server 側で App Store Server API 経由で検証する

### 15.2 Stripe Webhook 署名検証

- `StripeAdapter.verifyWebhook(rawBody, signature)` が `Stripe-Signature` ヘッダを検証
- Stripe が提供する HMAC-SHA256 署名 (`whsec_...` webhook secret を使用)
- `rawBody` は必ず生の string を渡す (JSON.parse 後のオブジェクトは署名検証が通らない)

### 15.3 StoreKit External: redirectToken の保護

- `redirectToken` の発行: server が `crypto.randomBytes(32).toString("hex")` で生成
- TTL: 5 分 (`expiresAt = now() + 5 * 60 * 1000`)
- 使用フラグ: `used: boolean` (一度使ったら `true` にセット、再利用不可)
- 保存先: `trancall_billing.external_purchase_tokens` テーブル (Sprint 3 migration 追加)

```sql
-- Sprint 3 migration (apps/server/supabase/migrations/xxxxx_add_external_purchase_tokens.sql)
CREATE TABLE trancall_billing.external_purchase_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  token VARCHAR NOT NULL UNIQUE,
  target_tier VARCHAR NOT NULL,
  stripe_session_id VARCHAR NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON trancall_billing.external_purchase_tokens (token);
CREATE INDEX ON trancall_billing.external_purchase_tokens (expires_at) WHERE used = false;
```

### 15.4 IAP originalTransactionId の重複防止

`trancall_billing.subscriptions.iap_original_transaction_id` に UNIQUE 制約が必要。`docs/architecture.md` §6.2 の DB スキーマには列は定義されているが、UNIQUE 制約の有無を Sprint 3 で確認する。

```sql
-- Sprint 3 で確認・必要なら追加する migration
ALTER TABLE trancall_billing.subscriptions
  ADD CONSTRAINT subscriptions_iap_original_transaction_id_unique
  UNIQUE (iap_original_transaction_id);
```

この制約がないと、`restorePurchases` や `recordIapTransaction` の冪等性が DB レベルで保証されない。

### 15.5 Rate Limit

| エンドポイント | Rate Limit |
|---|---|
| `POST /api/billing/iap/apple/restore` | 5 req/min/user |
| `POST /api/billing/iap/apple/transaction` | 10 req/min/user |
| `POST /api/billing/upgrade-preview` | 10 req/min/user |
| `POST /api/billing/external-purchase/start` | 5 req/min/user |

Rate limit は server middleware (`apps/server/src/middleware/rate-limit.ts`) で実装。billing facade 側では非実装。

### 15.6 ログの PII 除外

以下の情報はログに出力**禁止**:
- `IapTransactionResult.signedJws` (JWS 全体)
- `StripeAdapter` が受け取る `rawBody` の全体 (署名検証前のデータ)
- `StoreKitExternalRedirectResult.redirectToken`
- `SubscriptionState.stripeCustomerId` / `stripeSubscriptionId`
- `SubscriptionState.iapOriginalTransactionId`

ログに出力してよい情報:
- `userId` (UUID のみ、email / 氏名は不可)
- `sessionId` / `webhookId`
- エラーコード (`code: "BILLING_IAP_RECEIPT_INVALID"` 等)
- `tier` / `channel` / `restoredCount` 等の非機密フィールド

### 15.7 Apple External Purchase Server API への取引報告義務

StoreKit External Purchase を使用する場合、Apple は取引開始・完了の報告を要求する:

1. **取引開始時** (`startExternalPurchase`): `POST https://api.storekit.itunes.apple.com/externalPurchase/v1/report` に `externalPurchaseToken` を報告
2. **取引完了時** (`completeExternalPurchase`): 完了した取引の情報を Apple に報告

報告を怠ると Apple との契約違反となる可能性がある。Sprint 3 タスクとして `AppleExternalPurchaseReporter` adapter の実装を追加すること。

---

## 16. 改訂履歴

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-05-12 | Sprint 2 D5 設計書 初版。Scope: Stripe Web / iOS IAP StoreKit 2 / StoreKit External Purchase / プラン管理 UI / Pre-call コスト見積 / Home 残量 / Restore Purchases / エラー文言 (ja/en/zh) / 状態遷移 / テスト戦略 / セキュリティ。新規 Zod スキーマ 9 種 (PlanComparisonView / UpgradePreview / CheckoutSessionViewModel / IapTransactionResult / StoreKitExternalRedirectResult / BillingScreenState / BillingErrorViewModel / PreCallCostEstimate / DomainEvent 2 種)、BillingFacade 拡張 7 メソッド、新規 error code 4 種 (BILLING_IAP_RECEIPT_INVALID / BILLING_UPGRADE_PREVIEW_FAILED / BILLING_RESTORE_NO_PURCHASE + 既存 BILLING_CHANNEL_NOT_AVAILABLE 再確認)、新規 DomainEvent 2 種 (billing.subscription_upgraded / billing.subscription_canceled)。PLAN_CONFIGS の実装値と requirements.md の乖離を記録 (Standard: ¥30/min、Business: ¥25/min が実装 canonical)。|
