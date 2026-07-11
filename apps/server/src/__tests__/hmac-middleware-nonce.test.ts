/**
 * HMAC ミドルウェア — nonce store (Issue #63) 重複排除ロジックのテスト
 *
 * createHmacPreHandler を NonceRepository のフェイク実装と直接組み合わせてテストする
 * (Fastify inject を経由するテストは agent-routes.test.ts の既存カバレッジに任せ、
 * ここでは nonce store の分岐 (isNew / alreadyProcessed) を焦点にする)。
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * expect(nonceRepo.checkAndInsert).toHaveBeenCalledWith(...) は vitest の定番パターンだが、
 * typescript-eslint の unbound-method は「メソッド参照を this なしで渡している」と誤検知する
 * (expect は呼び出さず型情報のみラップするため実害なし)。agent-routes.test.ts と同じ方針。
 */

import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ok, err } from "@trancall/shared-kernel";
import { createHmacPreHandler } from "../middleware/hmac-middleware.js";
import type { NonceRepository } from "../adapters/repositories/agent/nonce-repository.supabase.js";
import type { Config } from "../config.js";

const HMAC_SECRET = "supersecretkey1234567890abcdefghij"; // 32文字以上

function makeConfig(): Config {
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
    TRANCALL_AGENT_HMAC_SECRET: HMAC_SECRET,
    INVITE_BASE_URL: "https://trancall.app/invite",
  } as Config;
}

function makeSignature(body: string, idempotencyKey: string, timestamp: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(body + "|" + idempotencyKey + "|" + timestamp)
    .digest("hex");
}

function makeRequest(body: string, idempotencyKey: string, timestamp: string, signature: string): FastifyRequest {
  const fakeRequest = {
    headers: {
      "x-trancall-signature": signature,
      "x-trancall-idempotency-key": idempotencyKey,
      "x-trancall-timestamp": timestamp,
    },
    rawBody: body,
  };
  return fakeRequest as unknown as FastifyRequest;
}

function makeReply() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const fakeReply = { status };
  return { reply: fakeReply as unknown as FastifyReply, status, send };
}

function makeNonceRepo(overrides: Partial<NonceRepository> = {}): NonceRepository {
  return {
    checkAndInsert: vi.fn().mockResolvedValue(ok({ isNew: true, alreadyProcessed: false })),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}

describe("createHmacPreHandler — #63 nonce store dedup", () => {
  it("初回リクエスト (isNew=true) はハンドラへ進む (reply未送信)", async () => {
    const nonceRepo = makeNonceRepo({
      checkAndInsert: vi.fn().mockResolvedValue(ok({ isNew: true, alreadyProcessed: false })),
    });
    const preHandler = createHmacPreHandler(makeConfig(), nonceRepo);

    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "aaaaaaaa-0000-4000-8000-000000000001";
    const timestamp = new Date().toISOString();
    const sig = makeSignature(body, key, timestamp);

    const { reply, status } = makeReply();
    await preHandler(makeRequest(body, key, timestamp, sig), reply);

    expect(status).not.toHaveBeenCalled();
    expect(nonceRepo.checkAndInsert).toHaveBeenCalledWith(key, expect.any(String));
  });

  it("未処理の重複 (isNew=false, alreadyProcessed=false) は Agent の正当なリトライとしてハンドラへ進む", async () => {
    const nonceRepo = makeNonceRepo({
      checkAndInsert: vi.fn().mockResolvedValue(ok({ isNew: false, alreadyProcessed: false })),
    });
    const preHandler = createHmacPreHandler(makeConfig(), nonceRepo);

    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "aaaaaaaa-0000-4000-8000-000000000002";
    const timestamp = new Date().toISOString();
    const sig = makeSignature(body, key, timestamp);

    const { reply, status } = makeReply();
    await preHandler(makeRequest(body, key, timestamp, sig), reply);

    expect(status).not.toHaveBeenCalled();
  });

  it("処理完了済みの重複 (alreadyProcessed=true) は再処理せず 200 ok:true を即返す", async () => {
    const nonceRepo = makeNonceRepo({
      checkAndInsert: vi.fn().mockResolvedValue(ok({ isNew: false, alreadyProcessed: true })),
    });
    const preHandler = createHmacPreHandler(makeConfig(), nonceRepo);

    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "aaaaaaaa-0000-4000-8000-000000000003";
    const timestamp = new Date().toISOString();
    const sig = makeSignature(body, key, timestamp);

    const { reply, status, send } = makeReply();
    await preHandler(makeRequest(body, key, timestamp, sig), reply);

    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith({ ok: true });
  });

  it("nonce store 障害時は 500 (retryable) を返す", async () => {
    const nonceRepo = makeNonceRepo({
      checkAndInsert: vi
        .fn()
        .mockResolvedValue(err({ code: "INTERNAL_ERROR", message: "db down", retryable: true })),
    });
    const preHandler = createHmacPreHandler(makeConfig(), nonceRepo);

    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "aaaaaaaa-0000-4000-8000-000000000004";
    const timestamp = new Date().toISOString();
    const sig = makeSignature(body, key, timestamp);

    const { reply, status, send } = makeReply();
    await preHandler(makeRequest(body, key, timestamp, sig), reply);

    expect(status).toHaveBeenCalledWith(500);
    const sentBody = send.mock.calls[0]?.[0] as { error: { code: string } };
    expect(sentBody.error.code).toBe("INTERNAL_ERROR");
  });

  it("HMAC 署名が不正な場合は nonce store を一切呼ばない", async () => {
    const nonceRepo = makeNonceRepo();
    const preHandler = createHmacPreHandler(makeConfig(), nonceRepo);

    const body = JSON.stringify({ type: "agent.metrics" });
    const key = "aaaaaaaa-0000-4000-8000-000000000005";
    const timestamp = new Date().toISOString();

    const { reply, status } = makeReply();
    await preHandler(makeRequest(body, key, timestamp, "invalid-signature"), reply);

    expect(status).toHaveBeenCalledWith(401);
    expect(nonceRepo.checkAndInsert).not.toHaveBeenCalled();
  });
});
