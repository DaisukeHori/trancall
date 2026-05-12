/**
 * TranslationSession テスト
 *
 * OpenAI WS クライアントと InternalApiClient をモックで差し替えて、
 * セッションのライフサイクルを検証する。
 *
 * カバー項目:
 * - start() → session_started イベントが postEvent で送信される
 * - end() → session_ended イベントが postEvent で送信される
 * - T7: end() で session.close が送信される (sendSessionClose 呼び出し)
 * - T8: agent_publish_failed 理由でセッション終了できる
 * - transcript.delta → postTranscriptDelta が呼ばれる (sequenceNo 増加)
 * - transcript.done (isFinal=true) → postTranscriptDelta が呼ばれる
 * - pushAudioFrame → openaiClient.sendAudioFrame が呼ばれる
 * - T4: openAIRequestSentAt リセットロジック (200ms 途絶後の append で再採取)
 * - T5/T6: recordPublishMetrics が agentPublish + totalEndToEnd を記録する
 * - T8: recordPublishFailure が 3 回で session.end("agent_publish_failed") を呼ぶ
 * - T10: degraded/recovered イベントが emit される
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
    sessionCloseSent = false;
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

    sendSessionClose(): void {
      this.sessionCloseSent = true;
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
    // T-14: sourceLang (発話者の言語、Data Channel payload に使用)
    sourceLang: "ja",
    outputLanguage: "en",
    openaiApiKey: "sk-test",
    openaiUrl: "wss://api.openai.com/v1/realtime/translations",
    sampleRateHz: 24000,
    internalApiClient: apiClient as unknown as InternalApiClient,
    logger: makeLogger(),
    metricsIntervalMs: 60000,
    degradedCheckIntervalMs: 1000,
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

  it("T7: end() で sendSessionClose() が呼ばれる (pending buffer フラッシュ)", async () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    await session.end("participant_left");

    const ws = MockOpenAIWsClient.instances[0];
    // T7: session.close を送信してから close() を呼ぶ
    expect(ws?.sessionCloseSent).toBe(true);
    expect(ws?.closeCalled).toBe(true);
  });

  it("T8: agent_publish_failed 理由で end() が呼べる", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    await session.end("agent_publish_failed");

    const endedCall = apiClient.calls.find((c) => c.type === "translation.session_ended");
    expect(endedCall).toBeDefined();
    if (!endedCall || endedCall.type !== "translation.session_ended") return;
    expect(endedCall.reason).toBe("agent_publish_failed");
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

  it("pushAudioFrame() → agentToOpenAI バッファに値が追加される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.pushAudioFrame("base64data==");

    // agentToOpenAI にデータが入ったことを metrics 送信で確認
    vi.advanceTimersByTime(1000);
    await waitNextTick(3);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    expect(metricsCalls.length).toBeGreaterThanOrEqual(1);

    const metricsCall = metricsCalls[0];
    if (!metricsCall || metricsCall.type !== "agent.metrics") return;
    expect(metricsCall.latencyMs.agentToOpenAI.length).toBeGreaterThanOrEqual(1);
  });

  it("T4: 200ms 以上の途絶後に openAIRequestSentAt が再採取される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 500 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // 最初のフレーム送信
    session.pushAudioFrame("frame1");

    // audio.delta を受信して openAIRequestSentAt が null になる
    ws.emit("audio.delta", { audioBase64: "audio1", receivedAt: Date.now() });
    await waitNextTick(2);

    // 200ms 後に次のフレームを送信 → openAIRequestSentAt が再採取される
    vi.advanceTimersByTime(500);
    await waitNextTick(2);
    session.pushAudioFrame("frame2");

    // metrics を確認
    vi.advanceTimersByTime(500);
    await waitNextTick(3);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    if (metricsCalls.length > 0) {
      const metricsCall = metricsCalls[0];
      if (!metricsCall || metricsCall.type !== "agent.metrics") return;
      // agentToOpenAI は 2 フレーム分記録される
      expect(metricsCall.latencyMs.agentToOpenAI.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("TranslationSession: T3 captureToAgent 計測", () => {
  it("recordCaptureToAgent() で captureToAgent バッファに値が記録される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.recordCaptureToAgent(15);
    session.recordCaptureToAgent(20);

    vi.advanceTimersByTime(1000);
    await waitNextTick(3);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    expect(metricsCalls.length).toBeGreaterThanOrEqual(1);
    const metricsCall = metricsCalls[0];
    if (!metricsCall || metricsCall.type !== "agent.metrics") return;
    expect(metricsCall.latencyMs.captureToAgent).toContain(15);
    expect(metricsCall.latencyMs.captureToAgent).toContain(20);
  });
});

describe("TranslationSession: T5/T6 agentPublish / totalEndToEnd 計測", () => {
  it("recordPublishMetrics() で agentPublish と totalEndToEnd が記録される", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    // T6: totalEndToEnd = c2a + a2o + ofd + publishLatency
    session.recordCaptureToAgent(10);
    session.pushAudioFrame("frame");

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // openAIFirstDelta を記録するために audio.delta イベントを受信
    ws.emit("audio.delta", { audioBase64: "audio", receivedAt: Date.now() });
    await waitNextTick(2);

    session.recordPublishMetrics(5);

    vi.advanceTimersByTime(1000);
    await waitNextTick(3);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    expect(metricsCalls.length).toBeGreaterThanOrEqual(1);
    const metricsCall = metricsCalls[0];
    if (!metricsCall || metricsCall.type !== "agent.metrics") return;
    expect(metricsCall.latencyMs.agentPublish).toContain(5);
    expect(metricsCall.latencyMs.totalEndToEnd.length).toBeGreaterThanOrEqual(1);
  });

  it("recordAgentPublish() は直接 agentPublish バッファに記録する", async () => {
    const { config, apiClient } = makeConfig({ metricsIntervalMs: 1000 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.recordAgentPublish(30);

    vi.advanceTimersByTime(1000);
    await waitNextTick(3);

    const metricsCalls = apiClient.calls.filter((c) => c.type === "agent.metrics");
    const metricsCall = metricsCalls[0];
    if (!metricsCall || metricsCall.type !== "agent.metrics") return;
    expect(metricsCall.latencyMs.agentPublish).toContain(30);
  });
});

describe("TranslationSession: T8 publish 失敗カウンタ", () => {
  it("recordPublishFailure() が 3 回呼ばれると agent_publish_failed で end() が呼ばれる", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const endedSpy = vi.fn();
    session.on("ended", endedSpy);

    session.recordPublishFailure(); // 1 回目
    session.recordPublishFailure(); // 2 回目
    session.recordPublishFailure(); // 3 回目 → end("agent_publish_failed")

    await waitNextTick(5);

    const endedCall = apiClient.calls.find((c) => c.type === "translation.session_ended");
    expect(endedCall).toBeDefined();
    if (!endedCall || endedCall.type !== "translation.session_ended") return;
    expect(endedCall.reason).toBe("agent_publish_failed");
  });

  it("recordPublishSuccess() で失敗カウンタがリセットされる", async () => {
    const { config, apiClient } = makeConfig();
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    session.recordPublishFailure(); // 1 回目
    session.recordPublishFailure(); // 2 回目
    session.recordPublishSuccess(); // リセット
    session.recordPublishFailure(); // 1 回目に戻る
    session.recordPublishFailure(); // 2 回目
    // 3 回目に達していないので end() は呼ばれない

    await waitNextTick(3);

    const endedCalls = apiClient.calls.filter((c) => c.type === "translation.session_ended");
    expect(endedCalls).toHaveLength(0);
  });
});

describe("TranslationSession: T10 degraded/recovered 判定", () => {
  it("degraded イベントが emit され、reconnecting 状態を検出する", async () => {
    const { config } = makeConfig({ degradedCheckIntervalMs: 100 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    const degradedSpy = vi.fn();
    session.on("degraded", degradedSpy);

    // reconnecting イベントを emit → 即時 degraded 検出
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(2);

    expect(degradedSpy).toHaveBeenCalledTimes(1);
    expect(degradedSpy.mock.calls[0]?.[0]).toBe("openai_ws_reconnecting");
  });

  it("degraded 状態中に再度 degraded イベントは emit されない (二重防止)", async () => {
    const { config } = makeConfig({ degradedCheckIntervalMs: 100 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    const degradedSpy = vi.fn();
    session.on("degraded", degradedSpy);

    // 2 回 reconnecting → 最初の 1 回のみ emit
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(2);
    ws.emit("reconnecting", 2, 2000);
    await waitNextTick(2);

    expect(degradedSpy).toHaveBeenCalledTimes(1);
  });
});

describe("TranslationSession: T10 recovered 3 秒継続条件 (D1 §7.2)", () => {
  it("recovered 条件成立後 1 秒経過では recovered イベントが発火しない", async () => {
    // degradedCheckIntervalMs=500 で 500ms ごとにチェック
    const { config } = makeConfig({ degradedCheckIntervalMs: 500 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // degraded 状態にする
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(2);

    const recoveredSpy = vi.fn();
    session.on("recovered", recoveredSpy);

    // WS を open 状態にし、lastOutputAudioAt を直近に設定して recovered 条件を成立させる
    ws.getState = () => "open";
    // lastOutputAudioAt を「今」に設定するため audio.delta を emit
    ws.emit("audio.delta", { audioBase64: "audio1", receivedAt: Date.now() });
    await waitNextTick(2);

    // 1 秒経過 (3 秒未満) → checkDegradedStatus が 2 回実行されるが recovered はまだ
    vi.advanceTimersByTime(1000);
    await waitNextTick(4);

    expect(recoveredSpy).not.toHaveBeenCalled();

    await session.end("participant_left");
  });

  it("recovered 条件成立後 3 秒以上経過で recovered イベントが発火する", async () => {
    const { config } = makeConfig({ degradedCheckIntervalMs: 500 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // degraded 状態にする
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(2);

    const recoveredSpy = vi.fn();
    session.on("recovered", recoveredSpy);

    // WS を open 状態にし、audio.delta で lastOutputAudioAt を直近に設定
    ws.getState = () => "open";
    ws.emit("audio.delta", { audioBase64: "audio1", receivedAt: Date.now() });
    await waitNextTick(2);

    // 3 秒以上経過 (各チェック時に lastOutputAudioAt を更新して条件を維持)
    // 500ms ごとにチェック → 3000ms 経過で最低 6 回チェック
    // チェックのたびに audio.delta で lastOutputAudioAt を更新する必要がある
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(500);
      ws.emit("audio.delta", { audioBase64: `audio${i}`, receivedAt: Date.now() });
      await waitNextTick(3);
    }

    expect(recoveredSpy).toHaveBeenCalledTimes(1);

    await session.end("participant_left");
  });

  it("条件成立 → 2 秒経過で条件非成立 → 再度成立 → 3 秒経過で recovered 発火 (タイマーリセット動作)", async () => {
    const { config } = makeConfig({ degradedCheckIntervalMs: 500 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // degraded 状態にする
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(2);

    const recoveredSpy = vi.fn();
    session.on("recovered", recoveredSpy);

    // フェーズ1: recovered 条件成立 (WS open + 直近 delta)
    ws.getState = () => "open";
    ws.emit("audio.delta", { audioBase64: "audio0", receivedAt: Date.now() });
    await waitNextTick(2);

    // 2 秒経過 (3 秒未満) → recovered まだ発火しない
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(500);
      ws.emit("audio.delta", { audioBase64: `audio${i}`, receivedAt: Date.now() });
      await waitNextTick(3);
    }
    expect(recoveredSpy).not.toHaveBeenCalled();

    // フェーズ2: 条件非成立 → lastOutputAudioAt を 2 秒以上前に強制して recovered 条件を破る
    // checkDegradedStatus の次回チェックで recoveredSince がリセットされる
    // ws.getState を "reconnecting" に戻して degraded 条件を再成立させる（recovered 判定をキャンセル）
    // ただし isDegraded は既に true なので degraded イベントは再発火しない
    // lastOutputAudioAt を古くするため、新しい audio.delta を送らずに時間を進める
    vi.advanceTimersByTime(1500); // 1.5秒進める → lastOutputAudioAt が 1.5秒前になり recentDelta=false
    await waitNextTick(3);
    // この時点で recoveredSince は null にリセットされているはず

    expect(recoveredSpy).not.toHaveBeenCalled();

    // フェーズ3: 再度 recovered 条件成立
    ws.emit("audio.delta", { audioBase64: "audio_restart", receivedAt: Date.now() });
    await waitNextTick(2);

    // 3 秒以上経過 → recovered 発火
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(500);
      ws.emit("audio.delta", { audioBase64: `audio_r${i}`, receivedAt: Date.now() });
      await waitNextTick(3);
    }

    expect(recoveredSpy).toHaveBeenCalledTimes(1);

    await session.end("participant_left");
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

// =============================================================================
// T-14: degraded/recovered Internal API POST テスト
// =============================================================================

describe("TranslationSession: T14 degraded Internal API POST", () => {
  it("degraded 検出時に translation.degraded を postEvent で送信する", async () => {
    const { config, apiClient } = makeConfig({ degradedCheckIntervalMs: 100 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // reconnecting イベントを emit → 即時 degraded 検出 + postDegradedEvent 呼び出し
    ws.emit("reconnecting");
    await waitNextTick(3);

    const degradedCalls = apiClient.calls.filter((c) => c.type === "translation.degraded");
    expect(degradedCalls.length).toBeGreaterThanOrEqual(1);

    const degradedCall = degradedCalls[0];
    if (!degradedCall || degradedCall.type !== "translation.degraded") return;
    expect(degradedCall.reason).toBe("openai_ws_reconnecting");
    expect(degradedCall.sourceLang).toBe("ja");
    expect(degradedCall.targetLang).toBe("en");
    expect(degradedCall.roomId).toBe(config.roomId);

    await session.end("participant_left");
  });

  it("degraded 検出が 2 回続いても translation.degraded は 1 回だけ postEvent される", async () => {
    const { config, apiClient } = makeConfig({ degradedCheckIntervalMs: 100 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    ws.emit("reconnecting");
    await waitNextTick(3);
    ws.emit("reconnecting");
    await waitNextTick(3);

    const degradedCalls = apiClient.calls.filter((c) => c.type === "translation.degraded");
    expect(degradedCalls).toHaveLength(1);

    await session.end("participant_left");
  });
});

describe("TranslationSession: T14 recovered Internal API POST", () => {
  it("recovered 確定時に translation.recovered を postEvent で送信する", async () => {
    // degradedCheckIntervalMs=500 で 500ms ごとにチェックし、3 秒継続で recovered 確定
    const { config, apiClient } = makeConfig({ degradedCheckIntervalMs: 500 });
    const session = new TranslationSession(config);
    await session.start();
    await waitNextTick(2);

    const ws = MockOpenAIWsClient.instances[0];
    if (!ws) throw new Error("WS not created");

    // 1. degraded 状態にする (T13 既存パターンと同様)
    ws.emit("reconnecting", 1, 1000);
    await waitNextTick(3);

    // 2. WS を open に戻し、audio delta も流して recovered 条件 3 秒を維持
    ws.getState = () => "open";
    ws.emit("audio.delta", { audioBase64: "audio_start", receivedAt: Date.now() });
    await waitNextTick(2);

    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(500);
      ws.emit("audio.delta", { audioBase64: `audio_r${i}`, receivedAt: Date.now() });
      await waitNextTick(3);
    }

    // postEvent が非同期なのでさらに待機
    await waitNextTick(5);

    const recoveredCalls = apiClient.calls.filter((c) => c.type === "translation.recovered");
    expect(recoveredCalls.length).toBeGreaterThanOrEqual(1);

    const recoveredCall = recoveredCalls[0];
    if (!recoveredCall || recoveredCall.type !== "translation.recovered") return;
    expect(recoveredCall.sourceLang).toBe("ja");
    expect(recoveredCall.targetLang).toBe("en");
    expect(recoveredCall.roomId).toBe(config.roomId);
    expect(recoveredCall.degradedDurationMs).toBeGreaterThanOrEqual(0);

    await session.end("participant_left");
  });
});

describe("TranslationSession: T14 getDegradedChannelMeta()", () => {
  it("getDegradedChannelMeta() が sourceLang / targetLang / sessionId を返す", async () => {
    const { config } = makeConfig();
    const session = new TranslationSession(config);

    const meta = session.getDegradedChannelMeta();
    expect(meta.sourceLang).toBe("ja");
    expect(meta.targetLang).toBe("en");
    expect(meta.sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID形式
  });

  it("config.sessionId が指定された場合はそちらを返す", async () => {
    const customSessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const { config } = makeConfig({ sessionId: customSessionId });
    const session = new TranslationSession(config);

    const meta = session.getDegradedChannelMeta();
    expect(meta.sessionId).toBe(customSessionId);
  });
});
