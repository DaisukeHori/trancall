/**
 * TranslationSession テスト
 *
 * OpenAI WS クライアントと InternalApiClient をモックで差し替えて、
 * セッションのライフサイクルを検証する。
 *
 * カバー項目:
 * - start() → session_started イベントが postEvent で送信される
 * - end() → session_ended イベントが postEvent で送信される
 * - transcript.delta → postTranscriptDelta が呼ばれる (sequenceNo 増加)
 * - transcript.done (isFinal=true) → postTranscriptDelta が呼ばれる
 * - pushAudioFrame → openaiClient.sendAudioFrame が呼ばれる
 * - metrics が metricsIntervalMs ごとに送信される
 * - end() で metrics が送信された後 session_ended が送信される
 * - isEnding フラグにより end() の二重実行が防がれる
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted でモッククラスを定義
const { MockOpenAIWsClient } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events") as { EventEmitter: typeof import("node:events").EventEmitter };

  class MockOpenAIWsClient extends EventEmitter {
    static instances: MockOpenAIWsClient[] = [];
    connectCalled = false;
    closeCalled = false;
    sentFrames: string[] = [];

    constructor() {
      super();
      MockOpenAIWsClient.instances.push(this);
    }

    async connect(): Promise<void> {
      this.connectCalled = true;
      process.nextTick(() => {
        this.emit("open");
      });
    }

    async close(): Promise<void> {
      this.closeCalled = true;
    }

    sendAudioFrame(pcm16Base64: string): void {
      this.sentFrames.push(pcm16Base64);
    }

    getState() {
      return "open";
    }
  }

  return { MockOpenAIWsClient };
});

vi.mock("../src/openai-ws-client.js", () => {
  return {
    OpenAIWsClient: MockOpenAIWsClient,
  };
});

import {
  TranslationSession,
  type TranslationSessionConfig,
} from "../src/translation-session.js";
import { type InternalApiClient } from "../src/internal-api-client.js";
import { type Logger } from "../src/logger.js";

// --- モック: Logger ---

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: function () { return makeLogger(); },
  };
}

// --- モック: InternalApiClient ---

type PostEventArgs = Parameters<InternalApiClient["postEvent"]>[0];

function makeApiClient(
  responses: Array<{ ok: true } | { ok: false; error: { code: "network"; message: string } }> = [],
) {
  let callIndex = 0;
  const calls: PostEventArgs[] = [];

  const postEvent = vi.fn(async (event: PostEventArgs) => {
    calls.push(event);
    const resp = responses[callIndex] ?? { ok: true };
    callIndex += 1;
    return resp.ok
      ? { ok: true as const, data: undefined }
      : {
          ok: false as const,
          error: (resp as { ok: false; error: { code: "network"; message: string } }).error,
        };
  });

  return {
    postEvent,
    calls,
    get callCount() { return postEvent.mock.calls.length; },
  };
}

// --- テスト共通ヘルパー ---

function waitNextTick(times = 1): Promise<void> {
  return new Promise<void>((resolve) => {
    let count = 0;
    function tick(): void {
      count += 1;
      if (count >= times) {
        resolve();
      } else {
        process.nextTick(tick);
      }
    }
    process.nextTick(tick);
  });
}

function makeConfig(
  overrides: Partial<TranslationSessionConfig> & {
    apiClient?: ReturnType<typeof makeApiClient>;
  } = {},
): {
  config: TranslationSessionConfig;
  apiClient: ReturnType<typeof makeApiClient>;
} {
  const apiClient = overrides.apiClient ?? makeApiClient();

  const config: TranslationSessionConfig = {
    roomId: "room-uuid-1111-1111-1111-111111111111",
    sourceParticipantId: "src-uuid-2222-2222-2222-222222222222",
    targetParticipantId: "tgt-uuid-3333-3333-3333-333333333333",
    outputLanguage: "en",
    openaiApiKey: "sk-test",
    openaiUrl: "wss://api.openai.com/v1/realtime/translations",
    sampleRateHz: 24000,
    internalApiClient: apiClient as unknown as InternalApiClient,
    logger: makeLogger(),
    metricsIntervalMs: 60000,
    ...overrides,
  };

  return { config, apiClient };
}

beforeEach(() => {
  MockOpenAIWsClient.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- テスト ---

describe("TranslationSession: start()", () => {
  it("start() で session_started イベントが postEvent で送信される", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);

    await session.start();
    await waitNextTick(2);

    expect(apiClient.postEvent).toHaveBeenCalledTimes(1);
    const call = apiClient.calls[0];
    expect(call?.type).toBe("translation.session_started");
    if (call?.type !== "translation.session_started") return;
    expect(call.outputLanguage).toBe("en");
    expect(call.roomId).toBe(config.roomId);
  });

  it("start() 失敗でも OpenAI 接続は続行される（warn のみ）", async () => {
    const { config } = makeConfig({
      apiClient: makeApiClient([
        { ok: false, error: { code: "network", message: "connection refused" } },
      ]),
    });
    const session = new TranslationSession(config);

    await expect(session.start()).resolves.not.toThrow();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    expect(ws?.connectCalled).toBe(true);
  });

  it("start() で OpenAI WS が接続される", async () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);

    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    expect(ws).toBeDefined();
    expect(ws?.connectCalled).toBe(true);
  });
});

describe("TranslationSession: end()", () => {
  it("end() で session_ended イベントが postEvent で送信される", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    await session.end("participant_left");

    const endedCall = apiClient.calls.find((c) => c.type === "translation.session_ended");
    expect(endedCall).toBeDefined();
    if (!endedCall || endedCall.type !== "translation.session_ended") return;
    expect(endedCall.reason).toBe("participant_left");
  });

  it("end() の二重呼び出しは無視される", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    await Promise.all([session.end("participant_left"), session.end("agent_shutdown")]);

    const endedCalls = apiClient.calls.filter((c) => c.type === "translation.session_ended");
    expect(endedCalls).toHaveLength(1);
  });

  it("end() で OpenAI WS が close される", async () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    await session.end("agent_shutdown");

    const ws = MockOpenAIWsClient.instances[0];
    expect(ws?.closeCalled).toBe(true);
  });
});

describe("TranslationSession: pushAudioFrame()", () => {
  it("pushAudioFrame() → OpenAI WS に sendAudioFrame が呼ばれる", async () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.pushAudioFrame("base64data==");

    const ws = MockOpenAIWsClient.instances[0];
    expect(ws?.sentFrames).toContain("base64data==");
  });

  it("start() 前の pushAudioFrame() は何もしない（ドロップ）", () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);

    expect(() => {
      session.pushAudioFrame("data");
    }).not.toThrow();
  });
});

describe("TranslationSession: transcript.delta 送信", () => {
  it("transcript.delta イベント → postTranscriptDelta が呼ばれる (isFinal=false)", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    ws.emit("transcript.delta", { text: "こんにちは", isFinal: false, receivedAt: Date.now() });
    await waitNextTick(2);

    const deltaCalls = apiClient.calls.filter((c) => c.type === "transcript.delta");
    expect(deltaCalls.length).toBeGreaterThanOrEqual(1);

    const deltaCall = deltaCalls[0];
    if (!deltaCall || deltaCall.type !== "transcript.delta") return;
    expect(deltaCall.text).toBe("こんにちは");
    expect(deltaCall.isFinal).toBe(false);
    expect(deltaCall.sequenceNo).toBe(0);
  });

  it("transcript.done → isFinal=true で postTranscriptDelta が呼ばれる", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    ws.emit("transcript.done", { text: "完了テキスト", isFinal: true, receivedAt: Date.now() });
    await waitNextTick(2);

    const doneCalls = apiClient.calls.filter(
      (c) => c.type === "transcript.delta" && c.isFinal === true,
    );
    expect(doneCalls.length).toBeGreaterThanOrEqual(1);

    const doneCall = doneCalls[0];
    if (!doneCall || doneCall.type !== "transcript.delta") return;
    expect(doneCall.text).toBe("完了テキスト");
    expect(doneCall.isFinal).toBe(true);
  });

  it("sequenceNo が transcript ごとに増加する", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    ws.emit("transcript.delta", { text: "one", isFinal: false, receivedAt: Date.now() });
    await waitNextTick(2);
    ws.emit("transcript.delta", { text: "two", isFinal: false, receivedAt: Date.now() });
    await waitNextTick(2);
    ws.emit("transcript.delta", { text: "three", isFinal: false, receivedAt: Date.now() });
    await waitNextTick(3);

    const deltaCalls = apiClient.calls.filter((c) => c.type === "transcript.delta");
    expect(deltaCalls.length).toBeGreaterThanOrEqual(3);

    const seqNos = deltaCalls
      .filter((c) => c.type === "transcript.delta")
      .map((c) => (c as { sequenceNo: number }).sequenceNo);
    expect(seqNos[0]).toBe(0);
    expect(seqNos[1]).toBe(1);
    expect(seqNos[2]).toBe(2);
  });
});

describe("TranslationSession: metrics 送信", () => {
  it("バッファが空なら metricsIntervalMs 経過しても metrics は送信されない", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const initialCount = apiClient.callCount;

    vi.advanceTimersByTime(1000);
    await waitNextTick(2);

    expect(apiClient.callCount).toBe(initialCount);
  });

  it("latencyBuffers に値を追加後に metricsIntervalMs 経過 → agent.metrics が送信される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.recordCaptureToAgent(50);
    session.recordAgentPublish(20);
    session.recordTotalEndToEnd(200);

    const beforeCount = apiClient.callCount;

    vi.advanceTimersByTime(1000);
    await waitNextTick(3);

    expect(apiClient.callCount).toBeGreaterThan(beforeCount);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    expect(metricsCalls.length).toBeGreaterThanOrEqual(1);

    const metricsCall = metricsCalls[0];
    if (!metricsCall || metricsCall.type !== "agent.metrics") return;
    expect(metricsCall.latencyMs.captureToAgent).toContain(50);
    expect(metricsCall.latencyMs.agentPublish).toContain(20);
    expect(metricsCall.latencyMs.totalEndToEnd).toContain(200);
  });

  it("end() 呼び出し時に残りの metrics が送信される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 60000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.recordCaptureToAgent(100);

    await session.end("participant_left");

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    expect(metricsCalls.length).toBeGreaterThanOrEqual(1);
  });
});
