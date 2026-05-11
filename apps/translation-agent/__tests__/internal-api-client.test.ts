/**
 * Internal API Client テスト
 *
 * - HMAC 署名が正しく付与される
 * - 4xx は即座に return（リトライしない）
 * - 5xx / network は exponential backoff でリトライ
 */

import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import {
  InternalApiClient,
  buildSessionStartedEvent,
  buildSessionEndedEvent,
} from "../src/internal-api-client.js";
import { createLogger } from "../src/logger.js";

const SECRET = "test-secret-at-least-32-characters-long-aa";
const SERVER_URL = "https://api.trancall.test";

function makeClient(fetchImpl: typeof fetch, maxRetries = 0) {
  return new InternalApiClient({
    serverUrl: SERVER_URL,
    hmacSecret: SECRET,
    agentName: "trancall-translation-agent",
    maxRetries,
    logger: createLogger("error"),
    fetchImpl,
  });
}

describe("InternalApiClient.postEvent", () => {
  it("HMAC-SHA256 署名が body+idempotencyKey に付与される", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    let capturedBody: string | null = null;

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response("ok", { status: 200 });
    });

    const client = makeClient(fetchMock);

    const event = buildSessionStartedEvent({
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sourceParticipantId: "33333333-3333-4333-8333-333333333333",
      targetParticipantId: "44444444-4444-4444-8444-444444444444",
      outputLanguage: "ja",
    });
    const result = await client.postEvent(event);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedHeaders).not.toBeNull();
    if (!capturedHeaders || !capturedBody) return;

    const headers = capturedHeaders as Record<string, string>;
    const body = capturedBody as string;

    const signature = headers["x-trancall-signature"];
    const idempotencyKey = headers["x-trancall-idempotency-key"];
    expect(typeof signature).toBe("string");
    expect(typeof idempotencyKey).toBe("string");

    const expected = createHmac("sha256", SECRET)
      .update(`${body}|${idempotencyKey ?? ""}`)
      .digest("hex");
    expect(signature).toBe(expected);
  });

  it("agent name ヘッダが付与される", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });
    const client = makeClient(fetchMock);

    await client.postEvent(
      buildSessionStartedEvent({
        agentJobId: "11111111-1111-4111-8111-111111111111",
        roomId: "22222222-2222-4222-8222-222222222222",
        sourceParticipantId: "33333333-3333-4333-8333-333333333333",
        targetParticipantId: "44444444-4444-4444-8444-444444444444",
        outputLanguage: "ja",
      }),
    );

    expect(capturedHeaders).not.toBeNull();
    if (!capturedHeaders) return;
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["x-trancall-agent"]).toBe("trancall-translation-agent");
  });

  it("4xx は即座に return（リトライしない）", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    const client = makeClient(fetchMock, 3);

    const result = await client.postEvent(
      buildSessionStartedEvent({
        agentJobId: "11111111-1111-4111-8111-111111111111",
        roomId: "22222222-2222-4222-8222-222222222222",
        sourceParticipantId: "33333333-3333-4333-8333-333333333333",
        targetParticipantId: "44444444-4444-4444-8444-444444444444",
        outputLanguage: "ja",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server_4xx");
    expect(result.error.httpStatus).toBe(400);
  });

  it("5xx はリトライされる（maxRetries=2 で 3 回呼ばれる）", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response("internal error", { status: 503 })));
    const client = makeClient(fetchMock, 2);

    const result = await client.postEvent(
      buildSessionStartedEvent({
        agentJobId: "11111111-1111-4111-8111-111111111111",
        roomId: "22222222-2222-4222-8222-222222222222",
        sourceParticipantId: "33333333-3333-4333-8333-333333333333",
        targetParticipantId: "44444444-4444-4444-8444-444444444444",
        outputLanguage: "ja",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server_5xx");
  }, 30000);

  it("network エラーもリトライされる", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const client = makeClient(fetchMock, 2);

    const result = await client.postEvent(
      buildSessionEndedEvent({
        agentJobId: "11111111-1111-4111-8111-111111111111",
        roomId: "22222222-2222-4222-8222-222222222222",
        sourceParticipantId: "33333333-3333-4333-8333-333333333333",
        outputLanguage: "ja",
        startedAt: new Date("2026-05-12T00:00:00.000Z"),
        endedAt: new Date("2026-05-12T00:30:00.000Z"),
        reason: "participant_left",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("network");
  }, 30000);

  it("リトライ中に成功した場合は ok を返す", async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      callCount += 1;
      if (callCount < 3) {
        return new Response("retry me", { status: 503 });
      }
      return new Response("ok", { status: 200 });
    });
    const client = makeClient(fetchMock, 3);

    const result = await client.postEvent(
      buildSessionStartedEvent({
        agentJobId: "11111111-1111-4111-8111-111111111111",
        roomId: "22222222-2222-4222-8222-222222222222",
        sourceParticipantId: "33333333-3333-4333-8333-333333333333",
        targetParticipantId: "44444444-4444-4444-8444-444444444444",
        outputLanguage: "ja",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
  }, 30000);
});

describe("buildSessionEndedEvent", () => {
  it("durationMs と billableSeconds が正しく計算される", () => {
    const event = buildSessionEndedEvent({
      agentJobId: "11111111-1111-4111-8111-111111111111",
      roomId: "22222222-2222-4222-8222-222222222222",
      sourceParticipantId: "33333333-3333-4333-8333-333333333333",
      outputLanguage: "en",
      startedAt: new Date("2026-05-12T00:00:00.000Z"),
      endedAt: new Date("2026-05-12T00:01:30.500Z"),
      reason: "participant_left",
    });
    expect(event.durationMs).toBe(90500);
    expect(event.billableSeconds).toBe(91); // ceil(90.5)
  });
});
