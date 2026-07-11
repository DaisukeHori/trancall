/**
 * 課金エンドポイント
 *
 * GET  /api/billing/subscription
 * POST /api/billing/checkout
 * POST /api/billing/webhook/stripe
 * POST /api/billing/webhook/apple
 * POST /api/billing/webhook/google
 *
 * Sprint 3 T-10 追加:
 * POST /api/billing/iap/transaction          — IAP トランザクション記録
 * POST /api/billing/external-purchase/start  — StoreKit External Purchase 開始
 * POST /api/billing/external-purchase/complete — StoreKit External Purchase 完了
 * POST /api/billing/restore                  — 購入復元 (iOS 必須)
 * GET  /api/billing/plan-comparison          — プラン比較ビュー
 * POST /api/billing/preview-upgrade          — アップグレード日割りプレビュー
 * POST /api/billing/cancel                   — サブスクリプションキャンセル
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { BillingFacade, IapAdapterConfig } from "@trancall/billing";
import { verifyJwsSignature } from "@trancall/billing";
import { getHttpStatus } from "../middleware/error-handler.js";
import { verifyGooglePubSubOidcToken } from "../adapters/google-pubsub-oidc-adapter.js";

const CheckoutSchema = z.object({
  tier: z.enum(["free", "light", "standard", "business"]),
  paymentMethod: z.enum(["stripe_web", "storekit_external"]),
});

// Sprint 3 T-10 追加スキーマ (billing-ui-flow.md §4)

const PlanTierSchema = z.enum(["free", "light", "standard", "business"]);

const IapTransactionSchema = z.object({
  originalTransactionId: z.string().min(1),
  productId: z.string().min(1),
  purchaseDate: z.iso.datetime(),
  expirationDate: z.iso.datetime().nullable(),
  signedJws: z.string().min(1),
  isUpgrade: z.boolean(),
});

const StoreKitExternalRedirectSchema = z.object({
  redirectToken: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  completedAt: z.iso.datetime(),
});

const IapTransactionBodySchema = z.object({
  transaction: IapTransactionSchema,
});

const ExternalPurchaseStartSchema = z.object({
  targetTier: PlanTierSchema,
});

const ExternalPurchaseCompleteSchema = z.object({
  redirect: StoreKitExternalRedirectSchema,
});

const RestorePurchasesSchema = z.object({
  transactions: z.array(IapTransactionSchema).min(1).max(100),
});

const PreviewUpgradeSchema = z.object({
  targetTier: PlanTierSchema,
});

const CancelSubscriptionSchema = z.object({
  atPeriodEnd: z.boolean().default(true),
});

// #23: Apple App Store Server Notifications V2 は `{ signedPayload: "<JWS>" }` 形式で届く。
// JWS 自体の中身 (notificationType 等) は packages/billing の AppleNotificationPayloadSchema
// (parseWebhookPayload 内部) が検証するため、ここでは外枠のみを検証する。
const AppleWebhookBodySchema = z.object({
  signedPayload: z.string().min(1),
});

/**
 * JWS の payload 部 (2 番目のパート) を Base64URL デコードして JSON.parse する。
 * 署名検証は verifyJwsSignature() で別途行うため、ここではデコードのみを行う
 * (packages/billing/src/adapters/apple-iap-adapter.ts の decodeJwsPayload と同じ手法だが、
 * Webhook 通知ペイロードのスキーマは packages/billing 側の
 * AppleNotificationPayloadSchema が担うため、ここでは unknown を返すだけにとどめる)。
 */
