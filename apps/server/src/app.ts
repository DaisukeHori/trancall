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
    // 確定#5 / 2巡目 finding2 (security): rate limit (auth-routes.ts / contact-routes.ts) や
    // 監査ログは request.ip をキーに使うが、trustProxy 未設定だと Vercel/Render 等の
    // リバースプロキシ経由のリクエストで request.ip が常にプロキシの IP (単一値) になり、
    // rate limit が事実上無効化される。逆に trustProxy: true (全ホップ信頼) にすると、
    // Fastify (proxy-addr) は X-Forwarded-For の「最も左 (=クライアントが最初に付与できる側)」
    // のエントリを request.ip として採用してしまう。X-Forwarded-For はクライアントが
    // 自由に送信できるヘッダーであるため、攻撃者が `X-Forwarded-For: <偽装したい任意のIP>`
    // を付けてリクエストすれば request.ip を丸ごと偽装でき、IP ベースの rate limit を
    // 迂回できてしまう (trustProxy: true は「全プロキシを信頼」であり、実際に信頼できるのは
    // アプリの直前 1 ホップ (デプロイ先の Vercel/Render エッジ) だけ)。
    //
    // 対策: trustProxy を信頼できるホップ数 (number) に変更する。デプロイ構成は
    // クライアント → Vercel (単一ホップのリバースプロキシ) → 本アプリ、を前提とし、
    // trustProxy: 1 (直近 1 ホップ = Vercel のエッジのみ信頼) とする。proxy-addr は
    // ソケット側から「信頼済みホップの数」だけ辿り、その次のエントリ (＝信頼済み
    // プロキシ自身が実際に観測してヘッダーに追記した、クライアントに最も近いエントリ) を
    // request.ip として採用する。これにより、クライアントが XFF に任意の値を追加しても、
    // Vercel が実際に観測した接続元 IP (Vercel がヘッダーに追記する値) が優先され、
    // 偽装は成立しない。
    //
    // 誤設定リスク: 将来デプロイ構成が変わり多段プロキシ (例: CDN → Vercel → アプリ) に
    // なった場合、trustProxy の値もホップ数に合わせて増やす必要がある。増やし忘れると
    // 中間プロキシの IP が client IP と誤認され rate limit の粒度が壊れる (機能的な
    // 誤爆であり、直ちにスプーフィングには繋がらない)。逆に実際のホップ数より大きい値を
    // 設定すると、再びクライアント制御下のエントリを信頼してしまいスプーフィング耐性が
    // 落ちるため、実際の構成と一致させることが重要 (Fastify trustProxy オプション参照)。
    trustProxy: 1,
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
    // #61: 未設定なら fail-close (Google Play webhook を常に 401 で拒否) される
    googlePlayPubsubAudience: config.GOOGLE_PLAY_PUBSUB_AUDIENCE,
  });
  registerTranscriptRoutes(fastify, { transcript: container.transcript });
  registerNotificationRoutes(fastify, { notification: container.notification });
  registerSupportRoutes(fastify, { auth: container.auth });
  registerAccountRoutes(fastify, {
    auth: container.auth,
    billing: container.billing,
    eventBus: container.eventBus,
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
