/**
 * 環境変数設定 — fail-fast Zod parse
 *
 * 起動時に全必須変数が揃っていなければプロセスを終了する。
 * 省略可能な変数は optional() または default() で宣言する。
 */

import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  // Server
  PORT: z.string().default("3000").transform(Number),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // LiveKit
  LIVEKIT_URL: z.string().default("wss://livekit.trancall.app"),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID_LIGHT: z.string().default("price_light"),
  STRIPE_PRICE_ID_STANDARD: z.string().default("price_standard"),
  STRIPE_PRICE_ID_BUSINESS: z.string().default("price_business"),
  STRIPE_SUCCESS_URL: z.url().default("https://trancall.app/billing/success"),
  STRIPE_CANCEL_URL: z.url().default("https://trancall.app/billing/cancel"),

  // APNs
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_KEY_PATH: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().default("com.trancall.app"),
  APNS_SANDBOX: z.string().default("false").transform((v) => v === "true"),

  // FCM
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // L-10: 既定値 "trancall" を config.ts 側の Zod default に一元化する
  // (旧実装は apps/server/src/adapters/notification-adapters.ts に "trancall" を
  // ハードコードしたフォールバックとして持っていた)。運用で Firebase project id が
  // 異なる場合は環境変数 FCM_PROJECT_ID で上書きする。
  FCM_PROJECT_ID: z.string().min(1).default("trancall"),

  // HMAC secret for Agent ↔ Server
  TRANCALL_AGENT_HMAC_SECRET: z.string().min(32),

  // HMAC secret for APNs/FCM push payload signing (T-8)
  // docs/notification-detail.md §3.1 参照
  TRANCALL_PUSH_HMAC_SECRET: z.string().min(32),

  // Anonymize salt for per-user deterministic UUID derivation (account-deletion.md 案 1)
  // docs/account-deletion.md §TODO (T-29) 対処案 1
  ANONYMIZE_SALT: z.string().min(32),

  // Invite link base URL
  INVITE_BASE_URL: z.url().default("https://trancall.app/invite"),

  // Stripe Web Checkout (T-7 BillingFacade 拡張用)
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().optional(),

  // StoreKit External Purchase (T-7 BillingFacade 拡張用、Apple JWS は Phase 1b)
  STOREKIT_EXTERNAL_REPORT_URL: z.string().optional(),
  STOREKIT_EXTERNAL_APPLE_BUNDLE_ID: z.string().optional(),
  STOREKIT_EXTERNAL_ISSUER_ID: z.string().optional(),
  STOREKIT_EXTERNAL_KEY_ID: z.string().optional(),
  STOREKIT_EXTERNAL_PRIVATE_KEY: z.string().optional(),

  // #40/#23: StoreKit 2 IAP トランザクション検証 (packages/billing の IapAdapter) 用設定。
  // 未設定時は IapAdapter がチェーン内署名リンクの整合性のみ検証し、bundleId/environment/
  // ルート証明書の突合は行わない (packages/billing/src/adapters/iap-adapter.ts の JSDoc 参照)。
  // STOREKIT_EXTERNAL_APPLE_BUNDLE_ID (External Purchase レポート用、別目的) とは独立した値。
  IAP_APPLE_BUNDLE_ID: z.string().min(1).optional(),
  IAP_APPLE_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
  /** Apple Root CA (PEM 形式、1 枚)。指定時のみ x5c チェーン最上位証明書のピン留め検証を行う。 */
  APPLE_ROOT_CA_PEM: z.string().min(1).optional(),

  // #61: Google Cloud Pub/Sub push サブスクリプションが POST /api/billing/webhook/google に
  // 送ってくる OIDC ID トークン (Authorization: Bearer <token>) の audience 検証値。
  // Google Cloud Console / gcloud で Pub/Sub push サブスクリプションを作成する際に設定する
  // OIDC トークンの audience (通常は push endpoint の URL、例:
  // "https://api.trancall.app/api/billing/webhook/google") と一致させる必要がある。
  // 【運用者作業】 実際の値は Google Cloud Pub/Sub サブスクリプション作成時に決める運用値のため
  // ここではダミー値を設定できない。未設定の場合 (production 含む) は fail-close
  // (OIDC 検証を必須拒否として扱い、Google Play webhook を常に 401 で拒否する) とする。
  GOOGLE_PLAY_PUBSUB_AUDIENCE: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | undefined;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("[config] 環境変数の検証に失敗しました:\n" + missing);
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

/** テスト用: 設定キャッシュをリセットする */
export function resetConfig(): void {
  _config = undefined;
}
