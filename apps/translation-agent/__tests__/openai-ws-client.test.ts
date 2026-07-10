/**
 * OpenAI WS クライアント テスト
 *
 * WebSocket は EventEmitter ベースのモックで差し替えて実際のネットワーク接続なしに検証。
 *
 * カバー項目:
 * - 接続成功 → session.update 送信 (audio.output.language のみ, T2)
 * - sendAudioFrame → session.input_audio_buffer.append メッセージ送信 (T1)
 * - session.output_audio.delta 受信 → audio.delta emit (T1)
 * - session.output_transcript.delta 受信 → transcript.delta emit (T1)
 * - session.created 受信 → ログのみ (T1)
 * - session.close 送信 → sendSessionClose() (T7)
 * - close code 1000 → 再接続しない
 * - close code 4001 → fatal、再接続しない
 * - 通常の close → scheduleReconnect (reconnecting イベント emit)
 * - autoReconnect=false → 再接続しない
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- vi.hoisted でモッククラスを定義 ---
// node:events はネイティブモジュールのため require で参照する
const { MockWebSocket } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events") as { EventEmitter: typeof import("node:events").EventEmitter };

  class MockWebSocket extends EventEmitter {
    static instances: MockWebSocket[] = [];

    sentMessages: string[] = [];
    closeCalled = false;
    closeCode = 0;
    pingCount = 0;
    terminateCalled = false;

    constructor(
      public readonly url: string,
      public readonly options: Record<string, unknown>,
    ) {
      super();
      MockWebSocket.instances.push(this);
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }

    close(code = 1000, reason = ""): void {
      this.closeCalled = true;
      this.closeCode = code;
      const reasonBuf = Buffer.from(reason);
      process.nextTick(() => {
        this.emit("close", code, reasonBuf);
      });
    }

    ping(): void {
      this.pingCount += 1;
    }

    // #31: pong タイムアウト検知テスト用 — 実際の ws.terminate() を模す
    // (半死接続の強制切断。close イベントは異常切断コード 1006 相当で emit する)
    terminate(): void {
      this.terminateCalled = true;
      process.nextTick(() => {
        this.emit("close", 1006, Buffer.from("terminated"));
      });
    }

    simulateOpen(): void {
      process.nextTick(() => {
        this.emit("open");
      });
    }

    simulateMessage(data: unknown): void {
      process.nextTick(() => {
        this.emit("message", Buffer.from(JSON.stringify(data)));
      });
    }

    simulateClose(code: number, reason = ""): void {
      const reasonBuf = Buffer.from(reason);
      process.nextTick(() => {
        this.emit("close", code, reasonBuf);
      });
    }

    simulateError(error: Error): void {
      process.nextTick(() => {
        this.emit("error", error);
      });
    }

    // #31: pong タイムアウト検知テスト用
    simulatePong(): void {
      process.nextTick(() => {
        this.emit("pong");
      });
    }
  }

  return { MockWebSocket };
});

vi.mock("ws", () => {
  return {
    default: MockWebSocket,
  };
});

import { OpenAIWsClient } from "../src/openai-ws-client.js";
import { createLogger } from "../src/logger.js";

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

function makeClient(autoReconnect = false) {
  return new OpenAIWsClient({
    url: "wss://api.openai.com/v1/realtime/translations",
    apiKey: "sk-test",
    outputLanguage: "en",
    sampleRateHz: 24000,
    autoReconnect,
    logger: createLogger("error"),
  });
}

beforeEach(() => {
  MockWebSocket.instances.length = 0;
});

// --- テスト ---

describe("OpenAIWsClient: 接続・session.update (T2)", () => {
  it("connect() で WebSocket が作成され、open で session.update が送信される", async () => {
    const client = makeClient();
    const openSpy = vi.fn();
    client.on("open", openSpy);

    void client.connect();

    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(ws.sentMessages).toHaveLength(1);

    const sent = JSON.parse(ws.sentMessages[0] ?? "{}") as Record<string, unknown>;
    expect(sent["type"]).toBe("session.update");
  });

  it("T2: session.update payload は audio.output.language のみ含む", async () => {
    const client = makeClient();
    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    const sent = JSON.parse(ws.sentMessages[0] ?? "{}") as {
      type: string;
      session: { audio: { output: { language: string }; input?: unknown } };
    };
    expect(sent.type).toBe("session.update");
    // T2: audio.output.language のみ、input/format/sample_rate_hz は含まない
    expect(sent.session.audio.output.language).toBe("en");
    expect(sent.session.audio.input).toBeUndefined();
  });

  it("接続中に重複 connect() を呼んでも WebSocket が 1 つしか作られない", async () => {
    const client = makeClient();

    void client.connect();
    void client.connect();

    await waitNextTick();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("OpenAIWsClient: 音声送信 (T1)", () => {
  it("T1: sendAudioFrame() で session.input_audio_buffer.append が送信される", async () => {
    const client = makeClient();
    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.sentMessages.length = 0;

    client.sendAudioFrame("base64pcmdata==");

    expect(ws.sentMessages).toHaveLength(1);
    const msg = JSON.parse(ws.sentMessages[0] ?? "{}") as Record<string, unknown>;
    // T1: 公式仕様のイベント名
    expect(msg["type"]).toBe("session.input_audio_buffer.append");
    expect(msg["audio"]).toBe("base64pcmdata==");
  });

  it("未接続時の sendAudioFrame() は何も送信しない", () => {
    const client = makeClient();
    client.sendAudioFrame("data");
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});

describe("OpenAIWsClient: session.close (T7)", () => {
  it("T7: sendSessionClose() で session.close が送信される", async () => {
    const client = makeClient();
    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.sentMessages.length = 0;

    client.sendSessionClose();

    expect(ws.sentMessages).toHaveLength(1);
    const msg = JSON.parse(ws.sentMessages[0] ?? "{}") as Record<string, unknown>;
    expect(msg["type"]).toBe("session.close");
  });

  it("未接続時の sendSessionClose() は何も送信しない", () => {
    const client = makeClient();
    client.sendSessionClose(); // state が idle なので何もしない
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});

describe("OpenAIWsClient: メッセージ受信 (T1)", () => {
  it("T1: session.output_audio.delta → audio.delta イベントが emit される", async () => {
    const client = makeClient();
    const audioDeltaSpy = vi.fn();
    client.on("audio.delta", audioDeltaSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "session.output_audio.delta", delta: "encodedAudio==" });
    await waitNextTick(2);

    expect(audioDeltaSpy).toHaveBeenCalledTimes(1);
    const args = audioDeltaSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({ audioBase64: "encodedAudio==" });
  });

  it("T1: session.output_audio.delta に sample_rate/channels/elapsed_ms が含まれる場合も処理される", async () => {
    const client = makeClient();
    const audioDeltaSpy = vi.fn();
    client.on("audio.delta", audioDeltaSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({
      type: "session.output_audio.delta",
      delta: "audiodata==",
      sample_rate: 24000,
      channels: 1,
      elapsed_ms: 500,
    });
    await waitNextTick(2);

    expect(audioDeltaSpy).toHaveBeenCalledTimes(1);
    const args = audioDeltaSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({
      audioBase64: "audiodata==",
      sampleRate: 24000,
      channels: 1,
      elapsedMs: 500,
    });
  });

  it("T1: session.output_transcript.delta → transcript.delta イベントが emit される", async () => {
    const client = makeClient();
    const transcriptDeltaSpy = vi.fn();
    client.on("transcript.delta", transcriptDeltaSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "session.output_transcript.delta", delta: "Hello " });
    await waitNextTick(2);

    expect(transcriptDeltaSpy).toHaveBeenCalledTimes(1);
    const args = transcriptDeltaSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({ text: "Hello ", isFinal: false });
  });

  it("session.created 受信 → open イベントには影響しない (ログのみ)", async () => {
    const client = makeClient();
    const openSpy = vi.fn();
    client.on("open", openSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    // open イベントは WebSocket の open から emit される (session.created ではない)
    expect(openSpy).toHaveBeenCalledTimes(1);

    // session.created を受信してもエラーにならない
    ws.simulateMessage({ type: "session.created", session: { id: "sess_abc123" } });
    await waitNextTick(2);

    // open は 1 回のみ
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("error メッセージ → error イベントが emit される", async () => {
    const client = makeClient();
    const errorSpy = vi.fn();
    client.on("error", errorSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "error", error: { message: "translation failed" } });
    await waitNextTick(2);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const err = errorSpy.mock.calls[0]?.[0] as Error | undefined;
    expect(err?.message).toBe("translation failed");
  });

  it("未知のイベント type は無視される (エラーにならない)", async () => {
    const client = makeClient();
    const errorSpy = vi.fn();
    client.on("error", errorSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "some.unknown.event", data: "x" });
    await waitNextTick(2);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("OpenAIWsClient: 切断・再接続", () => {
  it("close code 1000 → state が closed、再接続しない", async () => {
    const client = makeClient(false);
    const closeSpy = vi.fn();
    client.on("close", closeSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateClose(1000, "normal close");
    await waitNextTick(2);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe("closed");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("close code 4001 → state が fatal、再接続しない", async () => {
    const client = makeClient(true);
    const closeSpy = vi.fn();
    client.on("close", closeSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateClose(4001, "auth error");
    await waitNextTick(2);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe("fatal");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("autoReconnect=true で通常 close → reconnecting イベント emit", async () => {
    const client = makeClient(true);
    const reconnectingSpy = vi.fn();
    client.on("reconnecting", reconnectingSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateClose(1006, "connection lost");
    await waitNextTick(2);

    expect(reconnectingSpy).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe("reconnecting");
  });

  it("close() で正常切断される", async () => {
    const client = makeClient();
    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    await client.close();

    expect(ws.closeCalled).toBe(true);
    expect(ws.closeCode).toBe(1000);
  });
});

// =============================================================================
// #31: pong タイムアウト検知
// heartbeat の ping に対して PONG_TIMEOUT_MS (10s) 以内に pong が届かない場合、
// 接続を強制切断 (ws.terminate()) して再接続フローに合流させる。
// =============================================================================

describe("OpenAIWsClient: #31 pong タイムアウト検知", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("30秒ごとに ping が送信される", async () => {
    const client = makeClient(false);
    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("ws not created");
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.pingCount).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(ws.pingCount).toBe(1);
    // pong を返して接続を維持する (返さないと PONG_TIMEOUT_MS 後に terminate され
    // heartbeat interval 自体が止まってしまう)
    ws.simulatePong();
    await vi.advanceTimersByTimeAsync(30000);
    expect(ws.pingCount).toBe(2);
  });

  it("ping 送信後 PONG_TIMEOUT_MS (10s) 以内に pong が届けば接続は維持される (terminate されない)", async () => {
    const client = makeClient(false);
    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("ws not created");
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30000); // ping 送信
    ws.simulatePong();
    await vi.advanceTimersByTimeAsync(0);

    // pong 受信済みなので 10s 経過しても terminate されない
    await vi.advanceTimersByTimeAsync(10000);
    expect(ws.terminateCalled).toBe(false);
    expect(client.getState()).toBe("open");
  });

  it("ping 送信後 PONG_TIMEOUT_MS (10s) 以内に pong が届かなければ ws.terminate() で強制切断される", async () => {
    const client = makeClient(true);
    const closeSpy = vi.fn();
    client.on("close", closeSpy);

    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("ws not created");
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30000); // ping 送信、pong タイムアウトタイマー開始
    // pong を送らないまま PONG_TIMEOUT_MS 経過
    await vi.advanceTimersByTimeAsync(10000);

    expect(ws.terminateCalled).toBe(true);
    // terminate() → close(1006) → autoReconnect=true なので reconnecting に遷移する
    expect(client.getState()).toBe("reconnecting");
  });
});

// =============================================================================
// #31: 再接続上限時間 (5分) 超過で fatal に遷移
// 翻訳パイプライン設計書 §10.2: 5分以上接続できない場合は諦めて session を終了できるようにする。
// TranslationSession 側は state==="fatal" + close イベントで end("openai_fatal_error") する。
// =============================================================================

describe("OpenAIWsClient: #31 再接続上限時間 (5分) 超過で fatal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("再接続を試み続けても5分以上接続できない場合、fatal に遷移し close イベントを emit する", async () => {
    const client = makeClient(true);
    const closeSpy = vi.fn();
    const reconnectingSpy = vi.fn();
    client.on("close", closeSpy);
    client.on("reconnecting", reconnectingSpy);

    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    let ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("ws not created");
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    // 最初の切断 → reconnectingSince が記録され、attempt1 (delay 1s) がスケジュールされる
    ws.simulateClose(1006, "connection lost");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState()).toBe("reconnecting");

    // 1s, 2s, 4s, 8s, 16s, 32s, 60s, 60s, 60s, 60s (exponential backoff, 60s 上限) を
    // 累積すると 303s (5分 = 300s を超過) になる。各遅延経過後に新しい接続試行を失敗させ続ける。
    const delaysMs = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000];

    for (const delayMs of delaysMs) {
      await vi.advanceTimersByTimeAsync(delayMs);

      if (client.getState() === "fatal") break;

      const latestWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(latestWs).toBeDefined();
      if (!latestWs) break;
      latestWs.simulateClose(1006, "connection lost");
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(client.getState()).toBe("fatal");
    expect(closeSpy).toHaveBeenCalled();
    // 5 分超過を検出した時点で新たな reconnecting はスケジュールされない
    // (最後の reconnecting emit 回数は delaysMs の消費数以下)
    expect(reconnectingSpy.mock.calls.length).toBeLessThanOrEqual(delaysMs.length + 1);
  });

  it("5分以内に接続が成功すれば reconnectingSince がリセットされ fatal にならない", async () => {
    const client = makeClient(true);
    const closeSpy = vi.fn();
    client.on("close", closeSpy);

    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    let ws = MockWebSocket.instances[0];
    if (!ws) throw new Error("ws not created");
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    ws.simulateClose(1006, "connection lost");
    await vi.advanceTimersByTimeAsync(0);

    // attempt1 (delay 1s) 経過後、新しい接続試行が今度は成功する
    await vi.advanceTimersByTimeAsync(1000);
    const secondWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!secondWs) throw new Error("second ws not created");
    secondWs.simulateOpen();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getState()).toBe("open");
    expect(closeSpy).not.toHaveBeenCalled();

    // 再接続成功後、さらに 5 分以上経過しても fatal にならない
    // (reconnectingSince がリセットされているため)。
    // heartbeat の pong にはきちんと応答して接続を健全に保つ (pong タイムアウトによる
    // 意図しない再切断を防ぐため、#31 pong タイムアウト検知テストとは別の懸念)。
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(30000);
      const currentWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      if (currentWs && client.getState() === "open") {
        currentWs.simulatePong();
        await vi.advanceTimersByTimeAsync(0);
      }
    }
    expect(client.getState()).toBe("open");
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
