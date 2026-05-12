import type { Router, Request, Response } from "express";
import { getSessionByToken } from "../state.js";

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

export function registerNotificationRoutes(router: Router): void {
  router.post("/notifications/register", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({ ok: true, data: true });
  });
}
