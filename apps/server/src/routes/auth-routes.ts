/**
 * 認証エンドポイント
 *
 * POST /api/auth/signup
 * POST /api/auth/signin
 * GET  /api/auth/profile
 * PATCH /api/auth/profile
 * POST /api/auth/consent
 * POST /api/auth/consents      — 同意記録 (Sprint 3, T-10)
 * GET  /api/auth/consents      — 同意状態取得 (Sprint 3, T-10)
 * DELETE /api/auth/consents/:scope — 同意取消 (Sprint 3, T-10)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthFacade } from "@trancall/auth";
import { getHttpStatus } from "../middleware/error-handler.js";

const SignupSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
  nativeLanguage: z.string().min(2).max(10),
});

const SigninSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  nativeLanguage: z.string().optional(),
  avatarUrl: z.url().optional(),
});

const ConsentSchema = z.object({
  consentVersion: z.string().min(1),
});

// Sprint 3 T-10: 同意管理スキーマ (legal-and-consent.md §3)
const ConsentScopeSchema = z.enum([
  "legal_terms",
  "privacy_policy",
  "voice_to_openai",
  "transcript_retention",
  "data_deletion_request",
  "push_notification",
  "marketing_email",
]);

const ConsentSourceSchema = z.enum([
  "onboarding",
  "incoming_call_first_time",
  "settings_screen",
  "terms_revision_prompt",
]);

const RecordConsentSchema = z.object({
  scope: ConsentScopeSchema,
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(-r\d+)?$/, "YYYY-MM-DD または YYYY-MM-DD-rN 形式"),
  source: ConsentSourceSchema,
});

const ConsentScopeParamsSchema = z.object({
  scope: ConsentScopeSchema,
});

export function registerAuthRoutes(
  fastify: FastifyInstance,
  deps: { supabase: SupabaseClient; auth: AuthFacade },
): void {
  const { supabase, auth } = deps;

  // POST /api/auth/signup
  fastify.post("/api/auth/signup", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SignupSchema.safeParse(request.body);
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

    const { email, password, displayName, nativeLanguage } = parsed.data;

    const { data: authData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
          native_language: nativeLanguage,
        },
      },
    });

    if (signupError || !authData.session || !authData.user) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: signupError?.message ?? "サインアップに失敗しました",
          retryable: false,
        },
      });
    }

    const { session, user } = authData;

    return reply.status(200).send({
      ok: true,
      data: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: new Date(session.expires_at ? session.expires_at * 1000 : Date.now()).toISOString(),
        user: {
          userId: user.id,
          email: user.email,
          displayName,
          nativeLanguage,
          trancallId: null,
          avatarUrl: null,
          consentVersion: null,
          emailVerified: user.email_confirmed_at != null,
          createdAt: user.created_at,
        },
      },
    });
  });

  // POST /api/auth/signin
  fastify.post("/api/auth/signin", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SigninSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "入力が無効です", retryable: false },
      });
    }

    const { email, password } = parsed.data;
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !authData.session || !authData.user) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "メールアドレスまたはパスワードが正しくありません",
          retryable: false,
        },
      });
    }

    const { session, user } = authData;

    return reply.status(200).send({
      ok: true,
      data: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: new Date(session.expires_at ? session.expires_at * 1000 : Date.now()).toISOString(),
        user: {
          userId: user.id,
          email: user.email,
          displayName: typeof user.user_metadata?.["display_name"] === "string" ? user.user_metadata["display_name"] : null,
          nativeLanguage: typeof user.user_metadata?.["native_language"] === "string" ? user.user_metadata["native_language"] : null,
          trancallId: null,
          avatarUrl: null,
          consentVersion: null,
          emailVerified: user.email_confirmed_at != null,
          createdAt: user.created_at,
        },
      },
    });
  });

  // GET /api/auth/profile
  fastify.get("/api/auth/profile", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await auth.getProfile(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // PATCH /api/auth/profile
  fastify.patch("/api/auth/profile", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = UpdateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "入力が無効です", retryable: false },
      });
    }

    const updates: Record<string, string> = {};
    if (parsed.data.displayName) updates["display_name"] = parsed.data.displayName;
    if (parsed.data.nativeLanguage) updates["native_language"] = parsed.data.nativeLanguage;
    if (parsed.data.avatarUrl) updates["avatar_url"] = parsed.data.avatarUrl;

    const { error } = await supabase
      .schema("trancall_auth")
      .from("profiles")
      .update(updates)
      .eq("user_id", request.userId);

    if (error) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: error.message, retryable: true },
      });
    }

    const result = await auth.getProfile(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/auth/consent
  fastify.post("/api/auth/consent", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "consentVersion は必須です", retryable: false },
      });
    }

    const { error } = await supabase
      .schema("trancall_auth")
      .from("consent_versions")
      .upsert(
        {
          user_id: request.userId,
          consent_version: parsed.data.consentVersion,
          consented_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: error.message, retryable: true },
      });
    }

    return reply.send({ ok: true, data: true });
  });

  // POST /api/auth/consents — 同意記録 (Sprint 3 T-10)
  fastify.post("/api/auth/consents", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RecordConsentSchema.safeParse(request.body);
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

    const result = await auth.recordConsent(
      request.userId,
      parsed.data.scope,
      parsed.data.version,
      parsed.data.source,
    );
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: true });
  });

  // GET /api/auth/consents — 同意状態取得 (Sprint 3 T-10)
  fastify.get("/api/auth/consents", async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await auth.getRequiredConsents(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // DELETE /api/auth/consents/:scope — 同意取消 (Sprint 3 T-10)
  fastify.delete("/api/auth/consents/:scope", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = ConsentScopeParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `scope が無効です。有効値: ${ConsentScopeSchema.options.join(", ")}`,
          retryable: false,
        },
      });
    }

    const result = await auth.revokeConsent(request.userId, parsedParams.data.scope);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(200).send({ ok: true, data: true });
  });
}
