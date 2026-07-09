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
import { createInMemoryRateLimitStore, createRateLimiter } from "../lib/rate-limit.js";

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

  // #34/確定#5: signin/signup は認証不要 (auth-middleware で除外) なため、無制限だと
  // credential stuffing / アカウント総当たりが可能だった。IP ベースで 10 req/min に制限する。
  // 確定#5: IP のみのキーだと (a) trustProxy 未設定下では request.ip がプロキシの
  // 単一 IP に潰れて実質グローバル上限になる、(b) trustProxy 設定後も攻撃者が IP を
  // ローテーションすれば同一メールアドレスへの総当たりを回避できる、という 2 つの
  // 抜け道があった。IP ベースの制限 (フラッド対策、body 未検証でも早期に弾く) に加えて
  // email ベースの制限 (同一アカウントへの標的型総当たり対策、IP ローテーションでは
  // 回避できない) を併用する。email が判明した時点 (body バリデーション後) で追加チェックする。
  // NOTE: in-memory store は Vercel serverless ではインスタンスごとに分断されるため
  // グローバルな制限としては実効性が限定的 (rate-limit.ts の JSDoc 参照)。
  const authRateLimitStore = createInMemoryRateLimitStore();
  const signupRateLimiter = createRateLimiter(authRateLimitStore, 10, 60_000);
  const signinRateLimiter = createRateLimiter(authRateLimitStore, 10, 60_000);

  // POST /api/auth/signup
  fastify.post("/api/auth/signup", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!signupRateLimiter.check(`signup:ip:${request.ip}`)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "リクエストが多すぎます。しばらくお待ちください。",
          retryable: true,
        },
      });
    }

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

    // 確定#5: email が判明したので、email ベースの追加レート制限も適用する
    // (IP ローテーションによる同一アカウント総当たりを防ぐ)。
    if (!signupRateLimiter.check(`signup:email:${parsed.data.email.toLowerCase()}`)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "リクエストが多すぎます。しばらくお待ちください。",
          retryable: true,
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
    if (!signinRateLimiter.check(`signin:ip:${request.ip}`)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "リクエストが多すぎます。しばらくお待ちください。",
          retryable: true,
        },
      });
    }

    const parsed = SigninSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "入力が無効です", retryable: false },
      });
    }

    // 確定#5: email が判明したので、email ベースの追加レート制限も適用する
    // (IP ローテーションによる同一アカウント総当たりを防ぐ)。
    if (!signinRateLimiter.check(`signin:email:${parsed.data.email.toLowerCase()}`)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "リクエストが多すぎます。しばらくお待ちください。",
          retryable: true,
        },
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
