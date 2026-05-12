/**
 * Fastify アプリケーションファクトリ
 *
 * DI コンテナからアプリを組み立て、全ルートとミドルウェアを登録する。
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { AppContainer } from "./container.js";
import { registerAuthMiddleware } from "./middleware/auth-middleware.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerContactRoutes } from "./routes/contact-routes.js";
import { registerRoomRoutes } from "./routes/room-routes.js";
import { registerBillingRoutes } from "./routes/billing-routes.js";
import { registerTranscriptRoutes } from "./routes/transcript-routes.js";
import { registerNotificationRoutes } from "./routes/notification-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerSupportRoutes } from "./routes/support-routes.js";
import { registerAccountRoutes } from "./routes/account-routes.js";
import type { Config } from "./config.js";
import { logger } from "./logger.js";

export async function buildApp(
  container: AppContainer,
  config: Config,
) {
  const fastify = Fastify({
    logger: false, // 独自ロガーを使用
    bodyLimit: 4 * 1024 * 1024, // 4MB
  });

  // セキュリティ
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });
  await fastify.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-trancall-signature",
      "x-trancall-idempotency-key",
      "x-trancall-agent",
    ],
  });

  // 認証ミドルウェア
  registerAuthMiddleware(fastify, container.supabase);

  // エラーハンドラー
  registerErrorHandler(fastify);

  // ヘルスチェック
  fastify.get("/health", async (_request, reply) => {
    return reply.send({ ok: true, data: { status: "healthy", ts: new Date().toISOString() } });
  });

  // REST エンドポイント
  registerAuthRoutes(fastify, { supabase: container.supabase, auth: container.auth });
  registerContactRoutes(fastify, { contact: container.contact });
  registerRoomRoutes(fastify, {
    room: container.room,
    billing: container.billing,
    media: container.media,
    notification: container.notification,
  });
  registerBillingRoutes(fastify, { billing: container.billing });
  registerTranscriptRoutes(fastify, { transcript: container.transcript });
  registerNotificationRoutes(fastify, { notification: container.notification });
  registerSupportRoutes(fastify, {} as Record<string, never>);
  registerAccountRoutes(fastify, {
    supabase: container.supabase,
    billing: container.billing,
    eventBus: container.eventBus,
  });

  // Agent 内部 API
  registerAgentRoutes(fastify, {
    translation: container.translation,
    transcript: container.transcript,
    config,
  });

  // 起動ログ
  fastify.addHook("onReady", () => {
    logger.info("Fastify app ready");
  });

  return fastify;
}
