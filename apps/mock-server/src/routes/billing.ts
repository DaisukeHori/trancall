import type { Router, Request, Response } from "express";
import { z } from "zod";
import { getSessionByToken, getUserById } from "../state.js";

const CheckoutBodySchema = z.object({
  tier: z.string().optional(),
  paymentMethod: z.string().optional(),
});

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requireAuth(req: Request, res: Response): string | null {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
    });
    return null;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: { code: "AUTH_TOKEN_EXPIRED", message: "Token expired or invalid", retryable: false },
    });
    return null;
  }
  return session.userId;
}

export function registerBillingRoutes(router: Router): void {
  router.get("/billing/subscription", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found", retryable: false },
      });
      return;
    }

    res.status(200).json({
      ok: true,
      data: {
        tier: user.tier,
        remainingMinutes: user.remainingMinutes,
        status: user.remainingMinutes > 0 ? "active" : "depleted",
        nextBillingAt: user.tier !== "free" ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() : null,
        overageRatePerMinute: 10,
      },
    });
  });

  router.post("/billing/checkout", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const parsedBody = CheckoutBodySchema.safeParse(req.body);
    const { tier, paymentMethod } = parsedBody.success ? parsedBody.data : {};

    if (paymentMethod === "iap") {
      res.status(200).json({
        ok: true,
        data: { method: "iap", productId: `trancall_${tier ?? "standard"}_monthly` },
      });
      return;
    }

    if (paymentMethod === "stripe_web") {
      res.status(200).json({
        ok: true,
        data: {
          method: "stripe_web",
          url: "https://checkout.stripe.com/mock_session_e2e",
        },
      });
      return;
    }

    res.status(200).json({
      ok: true,
      data: { method: "iap", productId: `trancall_${tier ?? "standard"}_monthly` },
    });
  });

  router.post("/billing/webhook/stripe", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  router.post("/billing/webhook/apple", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  router.post("/billing/webhook/google", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
}
