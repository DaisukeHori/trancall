/**
 * OpenAI WS クライアント テスト
 *
 * WebSocket は EventEmitter ベースのモックで差し替えて実際のネットワーク接続なしに検証。
 *
 * カバー項目:
 * - 接続成功 → session.update 送信 → open emit
 * - sendAudioFrame → input_audio_buffer.append メッセージ送信
 * - response.audio.delta 受信 → audio.delta emit
 * - response.audio_transcript.delta 受信 → transcript.delta emit
 * - response.audio_transcript.done 受信 → transcript.done emit
 * - close code 1000 → 再接続しない
 * - close code 4001 → fatal、再接続しない
 * - 通常の close → scheduleReconnect (reconnecting イベント emit)
 * - autoReconnect=false → 再接続しない
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
      // no-op
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

describe("OpenAIWsClient: 接続・session.update", () => {
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

  it("接続中に重複 connect() を呼んでも WebSocket が 1 つしか作られない", async () => {
    const client = makeClient();

    void client.connect();
    void client.connect();

    await waitNextTick();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("OpenAIWsClient: 音声送信", () => {
  it("sendAudioFrame() で input_audio_buffer.append が送信される", async () => {
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
    expect(msg["type"]).toBe("input_audio_buffer.append");
    expect(msg["audio"]).toBe("base64pcmdata==");
  });

  it("未接続時の sendAudioFrame() は何も送信しない", () => {
    const client = makeClient();
    client.sendAudioFrame("data");
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});

describe("OpenAIWsClient: メッセージ受信", () => {
  it("response.audio.delta → audio.delta イベントが emit される", async () => {
    const client = makeClient();
    const audioDeltaSpy = vi.fn();
    client.on("audio.delta", audioDeltaSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "response.audio.delta", delta: "encodedAudio==" });
    await waitNextTick(2);

    expect(audioDeltaSpy).toHaveBeenCalledTimes(1);
    const args = audioDeltaSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({ audioBase64: "encodedAudio==" });
  });

  it("response.audio_transcript.delta → transcript.delta イベントが emit される", async () => {
    const client = makeClient();
    const transcriptDeltaSpy = vi.fn();
    client.on("transcript.delta", transcriptDeltaSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "response.audio_transcript.delta", delta: "Hello " });
    await waitNextTick(2);

    expect(transcriptDeltaSpy).toHaveBeenCalledTimes(1);
    const args = transcriptDeltaSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({ text: "Hello ", isFinal: false });
  });

  it("response.audio_transcript.done → transcript.done イベントが emit される", async () => {
    const client = makeClient();
    const transcriptDoneSpy = vi.fn();
    client.on("transcript.done", transcriptDoneSpy);

    void client.connect();
    await waitNextTick();

    const ws = MockWebSocket.instances[0];
    if (!ws) return;

    ws.simulateOpen();
    await waitNextTick(2);

    ws.simulateMessage({ type: "response.audio_transcript.done", transcript: "Hello world" });
    await waitNextTick(2);

    expect(transcriptDoneSpy).toHaveBeenCalledTimes(1);
    const args = transcriptDoneSpy.mock.calls[0];
    if (!args) return;
    expect(args[0]).toMatchObject({ text: "Hello world", isFinal: true });
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
