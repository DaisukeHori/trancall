/**
 * HMAC ミドルウェアテスト
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmac } from "../middleware/hmac-middleware.js";
import type { Config } from "../config.js";

const FAKE_SECRET = "supersecretkey1234567890abcdefghij"; // 32文字以上

function makeConfig(secret: string): Config {
  return {
    PORT: 3000,
    NODE_ENV: "test",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
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
    TRANCALL_AGENT_HMAC_SECRET: secret,
    INVITE_BASE_URL: "https://trancall.app/invite",
  } as Config;
}

function makeSignature(secret: string, body: string, idempotencyKey: string): string {
  return createHmac("sha256", secret)
    .update(body + "|" + idempotencyKey)
    .digest("hex");
}

describe("verifyHmac", () => {
  it("正しいシグネチャは valid", () => {
    const config = makeConfig(FAKE_SECRET);
    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "test-idempotency-key";
    const sig = makeSignature(FAKE_SECRET, body, key);

    expect(verifyHmac(config, body, sig, key)).toBe(true);
  });

  it("シグネチャが変わると invalid", () => {
    const config = makeConfig(FAKE_SECRET);
    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "test-idempotency-key";
    const sig = makeSignature(FAKE_SECRET, body, key);

    expect(verifyHmac(config, body, sig + "tampered", key)).toBe(false);
  });

  it("body が変わると invalid", () => {
    const config = makeConfig(FAKE_SECRET);
    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "test-idempotency-key";
    const sig = makeSignature(FAKE_SECRET, body, key);

    expect(verifyHmac(config, body + "x", sig, key)).toBe(false);
  });

  it("idempotency key が変わると invalid", () => {
    const config = makeConfig(FAKE_SECRET);
    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "test-idempotency-key";
    const sig = makeSignature(FAKE_SECRET, body, key);

    expect(verifyHmac(config, body, sig, "other-key")).toBe(false);
  });

  it("シークレットが違うと invalid", () => {
    const config = makeConfig("different-secret-1234567890abcdefg");
    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "test-idempotency-key";
    const sig = makeSignature(FAKE_SECRET, body, key);

    expect(verifyHmac(config, body, sig, key)).toBe(false);
  });
});
