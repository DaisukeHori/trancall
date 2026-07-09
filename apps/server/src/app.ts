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
import { registerRawBodyParser } from "./middleware/raw-body-parser.js";
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
    // 確定#5: rate limit (auth-routes.ts / contact-routes.ts) や監査ログは request.ip を
    // キーに使うが、trustProxy 未設定だと Vercel/Render 等のリバースプロキシ経由の
    // リクエストで request.ip が常にプロキシの IP (単一値) になり、rate limit が
    // 事実上無効化されていた。デプロイ先 (Vercel) は単一ホップのリバースプロキシとして
    // X-Forwarded-For を付与するため、trustProxy: true (先頭の XFF エントリを
    // request.ip として採用) で実 IP を復元する。
    // 注意 (XFF スプーフィング): この設定は「アプリの手前に必ず信頼できるプロキシが
    // 存在する」ことが前提。もしアプリが信頼できないネットワークから直接到達可能
    // (プロキシを経由しないアクセス経路がある) な場合、クライアントが任意の
    // X-Forwarded-For を送りつけて request.ip を偽装できてしまう。将来的に複数ホップの
    // プロキシ構成になる場合は trustProxy を具体的なホップ数 (number) や信頼する
    // プロキシの IP/CIDR リストに絞り込むこと (Fastify trustProxy オプション参照)。
    trustProxy: true,
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
      "x-trancall-timestamp",
    ],
  });

  // #25: JSON リクエストの生ボディ保持 (HMAC 署名検証 / Stripe Webhook 用)
  registerRawBodyParser(fastify);

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
    auth: container.auth,
    roomReservationSessionRepo: container.roomReservationSessionRepo,
  });
  registerBillingRoutes(fastify, {
    billing: container.billing,
    iapAdapterConfig: container.iapAdapterConfig,
  });
  registerTranscriptRoutes(fastify, { transcript: container.transcript });
  registerNotificationRoutes(fastify, { notification: container.notification });
  registerSupportRoutes(fastify, { auth: container.auth });
  registerAccountRoutes(fastify, {
    supabase: container.supabase,
    billing: container.billing,
    eventBus: container.eventBus,
    subscriptionRepo: container.subscriptionRepo,
  });

  // Agent 内部 API
  registerAgentRoutes(fastify, {
    translation: container.translation,
    transcript: container.transcript,
    auth: container.auth,
    room: container.room,
    billing: container.billing,
    config,
    eventBus: container.eventBus,
    supabase: container.supabase,
  });

  // 起動ログ
  fastify.addHook("onReady", () => {
    logger.info("Fastify app ready");
  });

  return fastify;
}