function decodeJwsPayloadUnvalidated(jws: string): unknown {
  const parts = jws.split(".");
  const payloadPart = parts[1];
  if (parts.length !== 3 || payloadPart === undefined) {
    return null;
  }
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const jsonString = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

export function registerBillingRoutes(
  fastify: FastifyInstance,
  deps: {
    billing: BillingFacade;
    iapAdapterConfig: IapAdapterConfig;
    /**
     * #61: Google Cloud Pub/Sub push サブスクリプションの OIDC audience 検証値
     * (apps/server/src/config.ts の GOOGLE_PLAY_PUBSUB_AUDIENCE)。
     * 未設定の場合 POST /api/billing/webhook/google は fail-close (常に 401) となる。
     * exactOptionalPropertyTypes 対応: config 由来の値は `string | undefined` を
     * そのまま渡せるよう明示的に undefined を許容する。
     */
    googlePlayPubsubAudience?: string | undefined;
  },
): void {
  const { billing, iapAdapterConfig, googlePlayPubsubAudience } = deps;

  /**
   * Rate limit カウンター (in-memory, per-user, per-instance)
   * billing 10 req/min — billing-ui-flow.md §5.2 に基づく
   * 本番は Redis 等に置き換える
   * NOTE: Map を関数スコープに置くことでテスト時のインスタンス間汚染を防ぐ
   */
  const billingRateLimitMap = new Map<string, { count: number; resetAt: number }>();

  function checkBillingRateLimit(userId: string, limitPerMin = 10): boolean {
    const now = Date.now();
    const entry = billingRateLimitMap.get(userId);
    if (!entry || now > entry.resetAt) {
      billingRateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= limitPerMin) return false;
    entry.count++;
    return true;
  }

  // GET /api/billing/subscription
  fastify.get("/api/billing/subscription", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await billing.getSubscription(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/billing/checkout
  fastify.post("/api/billing/checkout", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "tier と paymentMethod は必須です", retryable: false },
      });
    }

    const tier = parsed.data.tier;
    const paymentMethod = parsed.data.paymentMethod;

    const result = await billing.createCheckoutSession(
      request.userId,
      tier,
      paymentMethod,
    );

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: { method: paymentMethod, url: result.data.url } });
  });

  // POST /api/billing/webhook/stripe (raw body needed for signature)
  // #39: 署名検証には受信した生バイト列 (request.rawBody) を使う。JSON.stringify(request.body) に
  // よる再シリアライズはキー順序・空白・数値表現の差異で正当な署名検証が失敗し得るため使わない。
  // raw-body-parser.ts (#25) が全 JSON リクエストで request.rawBody に生文字列を保持しているため、
  // 従来無効化されていた `config: { rawBody: true }` (どのプラグインからも参照されない dead な
  // ルート設定だった) は不要になり削除した。
  fastify.post(
    "/api/billing/webhook/stripe",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers["stripe-signature"];
      if (typeof signature !== "string") {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "stripe-signature ヘッダーが必要です", retryable: false },
        });
      }

      const result = await billing.handleStripeWebhook(request.rawBody, signature);
      if (!result.ok) {
        return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: true });
    },
  );

  // POST /api/billing/webhook/apple
  // #23: Apple App Store Server Notifications V2 は `{ signedPayload: "<JWS>" }` 形式で届く。
  // 実際に届く JWS の署名 (ES256 + x5c チェーン) を packages/billing から export された
  // verifyJwsSignature() で検証してから、JWS payload をデコードして
  // billing.handleAppleIapWebhook() (内部で AppleNotificationPayloadSchema によるペイロード
  // スキーマ検証を行う) に渡す。config.IAP_APPLE_BUNDLE_ID / IAP_APPLE_ENVIRONMENT /
  // APPLE_ROOT_CA_PEM (container.ts の iapAdapterConfig) は #40 の StoreKit 2 クライアント JWS
  // 検証と同じ基準を Webhook 経路にも適用する (#10 の申し送り対応)。
  fastify.post("/api/billing/webhook/apple", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedBody = AppleWebhookBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "signedPayload (JWS) が必要です",
          retryable: false,
        },
      });
    }

    const { signedPayload } = parsedBody.data;

    const signatureResult = verifyJwsSignature(signedPayload, iapAdapterConfig);
    if (!signatureResult.ok) {
      return reply
        .status(getHttpStatus(signatureResult.error.code))
        .send({ ok: false, error: signatureResult.error });
    }

    const decodedPayload = decodeJwsPayloadUnvalidated(signedPayload);
    if (decodedPayload === null) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "BILLING_IAP_RECEIPT_INVALID",
          message: "Apple Webhook の signedPayload デコードに失敗しました",
          retryable: false,
        },
      });
    }

    const result = await billing.handleAppleIapWebhook(decodedPayload);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // POST /api/billing/webhook/google
  // #61: Google Play RTDN (Pub/Sub push) は Google 発行の OIDC ID トークンを
  // Authorization ヘッダーで送ってくるため、google-auth-library の
  // OAuth2Client.verifyIdToken() (verifyGooglePubSubOidcToken 経由) で audience/署名/有効期限を
  // 検証し、呼び出し元が正当な Google Cloud Pub/Sub であることを確認してから
  // billing.handleGoogleIapWebhook に委譲する。GOOGLE_PLAY_PUBSUB_AUDIENCE 未設定時は
  // fail-close (常に 401 で拒否) する。
  fastify.post("/api/billing/webhook/google", async (request: FastifyRequest, reply: FastifyReply) => {
    const authorizationHeader = request.headers.authorization;
    const oidcResult = await verifyGooglePubSubOidcToken(
      authorizationHeader,
      googlePlayPubsubAudience,
    );
    if (!oidcResult.ok) {
      return reply
        .status(getHttpStatus(oidcResult.error.code))
        .send({ ok: false, error: oidcResult.error });
    }

    const result = await billing.handleGoogleIapWebhook(request.body);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // =========================================================================
  // Sprint 3 T-10 追加 endpoint
  // =========================================================================

  // POST /api/billing/iap/transaction — StoreKit 2 IAP トランザクション記録
  fastify.post("/api/billing/iap/transaction", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = IapTransactionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await billing.recordIapTransaction(request.userId, parsed.data.transaction);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });

  // POST /api/billing/external-purchase/start — StoreKit External Purchase 開始
  fastify.post("/api/billing/external-purchase/start", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = ExternalPurchaseStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await billing.startExternalPurchase(request.userId, parsed.data.targetTier);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });

  // POST /api/billing/external-purchase/complete — StoreKit External Purchase 完了
  fastify.post("/api/billing/external-purchase/complete", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = ExternalPurchaseCompleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await billing.completeExternalPurchase(request.userId, parsed.data.redirect);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });

  // POST /api/billing/restore — 購入復元 (iOS App Store ガイドライン必須)
  fastify.post("/api/billing/restore", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId, 5)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = RestorePurchasesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await billing.restorePurchases(request.userId, parsed.data.transactions);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });

  // GET /api/billing/plan-comparison — プラン比較ビュー
  fastify.get("/api/billing/plan-comparison", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await billing.getPlanComparison(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/billing/preview-upgrade — アップグレード日割りプレビュー
  fastify.post("/api/billing/preview-upgrade", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = PreviewUpgradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await billing.previewUpgrade(request.userId, parsed.data.targetTier);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });

  // POST /api/billing/cancel — サブスクリプションキャンセル
  fastify.post("/api/billing/cancel", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!checkBillingRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: { code: "BILLING_RATE_LIMITED", message: "リクエスト頻度が高すぎます。1分後に再試行してください。", retryable: true },
      });
    }

    const parsed = CancelSubscriptionSchema.safeParse(request.body ?? {});
    const atPeriodEnd = parsed.success ? parsed.data.atPeriodEnd : true;

    const result = await billing.cancelSubscription(request.userId, atPeriodEnd);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: result.data });
  });
}
