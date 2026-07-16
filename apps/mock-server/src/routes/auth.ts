import type { Router, Request, Response } from "express";
import { z } from "zod";
import {
  getState,
  createSession,
  getUserByEmail,
  getSessionByToken,
  getUserById,
} from "../state.js";
import type { UserFixture } from "../fixtures.js";

const SignupBodySchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  displayName: z.string().optional(),
  nativeLanguage: z.string().optional(),
});

const SigninBodySchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
});

const UpdateProfileBodySchema = z.object({
  displayName: z.string().optional(),
  nativeLanguage: z.string().optional(),
  avatarUrl: z.string().optional(),
});

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
    const parsedBody = SignupBodySchema.safeParse(req.body);
    const { email, password, displayName, nativeLanguage } = parsedBody.success
      ? parsedBody.data
      : {};

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
    const newUser: UserFixture = {
      userId: `user-new-${Date.now()}`,
      email,
      password,
      trancallId: `@${displayName.toLowerCase().replace(/\s+/g, "_")}`,
      displayName,
      nativeLanguage,
      avatarUrl: null,
      consentVersion: null,
      emailVerified: false,
      createdAt: new Date().toISOString(),
      tier: "free",
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
    const parsedBody = SigninBodySchema.safeParse(req.body);
    const { email, password } = parsedBody.success ? parsedBody.data : {};

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

    const parsedBody = UpdateProfileBodySchema.safeParse(req.body);
    const { displayName, nativeLanguage, avatarUrl } = parsedBody.success
      ? parsedBody.data
      : {};

    if (displayName !== undefined) user.displayName = displayName;
    if (nativeLanguage !== undefined) user.nativeLanguage = nativeLanguage;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    res.status(200).json({ ok: true, data: buildUserProfile(session.userId) });
  });

  // POST /api/account/delete — used by apps/mobile/src/screens/account-deletion-screen.tsx
  // (Step 3 submit, apps/mobile/src/api/auth-api.ts deleteAccount()) via the E2E
  // mock-auth path (apps/mobile/src/api/auth-api.ts isE2eTestMode()). Removes the
  // fixture user + invalidates the session so a subsequent login fails, matching
  // the real "account deleted" contract closely enough for E2E purposes.
  router.post("/account/delete", (req: Request, res: Response) => {
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
    state.users = state.users.filter((u) => u.userId !== session.userId);
    state.sessions.delete(token);

    res.status(200).json({ ok: true, data: { success: true } });
  });

  // NOTE (Issue #78): a mock POST /auth/consent (legacy singular) route used to
  // live here. It accepted any body (including malformed payloads) and always
  // returned 200, which hid the real server's three-way contract mismatch
  // (mobile payload vs ConsentSchema vs consent_versions table schema) from
  // E2E. The legacy route has been removed on apps/server, so this mock route
  // was removed too rather than made stricter. E2E flows that need consent
  // state should exercise the canonical /auth/consents (plural) endpoints
  // instead, once those are mocked here.
}
