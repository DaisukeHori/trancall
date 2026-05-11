/**
 * 課金エンドポイント
 *
 * GET  /api/billing/subscription
 * POST /api/billing/checkout
 * POST /api/billing/webhook/stripe
 * POST /api/billing/webhook/apple
 * POST /api/billing/webhook/google
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { BillingFacade } from "@trancall/billing";
import type { PlanTierType } from "@trancall/billing";
import { getHttpStatus } from "../middleware/error-handler.js";

const CheckoutSchema = z.object({
  tier: z.enum(["free", "light", "standard", "business"]),
  paymentMethod: z.enum(["stripe_web", "storekit_external"]),
});

export function registerBillingRoutes(
  fastify: FastifyInstance,
  deps: { billing: BillingFacade },
): void {
  const { billing } = deps;

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

    const tier = parsed.data["tier"] as PlanTierType;
    const paymentMethod = parsed.data["paymentMethod"] as "stripe_web" | "storekit_external";

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
}
