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
import type { BillingFacade } from "@trancall/billing";
import { getHttpStatus } from "../middleware/error-handler.js";

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

export function registerBillingRoutes(
  fastify: FastifyInstance,
  deps: { billing: BillingFacade },
): void {
  const { billing } = deps;

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
  fastify.post(
    "/api/billing/webhook/stripe",
    {
      config: { rawBody: true },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers["stripe-signature"];
      if (typeof signature !== "string") {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "stripe-signature ヘッダーが必要です", retryable: false },
        });
      }

      // rawBody を使う (fastify-rawbody または body を stringify)
      const rawBody = JSON.stringify(request.body);
      const result = await billing.handleStripeWebhook(rawBody, signature);
      if (!result.ok) {
        return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: true });
    },
  );

  // POST /api/billing/webhook/apple
  fastify.post("/api/billing/webhook/apple", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await billing.handleAppleIapWebhook(request.body);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // POST /api/billing/webhook/google
  fastify.post("/api/billing/webhook/google", async (request: FastifyRequest, reply: FastifyReply) => {
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
