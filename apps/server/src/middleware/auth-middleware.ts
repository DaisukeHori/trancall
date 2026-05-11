/**
 * 認証ミドルウェア
 *
 * Supabase JWT アクセストークンを検証し、userId を request に付与する。
 * Bearer トークンが無効な場合は 401 を返す。
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandUserId } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";

// Fastify request への userId 拡張
declare module "fastify" {
  interface FastifyRequest {
    userId: UserId;
  }
}

export function registerAuthMiddleware(
  fastify: FastifyInstance,
  supabase: SupabaseClient,
): void {
  // request に userId プロパティを追加
  fastify.decorateRequest("userId", null);

  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // 認証不要エンドポイントを除外
    const url = request.url;
    if (
      url.startsWith("/internal/") ||
      url === "/api/auth/signup" ||
      url === "/api/auth/signin" ||
      url === "/health" ||
      url.startsWith("/api/billing/webhook/")
    ) {
      return;
    }

    const authHeader = request.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "認証トークンが必要です", retryable: false },
      });
    }

    const token = authHeader.slice(7);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return reply.status(401).send({
        ok: false,
        error: { code: "AUTH_TOKEN_EXPIRED", message: "トークンが無効または期限切れです", retryable: true },
      });
    }

    const userIdResult = brandUserId(data.user.id);
    if (!userIdResult.success) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "ユーザー ID 形式が不正です", retryable: false },
      });
    }

    request.userId = userIdResult.data;
  });
}
