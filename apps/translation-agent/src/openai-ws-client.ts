/**
 * OpenAI GPT-Realtime-Translate WebSocket クライアント
 *
 * docs/agent-flow.md の "Translation Pipeline" 節を参照。
 *
 * 役割:
 * - wss://api.openai.com/v1/realtime/translations への接続管理
 * - session.update で出力言語を指定（入力言語は自動検出）
 * - input_audio_buffer.append で PCM16 24kHz を Base64 で送信
 * - response.audio.delta / response.audio.done を受信して呼び出し元に流す
 * - 切断時の自動再接続（exponential backoff, 最大60秒）
 * - heartbeat（30秒ごとの ping）
 *
 * 注意:
 * - 設計書では PCM 24kHz 24kbps 想定だが、OpenAI 側仕様確認のため
 *   実装は 16kHz / 24kHz の両対応とする（config で切替可能）
 * - 同一言語発話時（例: 日本語→日本語）の API 挙動は Gate Check で確認
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";

import { type OutputLanguage } from "@trancall/shared-kernel";

import { type Logger } from "./logger.js";

// --- 設定 ---

export interface OpenAIWsClientConfig {
  url: string;
  apiKey: string;
  outputLanguage: OutputLanguage;
  sampleRateHz: 16000 | 24000;
  /** 再接続を有効にするか（テスト時は false） */
  autoReconnect: boolean;
  logger: Logger;
}

// --- 状態 ---

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "fatal";

// --- イベントペイロード ---

export interface AudioDeltaEvent {
  /** Base64 エンコードされた PCM16 */
  audioBase64: string;
  /** delta 受信時刻 (ms epoch) */
  receivedAt: number;
}

export interface TranscriptDeltaEvent {
  text: string;
  isFinal: boolean;
  receivedAt: number;
}

export interface OpenAIWsEvents {
  open: () => void;
  "audio.delta": (event: AudioDeltaEvent) => void;
  "audio.done": () => void;
  "transcript.delta": (event: TranscriptDeltaEvent) => void;
  "transcript.done": (event: TranscriptDeltaEvent) => void;
  error: (error: Error) => void;
  close: (reason: string) => void;
  reconnecting: (attempt: number, delayMs: number) => void;
}

// --- 型安全な EventEmitter ---
//
// node:events の EventEmitter を型安全にラップする。
// OpenAIWsEvents のキーごとに正しいシグネチャを強制する。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TypedEventEmitter<Events> {
  on<K extends keyof Events>(event: K, listener: Events[K] extends (...args: any[]) => void ? Events[K] : never): this;
  off<K extends keyof Events>(event: K, listener: Events[K] extends (...args: any[]) => void ? Events[K] : never): this;
  emit<K extends keyof Events>(event: K, ...args: Events[K] extends (...args: infer P) => void ? P : never): boolean;
}

// --- クライアント本体 ---

/**
 * OpenAI Realtime Translation WebSocket クライアント。
 *
 * Phase 1a Sprint 0 では「接続して session.update を送る」までを実装。
 * 音声送受信の本格動作は Sprint 1 で gate-check.ts と並行して詰める。
 */
