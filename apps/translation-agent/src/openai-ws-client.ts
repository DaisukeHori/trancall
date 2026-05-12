/**
 * OpenAI GPT-Realtime-Translate WebSocket クライアント
 *
 * docs/translation-pipeline-design.md §4 準拠。
 *
 * 役割:
 * - wss://api.openai.com/v1/realtime/translations への接続管理
 * - session.update で出力言語を指定（入力言語は自動検出）
 * - session.input_audio_buffer.append で PCM16 24kHz を Base64 で送信 (T1: 公式仕様)
 * - session.output_audio.delta / session.output_transcript.delta を受信して呼び出し元に流す (T1)
 * - session.close で pending input audio をフラッシュ (T7: Translation API は commit イベントなし)
 * - 切断時の自動再接続（exponential backoff, 最大60秒）
 * - heartbeat（30秒ごとの ping）
 *
 * T1 対応: OpenAI Translation API 公式仕様のイベント名に移行
 *   - input_audio_buffer.append → session.input_audio_buffer.append
 *   - response.audio.delta → session.output_audio.delta
 *   - response.audio_transcript.delta → session.output_transcript.delta
 *   - input_audio_buffer.commit は Translation API に存在しない (session.close で代替)
 * T2 対応: session.update payload を audio.output.language のみに簡略化
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { z } from "zod";

import { type OutputLanguage } from "@trancall/shared-kernel";

import { type Logger } from "./logger.js";

// --- OpenAI Realtime Translation API メッセージスキーマ (T1: 公式仕様イベント名) ---

const SessionCreatedMessageSchema = z.object({
  type: z.literal("session.created"),
  session: z.object({ id: z.string() }).passthrough(),
});

const SessionUpdatedMessageSchema = z.object({
  type: z.literal("session.updated"),
});

const AudioDeltaMessageSchema = z.object({
  // T1: session.output_audio.delta (公式仕様)
  type: z.literal("session.output_audio.delta"),
  delta: z.string(),
  sample_rate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional(),
  elapsed_ms: z.number().int().nonnegative().optional(),
});

const TranscriptDeltaMessageSchema = z.object({
  // T1: session.output_transcript.delta (公式仕様)
  type: z.literal("session.output_transcript.delta"),
  delta: z.string(),
  elapsed_ms: z.number().int().nonnegative().optional(),
});

// session.input_transcript.delta は当面 log のみ
const InputTranscriptDeltaMessageSchema = z.object({
  type: z.literal("session.input_transcript.delta"),
  delta: z.string(),
});

const ErrorDetailSchema = z.object({
  type: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  error: ErrorDetailSchema,
});

const OpenAIMessageSchema = z.discriminatedUnion("type", [
  SessionCreatedMessageSchema,
  SessionUpdatedMessageSchema,
  AudioDeltaMessageSchema,
  TranscriptDeltaMessageSchema,
  InputTranscriptDeltaMessageSchema,
  ErrorMessageSchema,
]);

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
  sampleRate?: number;
  channels?: number;
  elapsedMs?: number;
}

export interface TranscriptDeltaEvent {
  text: string;
  isFinal: boolean;
  receivedAt: number;
  elapsedMs?: number;
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
 * translation-pipeline-design.md §4 (T1/T2/T7) 準拠。
 * - event 名を公式仕様 (session.* prefix) に移行
 * - session.update は audio.output.language のみ送信
 * - session.close で pending input audio をフラッシュ
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

      // 4000-4999 系は致命的エラー → 再接続しない (D1 §4.2)
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
   * T1: session.input_audio_buffer.append (公式仕様)
   *
   * @param pcm16Base64 PCM16 (little-endian, mono, 24kHz) を Base64 で
   */
  sendAudioFrame(pcm16Base64: string): void {
    if (!this.ws || this.state !== "open") {
      this.config.logger.debug("OpenAI WS: 未接続のためフレームをドロップ");
      return;
    }
    // T1: session.input_audio_buffer.append (公式仕様、旧 input_audio_buffer.append から修正)
    this.ws.send(
      JSON.stringify({
        type: "session.input_audio_buffer.append",
        audio: pcm16Base64,
      }),
    );
  }

  /**
   * T7: session.close を送信して pending input audio をフラッシュする。
   * Translation API には input_audio_buffer.commit は存在しない (D1 §4.1 §4.5)。
   * サーバが pending input audio をフラッシュして残りの翻訳出力を emit してから close する。
   */
  sendSessionClose(): void {
    if (!this.ws || this.state !== "open") {
      return;
    }
    this.config.logger.info("OpenAI WS: session.close 送信 (pending buffer フラッシュ)");
    this.ws.send(JSON.stringify({ type: "session.close" }));
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

  /**
   * T2: session.update payload を audio.output.language のみに簡略化。
   * 公式ガイドが明示するのは audio.output.language のみ (D1 §4.3)。
   */
  private sendSessionUpdate(): void {
    if (!this.ws) return;

    // T2: audio.output.language のみ送信 (旧実装の audio.input/output.format/sample_rate_hz は削除)
    this.ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            output: {
              language: this.config.outputLanguage,
            },
          },
        },
      }),
    );
  }

  private handleMessage(data: WebSocket.RawData): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch (e: unknown) {
      this.config.logger.warn("OpenAI WS: JSON parse 失敗", {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // type フィールドを事前チェックして未処理イベントのログを出す
    if (typeof raw !== "object" || raw === null || !("type" in raw)) {
      this.config.logger.warn("OpenAI WS: 想定外メッセージ形式");
      return;
    }

    const rawType = (raw as { type: unknown }).type;
    const now = Date.now();

    const parseResult = OpenAIMessageSchema.safeParse(raw);
    if (!parseResult.success) {
      // 既知の type が来た場合はフィールド不足ログ、未知の type は debug
      if (typeof rawType === "string") {
        this.config.logger.debug("OpenAI WS: 未処理イベント", { type: rawType });
      } else {
        this.config.logger.warn("OpenAI WS: メッセージ検証失敗", {
          issues: parseResult.error.issues.map((i) => i.message).join(", "),
        });
      }
      return;
    }

    const msg = parseResult.data;

    switch (msg.type) {
      case "session.created":
        this.config.logger.info("OpenAI WS: session.created", { sessionId: msg.session.id });
        break;
      case "session.updated":
        this.config.logger.debug("OpenAI WS: session.updated");
        break;
      // T1: session.output_audio.delta (公式仕様、旧 response.audio.delta から修正)
      case "session.output_audio.delta":
        this.emit("audio.delta", {
          audioBase64: msg.delta,
          receivedAt: now,
          sampleRate: msg.sample_rate,
          channels: msg.channels,
          elapsedMs: msg.elapsed_ms,
        });
        break;
      // T1: session.output_transcript.delta (公式仕様、旧 response.audio_transcript.delta から修正)
      case "session.output_transcript.delta":
        this.emit("transcript.delta", {
          text: msg.delta,
          isFinal: false,
          receivedAt: now,
          elapsedMs: msg.elapsed_ms,
        });
        break;
      case "session.input_transcript.delta":
        // 原文字幕 (TranCall では当面 log のみ、将来 transcript 連携)
        this.config.logger.debug("OpenAI WS: 原文字幕受信", { delta: msg.delta });
        break;
      case "error":
        // T9: error event → Error オブジェクト生成 (§10.1 準拠のマッピングは translation-session 側で処理)
        this.config.logger.error("OpenAI WS: error イベント受信", {
          type: msg.error.type,
          code: msg.error.code,
          message: msg.error.message,
        });
        this.emit("error", new Error(msg.error.message));
        break;
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
