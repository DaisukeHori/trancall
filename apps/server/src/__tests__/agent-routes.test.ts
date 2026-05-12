/**
 * Agent 内部 API エンドポイントテスト
 *
 * - POST /internal/agent/events
 * - POST /internal/translation/heartbeat
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { TEST_CONFIG } from "./helpers/test-app.js";

const HMAC_SECRET = TEST_CONFIG.TRANCALL_AGENT_HMAC_SECRET;

let app: FastifyInstance;

beforeAll(async () => {
  const container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

function makeSignature(body: string, idempotencyKey: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(body + "|" + idempotencyKey)
    .digest("hex");
}

const IDEMPOTENCY_KEY = "99999999-9999-4999-8999-999999999999";

describe("POST /internal/agent/events", () => {
  it("translation.session_started イベントを処理できる", async () => {
    const payload = {
      type: "translation.session_started",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sourceParticipantId: "33333333-3333-4333-8333-333333333333",
      targetParticipantId: "44444444-4444-4444-8444-444444444444",
      outputLanguage: "en",
      startedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, IDEMPOTENCY_KEY);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
        "x-trancall-agent": "trancall-translation-agent",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const respBody = JSON.parse(response.body) as { ok: boolean };
    expect(respBody.ok).toBe(true);
  });

  it("HMAC シグネチャなしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
      },
      payload: { type: "translation.session_started" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("不正な HMAC シグネチャで 401 を返す", async () => {
    const payload = { type: "translation.session_started" };

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": "invalid-signature",
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("無効なイベント type で 400 を返す", async () => {
    const payload = { type: "unknown.event.type", data: {} };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, IDEMPOTENCY_KEY);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it("agent.metrics イベントを処理できる", async () => {
    const key = "98989898-9898-4898-8898-989898989898";
    const payload = {
      type: "agent.metrics",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      latencyMs: {
        captureToAgent: [10, 12],
        agentToOpenAI: [5, 6],
        openAIFirstDelta: [100, 110],
        agentPublish: [15, 20],
        totalEndToEnd: [130, 148],
      },
      memoryRssBytes: 52428800,
      collectedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("translation.degraded イベントを処理し EventBus に publish する", async () => {
    const key = "77777777-7777-4777-8777-777777777777";
    const payload = {
      type: "translation.degraded",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sessionId: "55555555-5555-4555-8555-555555555555",
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const respBody = JSON.parse(response.body) as { ok: boolean };
    expect(respBody.ok).toBe(true);
  });

  it("translation.recovered イベントを処理し EventBus に publish する", async () => {
    const key = "66666666-6666-4666-8666-666666666666";
    const payload = {
      type: "translation.recovered",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sessionId: "55555555-5555-4555-8555-555555555555",
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 3500,
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const respBody = JSON.parse(response.body) as { ok: boolean };
    expect(respBody.ok).toBe(true);
  });
});

describe("POST /internal/translation/heartbeat", () => {
  it("正常な heartbeat を受け付けて 200 を返す", async () => {
    const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const payload = {
      agentJobId: "11111111-1111-4111-8111-111111111111",
      sessionId: "55555555-5555-4555-8555-555555555555",
      alive: true,
      occurredAt: new Date().toISOString(),
      metrics: {
        cpuPercent: 35.5,
        memMb: 256,
        openaiWsState: "open",
      },
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const respBody = JSON.parse(response.body) as { ok: boolean };
    expect(respBody.ok).toBe(true);
  });

  it("metrics なしの heartbeat も受け付ける", async () => {
    const key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const payload = {
      agentJobId: "11111111-1111-4111-8111-111111111111",
      sessionId: "55555555-5555-4555-8555-555555555555",
      alive: true,
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("HMAC シグネチャなしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      payload: {
        agentJobId: "11111111-1111-4111-8111-111111111111",
        sessionId: "55555555-5555-4555-8555-555555555555",
        alive: true,
        occurredAt: new Date().toISOString(),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("alive=false で 400 を返す", async () => {
    const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const payload = {
      agentJobId: "11111111-1111-4111-8111-111111111111",
      sessionId: "55555555-5555-4555-8555-555555555555",
      alive: false,
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const sig = makeSignature(body, key);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
  });
});