export class OpenAIWsClient extends EventEmitter implements TypedEventEmitter<OpenAIWsEvents> {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "idle";
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: OpenAIWsClientConfig) {
    super();
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === "open" || this.state === "connecting") {
      this.config.logger.warn("OpenAI WS: 既に接続済みまたは接続中", { state: this.state });
      return;
    }

    this.state = "connecting";
    this.config.logger.info("OpenAI WS: 接続開始", {
      url: this.config.url,
      outputLanguage: this.config.outputLanguage,
    });

    const ws = new WebSocket(this.config.url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });
    this.ws = ws;

    ws.on("open", () => {
      this.state = "open";
      this.reconnectAttempts = 0;
      this.config.logger.info("OpenAI WS: 接続成功");
      this.sendSessionUpdate();
      this.startHeartbeat();
      this.emit("open");
    });

    ws.on("message", (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });

    ws.on("error", (error: Error) => {
      this.config.logger.error("OpenAI WS: エラー", { error: error.message });
      this.emit("error", error);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.config.logger.warn("OpenAI WS: 切断", { code, reason: reasonStr });
      this.stopHeartbeat();
      this.ws = null;

      // close code 1000 はクライアント側からの正常終了 → 再接続しない
      if (code === 1000 || !this.config.autoReconnect) {
        this.state = "closed";
        this.emit("close", reasonStr);
        return;
      }

      // 4001/4003/4004 系は認証/権限エラー → 再接続しない
      if (code >= 4000 && code < 5000) {
        this.state = "fatal";
        this.config.logger.error("OpenAI WS: 致命的エラー、再接続停止", { code });
        this.emit("close", reasonStr);
        return;
      }

      this.scheduleReconnect();
    });
  }

  /**
   * PCM16 音声フレームを送信する。
   *
   * @param pcm16Base64 PCM16 (little-endian, mono, sampleRateHz) を Base64 で
   */
  sendAudioFrame(pcm16Base64: string): void {
    if (!this.ws || this.state !== "open") {
      this.config.logger.debug("OpenAI WS: 未接続のためフレームをドロップ");
      return;
    }
    this.ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: pcm16Base64,
      }),
    );
  }

  /**
   * ターン終了を OpenAI に通知し、translation response の生成を促す。
   * VAD ベースで自動的にトリガーされるが、明示的にコミットしたい場合に使う。
   */
  commitInputBuffer(): void {
    if (!this.ws || this.state !== "open") {
      return;
    }
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }

  async close(): Promise<void> {
    this.config.logger.info("OpenAI WS: クライアント側から切断");
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "client requested close");
      this.ws = null;
    }
    this.state = "closed";
    // close イベントは ws の close ハンドラから自然に emit される
    await Promise.resolve();
  }

  // --- 内部実装 ---

  private sendSessionUpdate(): void {
    if (!this.ws) return;

    // OpenAI Realtime Translation API session.update
    // 入力言語は自動検出、出力言語のみ指定
    this.ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            input: {
              format: "pcm16",
              sample_rate_hz: this.config.sampleRateHz,
            },
            output: {
              format: "pcm16",
              sample_rate_hz: this.config.sampleRateHz,
              language: this.config.outputLanguage,
            },
          },
        },
      }),
    );
  }

  private handleMessage(data: WebSocket.RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch (e: unknown) {
      this.config.logger.warn("OpenAI WS: JSON parse 失敗", {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      this.config.logger.warn("OpenAI WS: 想定外メッセージ形式");
      return;
    }

    // 型安全な分岐のため Record<string, unknown> に narrowing
    const msg = parsed as Record<string, unknown>;
    const type = typeof msg["type"] === "string" ? msg["type"] : "unknown";
    const now = Date.now();

    switch (type) {
      case "response.audio.delta": {
        const audio = msg["delta"];
        if (typeof audio === "string") {
          this.emit("audio.delta", { audioBase64: audio, receivedAt: now });
        }
        break;
      }
      case "response.audio.done":
        this.emit("audio.done");
        break;
      case "response.audio_transcript.delta": {
        const text = msg["delta"];
        if (typeof text === "string") {
          this.emit("transcript.delta", { text, isFinal: false, receivedAt: now });
        }
        break;
      }
      case "response.audio_transcript.done": {
        const text = msg["transcript"];
        if (typeof text === "string") {
          this.emit("transcript.done", { text, isFinal: true, receivedAt: now });
        }
        break;
      }
      case "error": {
        const error = msg["error"];
        const errorMessage =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as Record<string, unknown>)["message"])
            : "OpenAI Realtime API error";
        this.emit("error", new Error(errorMessage));
        break;
      }
      default:
        this.config.logger.debug("OpenAI WS: 未処理イベント", { type });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.state === "open") {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.state = "reconnecting";
    this.reconnectAttempts += 1;
    const delayMs = Math.min(60000, 1000 * 2 ** (this.reconnectAttempts - 1));
    this.config.logger.info("OpenAI WS: 再接続スケジュール", {
      attempt: this.reconnectAttempts,
      delayMs,
    });
    this.emit("reconnecting", this.reconnectAttempts, delayMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((e: unknown) => {
        this.config.logger.error("OpenAI WS: 再接続失敗", {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }, delayMs);
  }
}
