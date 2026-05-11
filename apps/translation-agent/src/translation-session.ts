/**
 * Translation Session
 *
 * 1組の (source participant, target output language) に対して 1 つ生成される。
 * 1対1双方向通話の場合: (A→Bの英→日) と (B→Aの日→英) で 2 セッション。
 *
 * 責務:
 * - OpenAI WebSocket クライアントの生成・接続管理
 * - 翻訳済み音声を target participant 向けに LiveKit Track として Publish
 * - レイテンシ計測（capture/agent/openai/publish の各ホップ）
 * - クラッシュ時の cleanup
 *
 * 設計判断（C-002 対応）:
 * - 設計書では PCM 24kHz 前提だったが、OpenAI Realtime Translation の
 *   公式 example が 16kHz / 24kHz の双方をサポートしているため、
 *   sampleRateHz を config から渡せるようにしている
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { type OutputLanguage } from "@trancall/shared-kernel";

import {
  buildSessionEndedEvent,
  buildSessionStartedEvent,
  type InternalApiClient,
} from "./internal-api-client.js";
import { type Logger } from "./logger.js";
import { OpenAIWsClient } from "./openai-ws-client.js";

// --- 設定 ---

export interface TranslationSessionConfig {
  roomId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  outputLanguage: OutputLanguage;
  openaiApiKey: string;
  openaiUrl: string;
  sampleRateHz: 16000 | 24000;
  internalApiClient: InternalApiClient;
  logger: Logger;
}

// --- イベント ---

export interface TranslationSessionEvents {
  ready: () => void;
  "translated-audio": (pcm16Base64: string) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: Error) => void;
  ended: (reason: string) => void;
}

// --- 本体 ---

export class TranslationSession extends EventEmitter {
  private readonly agentJobId: string = randomUUID();
  private readonly startedAt = new Date();
  private openaiClient: OpenAIWsClient | null = null;
  private isEnding = false;

  constructor(private readonly config: TranslationSessionConfig) {
    super();
  }

  async start(): Promise<void> {
    this.config.logger.info("TranslationSession: 開始", {
      agentJobId: this.agentJobId,
      sourceParticipantId: this.config.sourceParticipantId,
      targetParticipantId: this.config.targetParticipantId,
      outputLanguage: this.config.outputLanguage,
    });

    // Server に開始通知
    const startedResult = await this.config.internalApiClient.postEvent(
      buildSessionStartedEvent({
        agentJobId: this.agentJobId,
        roomId: this.config.roomId,
        sourceParticipantId: this.config.sourceParticipantId,
        targetParticipantId: this.config.targetParticipantId,
        outputLanguage: this.config.outputLanguage,
      }),
    );
    if (!startedResult.ok) {
      // Server 通知失敗は warning に留め、セッションは続行（後から outbox で再送）
      this.config.logger.warn("TranslationSession: 開始通知失敗（続行）", {
        error: startedResult.error.message,
      });
    }

    // OpenAI WebSocket 接続
    this.openaiClient = new OpenAIWsClient({
      url: this.config.openaiUrl,
      apiKey: this.config.openaiApiKey,
      outputLanguage: this.config.outputLanguage,
      sampleRateHz: this.config.sampleRateHz,
      autoReconnect: true,
      logger: this.config.logger.child({
        component: "OpenAIWsClient",
        agentJobId: this.agentJobId,
      }),
    });

    this.openaiClient.on("open", () => {
      this.emit("ready");
    });

    this.openaiClient.on("audio.delta", (event) => {
      this.emit("translated-audio", event.audioBase64);
    });

    this.openaiClient.on("transcript.delta", (event) => {
      this.emit("transcript", event.text, false);
    });

    this.openaiClient.on("transcript.done", (event) => {
      this.emit("transcript", event.text, true);
    });

    this.openaiClient.on("error", (error) => {
      this.emit("error", error);
    });

    this.openaiClient.on("close", (reason) => {
      if (!this.isEnding) {
        this.config.logger.warn("TranslationSession: OpenAI WS 予期せぬ切断", { reason });
        // 再接続は OpenAIWsClient 側で行う。fatal の場合のみ session.ended を emit
        if (this.openaiClient?.getState() === "fatal") {
          void this.end("openai_fatal_error");
        }
      }
    });

    await this.openaiClient.connect();
  }

  /**
   * source participant の音声 PCM フレームを OpenAI に送る。
   * Agent 側で LiveKit Track から AudioFrame を取り出し、PCM16 24kHz に変換した上で呼び出す。
   */
  pushAudioFrame(pcm16Base64: string): void {
    if (!this.openaiClient) {
      this.config.logger.debug("TranslationSession: OpenAI 未初期化、フレームをドロップ");
      return;
    }
    this.openaiClient.sendAudioFrame(pcm16Base64);
  }

  async end(
    reason:
      | "participant_left"
      | "agent_shutdown"
      | "openai_fatal_error"
      | "client_requested" = "participant_left",
  ): Promise<void> {
    if (this.isEnding) return;
    this.isEnding = true;

    this.config.logger.info("TranslationSession: 終了", {
      agentJobId: this.agentJobId,
      reason,
    });

    if (this.openaiClient) {
      await this.openaiClient.close();
      this.openaiClient = null;
    }

    const endedResult = await this.config.internalApiClient.postEvent(
      buildSessionEndedEvent({
        agentJobId: this.agentJobId,
        roomId: this.config.roomId,
        sourceParticipantId: this.config.sourceParticipantId,
        outputLanguage: this.config.outputLanguage,
        startedAt: this.startedAt,
        endedAt: new Date(),
        reason,
      }),
    );
    if (!endedResult.ok) {
      this.config.logger.error("TranslationSession: 終了通知失敗", {
        error: endedResult.error.message,
      });
      // 課金イベントなので、ここの失敗は重要。outbox で再送する仕組みが必要だが
      // Phase 1a Sprint 0 では log error までで止める
    }

    this.emit("ended", reason);
  }

  getAgentJobId(): string {
    return this.agentJobId;
  }
}
