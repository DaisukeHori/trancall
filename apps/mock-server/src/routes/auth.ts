import type { Router, Request, Response } from "express";
import {
  getState,
  createSession,
  getUserByEmail,
  getSessionByToken,
  getUserById,
} from "../state.js";

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function buildUserProfile(userId: string) {
  const user = getUserById(userId);
  if (!user) return null;
  return {
    userId: user.userId,
    trancallId: user.trancallId,
    email: user.email,
    displayName: user.displayName,
    nativeLanguage: user.nativeLanguage,
    avatarUrl: user.avatarUrl,
    consentVersion: user.consentVersion,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

export function registerAuthRoutes(router: Router): void {
  router.post("/auth/signup", (req: Request, res: Response) => {
    const { email, password, displayName, nativeLanguage } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      nativeLanguage?: string;
    };

    if (!email || !password || !displayName || !nativeLanguage) {
      res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Missing required fields", retryable: false },
      });
      return;
    }

    const existing = getUserByEmail(email);
    if (existing) {
      res.status(409).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Email already in use", retryable: false },
      });
      return;
    }

    const state = getState();
    const newUser = {
      userId: `user-new-${Date.now()}`,
      email,
      password,
      trancallId: `@${displayName.toLowerCase().replace(/\s+/g, "_")}`,
      displayName,
      nativeLanguage,
      avatarUrl: null as string | null,
      consentVersion: null as string | null,
      emailVerified: false,
      createdAt: new Date().toISOString(),
      tier: "free" as const,
      remainingMinutes: 30,
    };
    state.users.push(newUser);

    const session = createSession(newUser.userId);
    res.status(200).json({
      ok: true,
      data: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: buildUserProfile(newUser.userId),
      },
    });
  });

  router.post("/auth/signin", (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Missing credentials", retryable: false },
      });
      return;
    }

    const user = getUserByEmail(email);
    if (!user || user.password !== password) {
      res.status(401).json({
        ok: false,
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "Invalid email or password",
          retryable: false,
        },
      });
      return;
    }

    const session = createSession(user.userId);
    res.status(200).json({
      ok: true,
      data: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: buildUserProfile(user.userId),
      },
    });
  });

  router.get("/auth/profile", (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
      });
      return;
    }

    const session = getSessionByToken(token);
    if (!session) {
      res.status(401).json({
        ok: false,
        error: {
          code: "AUTH_TOKEN_EXPIRED",
          message: "Token expired or invalid",
          retryable: false,
        },
      });
      return;
    }

    const profile = buildUserProfile(session.userId);
    if (!profile) {
      res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found", retryable: false },
      });
      return;
    }

    res.status(200).json({ ok: true, data: profile });
  });

  router.patch("/auth/profile", (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
      });
      return;
    }

    const session = getSessionByToken(token);
    if (!session) {
      res.status(401).json({
        ok: false,
        error: {
          code: "AUTH_TOKEN_EXPIRED",
          message: "Token expired or invalid",
          retryable: false,
        },
      });
      return;
    }

    const state = getState();
    const user = state.users.find((u) => u.userId === session.userId);
    if (!user) {
      res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found", retryable: false },
      });
      return;
    }

    const { displayName, nativeLanguage, avatarUrl } = req.body as {
      displayName?: string;
      nativeLanguage?: string;
      avatarUrl?: string;
    };

    if (displayName !== undefined) user.displayName = displayName;
    if (nativeLanguage !== undefined) user.nativeLanguage = nativeLanguage;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    res.status(200).json({ ok: true, data: buildUserProfile(session.userId) });
  });

  router.post("/auth/consent", (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
      });
      return;
    }

    const session = getSessionByToken(token);
    if (!session) {
      res.status(401).json({
        ok: false,
        error: {
          code: "AUTH_TOKEN_EXPIRED",
          message: "Token expired or invalid",
          retryable: false,
        },
      });
      return;
    }

    const { consentVersion } = req.body as { consentVersion?: string };
    const state = getState();
    const user = state.users.find((u) => u.userId === session.userId);
    if (user && consentVersion) {
      user.consentVersion = consentVersion;
    }

    res.status(200).json({ ok: true, data: true });
  });
}
