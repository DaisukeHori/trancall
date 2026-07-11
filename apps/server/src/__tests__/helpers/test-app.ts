/**
 * テスト用アプリファクトリ
 *
 * モックコンテナでアプリを起動し、Fastify inject API を使ったテストを可能にする。
 */

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AppContainer } from "../../container.js";
import type { Config } from "../../config.js";

const TEST_CONFIG: Config = {
  PORT: 3001,
  NODE_ENV: "test",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  LIVEKIT_URL: "wss://livekit.test",
  LIVEKIT_API_KEY: "lk-key",
  LIVEKIT_API_SECRET: "lk-secret",
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRICE_ID_LIGHT: "price_light",
  STRIPE_PRICE_ID_STANDARD: "price_standard",
  STRIPE_PRICE_ID_BUSINESS: "price_business",
  STRIPE_SUCCESS_URL: "https://trancall.app/success",
  STRIPE_CANCEL_URL: "https://trancall.app/cancel",
  APNS_KEY_ID: undefined,
  APNS_TEAM_ID: undefined,
  APNS_KEY_PATH: undefined,
  APNS_BUNDLE_ID: "com.trancall.app",
  APNS_SANDBOX: false,
  FCM_SERVICE_ACCOUNT_JSON: undefined,
  // L-10: config.ts の Zod default ("trancall") と同じ値をテスト用にも明示する
  // (FCM_PROJECT_ID は default() により Config 型上 string 必須になった)
  FCM_PROJECT_ID: "trancall",
  TRANCALL_AGENT_HMAC_SECRET: "supersecretkey1234567890abcdefghij",
  INVITE_BASE_URL: "https://trancall.app/invite",
  // #61: OIDC 検証自体は google-auth-library (OAuth2Client) をテスト側で vi.mock するため、
  // ここでは audience が「設定されている」状態を再現するダミー値を置く
  // (未設定=fail-close の挙動は billing-routes.test.ts 内で個別に上書きして検証する)。
  GOOGLE_PLAY_PUBSUB_AUDIENCE: "https://api.trancall.test/api/billing/webhook/google",
} as Config;

export async function buildTestApp(container: AppContainer): Promise<FastifyInstance> {
  const app = await buildApp(container, TEST_CONFIG);
  await app.ready();
  return app;
}

export { TEST_CONFIG };
