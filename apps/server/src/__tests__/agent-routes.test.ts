/**
 * Agent 内部 API エンドポイントテスト
 *
 * - POST /internal/agent/events
 * - POST /internal/translation/heartbeat
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * vi.mocked(container.X.Y) は vitest の定番パターンだが、typescript-eslint の
 * unbound-method は「メソッド参照を this なしで渡している」と誤検知する
 * (vi.mocked は呼び出さず型情報のみラップするため実害なし)。ファイル全体で無効化する。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { TEST_CONFIG } from "./helpers/test-app.js";
import type { AppContainer } from "../container.js";

const HMAC_SECRET = TEST_CONFIG.TRANCALL_AGENT_HMAC_SECRET;

let app: FastifyInstance;
let container: AppContainer;

beforeAll(async () => {
  container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

// 確定#4: timestamp は署名対象に含まれる (apps/server/src/middleware/hmac-middleware.ts /
// apps/translation-agent/src/internal-api-client.ts と canonical string を一致させる)。
function makeSignature(body: string, idempotencyKey: string, timestamp: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(body + "|" + idempotencyKey + "|" + timestamp)
    .digest("hex");
}

function freshTimestamp(): string {
  return new Date().toISOString();
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, IDEMPOTENCY_KEY, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
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
        "x-trancall-timestamp": freshTimestamp(),
      },
      payload: { type: "translation.session_started" },
    });

    expect(response.statusCode).toBe(401);
  });

  // 確定#4: timestamp ヘッダーは必須化された (旧実装は任意ヘッダーで欠如時は
  // 後方互換スキップしていたが、それ自体が検証無効化の抜け道だったため廃止)。
  it("HMAC タイムスタンプなしで 401 を返す (確定#4: 必須化)", async () => {
    const payload = { type: "translation.session_started" };
    const body = JSON.stringify(payload);
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, IDEMPOTENCY_KEY, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
        // "x-trancall-timestamp" を意図的に付与しない
      },
      payload,
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
        "x-trancall-timestamp": freshTimestamp(),
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  // 確定#4 (認可バイパス修正の回帰テスト): 正しい signature のまま timestamp だけを
  // 「現在時刻」に書き換えるリプレイ攻撃を、signature 不一致として拒否できることを確認する。
  it("正しいシグネチャのまま timestamp だけ改ざんすると 401 を返す (確定#4)", async () => {
    const payload = { type: "translation.session_started" };
    const body = JSON.stringify(payload);
    const originalTimestamp = freshTimestamp();
    const sig = makeSignature(body, IDEMPOTENCY_KEY, originalTimestamp);
    // signature は originalTimestamp 込みで計算済みだが、送信ヘッダーの
    // timestamp だけを別の (許容ウィンドウ内の) 値に差し替える。
    const tamperedTimestamp = new Date(Date.now() + 1000).toISOString();

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
        "x-trancall-timestamp": tamperedTimestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("無効なイベント type で 400 を返す", async () => {
    const payload = { type: "unknown.event.type", data: {} };
    const body = JSON.stringify(payload);
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, IDEMPOTENCY_KEY, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": IDEMPOTENCY_KEY,
        "x-trancall-timestamp": timestamp,
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const respBody = JSON.parse(response.body) as { ok: boolean };
    expect(respBody.ok).toBe(true);
  });
});

describe("POST /internal/agent/events — #48 transcript.delta 永続化", () => {
  it("isFinal=true の transcript.delta は transcript.appendFinalSegment を呼ぶ", async () => {
    const key = "10101010-1010-4010-8010-101010101010";
    const payload = {
      type: "transcript.delta",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      // auth.getProfile mock は任意の UUID に対して同じ Profile を返す (mock-container.ts 参照)
      sourceParticipantId: "11111111-1111-4111-8111-111111111111",
      outputLanguage: "en",
      sequenceNo: 3,
      text: "Hello there",
      isFinal: true,
      spokenAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const appendMock = vi.mocked(container.transcript.appendFinalSegment);
    const lastCall = appendMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const segment = lastCall?.[0] as {
      translatedText: string;
      originalText: string;
      sequenceNo: number;
      languagePair: string;
      roomId: string;
    };
    expect(segment.translatedText).toBe("Hello there");
    expect(segment.sequenceNo).toBe(3);
    // languagePair は "話者言語-outputLanguage" の形式 (docs/notification-detail.md "en-ja" 相当)
    expect(segment.languagePair).toContain("-");
    expect(segment.languagePair.endsWith("en")).toBe(true);
  });

  it("isFinal=false の transcript.delta は appendFinalSegment を呼ばない (partial delta は DB 保存しない)", async () => {
    const key = "20202020-2020-4020-8020-202020202020";
    const payload = {
      type: "transcript.delta",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sourceParticipantId: "11111111-1111-4111-8111-111111111111",
      outputLanguage: "en",
      sequenceNo: 4,
      text: "partial delta",
      isFinal: false,
      spokenAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const appendMock = vi.mocked(container.transcript.appendFinalSegment);
    const callsBefore = appendMock.mock.calls.length;

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(appendMock.mock.calls.length).toBe(callsBefore);
  });
});

describe("POST /internal/agent/events — #67 translation.ended イベント発行", () => {
  it("translation.session_ended を受信すると translation.ended DomainEvent を EventBus に publish する", async () => {
    const received: { type: string; payload: { reason: string; roomId: string } }[] = [];
    const unsubscribe = container.eventBus.subscribe("translation.ended", async (event) => {
      received.push(event);
      await Promise.resolve();
    });

    const key = "30303030-3030-4030-8030-303030303030";
    const payload = {
      type: "translation.session_ended",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sourceParticipantId: "33333333-3333-4333-8333-333333333333",
      outputLanguage: "en",
      endedAt: new Date().toISOString(),
      durationMs: 60000,
      billableSeconds: 60,
      reason: "participant_left",
    };
    const body = JSON.stringify(payload);
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-agent": "trancall-translation-agent",
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    unsubscribe();

    expect(response.statusCode).toBe(200);
    expect(received.length).toBe(1);
    expect(received[0]?.type).toBe("translation.ended");
    expect(received[0]?.payload.reason).toBe("participant_left");
  });
});

describe("#25: HMAC は受信時そのままの rawBody で検証する", () => {
  it("整形済み (改行・インデント入り) body を再シリアライズせずに検証できる", async () => {
    const key = "40404040-4040-4040-8040-404040404040";
    // JSON.stringify(JSON.parse(rawBody)) は空白を失うため、旧実装 (JSON.stringify(request.body))
    // ではこの rawBody に対する signature と一致せず 401 になっていた。
    const rawBody = [
      "{",
      '  "type": "agent.metrics",',
      '  "agentJobId": "11111111-1111-4111-8111-111111111111",',
      '  "roomId": "22222222-2222-4222-8222-222222222222",',
      '  "latencyMs": {',
      '    "captureToAgent": [10],',
      '    "agentToOpenAI": [5],',
      '    "openAIFirstDelta": [100],',
      '    "agentPublish": [15],',
      '    "totalEndToEnd": [130]',
      "  },",
      '  "memoryRssBytes": 1000,',
      `  "collectedAt": "${new Date().toISOString()}"`,
      "}",
    ].join("\n");
    const timestamp = freshTimestamp();
    const sig = makeSignature(rawBody, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("#25/確定#4: HMAC タイムスタンプ検証 (x-trancall-timestamp)", () => {
  function makeMetricsPayload(): Record<string, unknown> {
    return {
      type: "agent.metrics",
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      latencyMs: {
        captureToAgent: [10],
        agentToOpenAI: [5],
        openAIFirstDelta: [100],
        agentPublish: [15],
        totalEndToEnd: [130],
      },
      memoryRssBytes: 1000,
      collectedAt: new Date().toISOString(),
    };
  }

  it("5分以上古い x-trancall-timestamp は 401 を返す", async () => {
    const key = "50505050-5050-4050-8050-505050505050";
    const payload = makeMetricsPayload();
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    // 確定#4: timestamp は署名対象に含まれるため、staleTimestamp を使って署名する
    // (署名対象と送信ヘッダーの timestamp を一致させないと signature 不一致で
    // 401 になってしまい、鮮度チェック自体を検証できないため)。
    const sig = makeSignature(JSON.stringify(payload), key, staleTimestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": staleTimestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("現在時刻に近い x-trancall-timestamp は許可される", async () => {
    const key = "60606060-6060-4060-8060-606060606060";
    const payload = makeMetricsPayload();
    const timestamp = freshTimestamp();
    const sig = makeSignature(JSON.stringify(payload), key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  // 確定#4: 旧実装は timestamp ヘッダーが未指定でも「Agent 未対応のため後方互換で許可」
  // していたが、それ自体が「timestamp を外せば署名検証の対象から鮮度チェックを
  // 除外できる」抜け道になっていた。timestamp ヘッダーは必須化した。
  it("x-trancall-timestamp ヘッダーなしは 401 を返す (確定#4: 必須化)", async () => {
    const key = "70707070-7070-4070-8070-707070707070";
    const payload = makeMetricsPayload();
    const timestamp = freshTimestamp();
    const sig = makeSignature(JSON.stringify(payload), key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/agent/events",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        // "x-trancall-timestamp" を意図的に付与しない
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
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
        "x-trancall-timestamp": freshTimestamp(),
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
    const timestamp = freshTimestamp();
    const sig = makeSignature(body, key, timestamp);

    const response = await app.inject({
      method: "POST",
      url: "/internal/translation/heartbeat",
      headers: {
        "content-type": "application/json",
        "x-trancall-signature": sig,
        "x-trancall-idempotency-key": key,
        "x-trancall-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
  });
});
