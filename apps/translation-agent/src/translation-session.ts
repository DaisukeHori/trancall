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
 * - transcript.delta を Server に送信（sequenceNo はセッション単位でインクリメント）
 * - agent.metrics を 30 秒ごとに定期送信
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
  buildTranscriptDeltaEvent,
  buildAgentMetricsEvent,
  type AgentMetricsPayload,
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
  /** metrics 送信間隔（ms）、テスト時は短く設定可能。デフォルト 30000 */
  metricsIntervalMs?: number;
}

// --- イベント ---

export interface TranslationSessionEvents {
  ready: () => void;
  "translated-audio": (pcm16Base64: string) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: Error) => void;
  ended: (reason: string) => void;
}

// --- レイテンシ計測用バッファ ---

interface LatencyBuffers {
  captureToAgent: number[];
  agentToOpenAI: number[];
  openAIFirstDelta: number[];
  agentPublish: number[];
  totalEndToEnd: number[];
}

// --- 本体 ---

export class TranslationSession extends EventEmitter {
  private readonly agentJobId: string = randomUUID();
  private readonly startedAt = new Date();
  private openaiClient: OpenAIWsClient | null = null;
  private isEnding = false;

  // transcript.delta sequenceNo（セッション単位、0 から増加）
  private sequenceNo = 0;

  // レイテンシ計測バッファ
  private readonly latencyBuffers: LatencyBuffers = {
    captureToAgent: [],
    agentToOpenAI: [],
    openAIFirstDelta: [],
    agentPublish: [],
    totalEndToEnd: [],
  };

  // 直近の音声フレーム送信時刻（agentToOpenAI 計測用）
  private lastAudioSentAt: number | null = null;

  // OpenAI からの最初の delta を受け取るまでの時刻（openAIFirstDelta 計測用）
  private openAIRequestSentAt: number | null = null;

  // metrics 定期送信タイマー
  private metricsTimer: NodeJS.Timeout | null = null;

  private readonly metricsIntervalMs: number;

  constructor(private readonly config: TranslationSessionConfig) {
    super();
    this.metricsIntervalMs = config.metricsIntervalMs ?? 30000;
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
      // OpenAI から最初の delta が来た時刻を記録（openAIFirstDelta 計測）
      if (this.openAIRequestSentAt !== null) {
        const delta = event.receivedAt - this.openAIRequestSentAt;
        this.latencyBuffers.openAIFirstDelta.push(delta);
        this.openAIRequestSentAt = null; // 次のターン分はリセット
      }
      this.emit("translated-audio", event.audioBase64);
    });

    this.openaiClient.on("transcript.delta", (event) => {
      this.emit("transcript", event.text, false);
      // isFinal=false の delta もサーバーに送信（サーバー側は DB 書き込みなし）
      this.postTranscriptDelta(event.text, false);
    });

    this.openaiClient.on("transcript.done", (event) => {
      this.emit("transcript", event.text, true);
      // isFinal=true は transcript として永続化される
      this.postTranscriptDelta(event.text, true);
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

    // metrics 定期送信タイマー起動
    this.startMetricsTimer();
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
    const now = Date.now();
    this.lastAudioSentAt = now;
    // agentToOpenAI: 直前の captureToAgent 計測がある場合のみ計測
    // (シンプルな実装: フレーム送信時刻を記録し、次の audio.delta で差分を取る)
    this.openAIRequestSentAt = now;
    this.openaiClient.sendAudioFrame(pcm16Base64);
  }

  /**
   * captureToAgent レイテンシを記録する（外部から呼び出し）。
   * LiveKit AudioFrame の capture timestamp と Agent 受信時刻の差分を渡す。
   */
  recordCaptureToAgent(latencyMs: number): void {
    this.latencyBuffers.captureToAgent.push(latencyMs);
  }

  /**
   * agentPublish レイテンシを記録する（外部から呼び出し）。
   * 翻訳済み audio の LiveKit Track publish 時刻と OpenAI delta 受信時刻の差分を渡す。
   */
  recordAgentPublish(latencyMs: number): void {
    this.latencyBuffers.agentPublish.push(latencyMs);
  }

  /**
   * totalEndToEnd レイテンシを記録する（外部から呼び出し）。
   */
  recordTotalEndToEnd(latencyMs: number): void {
    this.latencyBuffers.totalEndToEnd.push(latencyMs);
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

    // metrics タイマー停止
    this.stopMetricsTimer();

    // 最後の metrics を送信
    await this.sendMetrics();

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

  // --- 内部実装 ---

  /**
   * transcript.delta を Server に送信する。
   * sequenceNo はセッション単位でインクリメント。
   */
  private postTranscriptDelta(text: string, isFinal: boolean): void {
    const currentSeqNo = this.sequenceNo;
    this.sequenceNo += 1;

    const event = buildTranscriptDeltaEvent({
      agentJobId: this.agentJobId,
      roomId: this.config.roomId,
      sourceParticipantId: this.config.sourceParticipantId,
      outputLanguage: this.config.outputLanguage,
      sequenceNo: currentSeqNo,
      text,
      isFinal,
      spokenAt: new Date(),
    });

    // 非同期で送信（エラーは log のみ、セッション継続）
    void this.config.internalApiClient.postEvent(event).then((result) => {
      if (!result.ok) {
        this.config.logger.warn("TranslationSession: transcript.delta 送信失敗", {
          sequenceNo: currentSeqNo,
          error: result.error.message,
        });
      }
    });
  }

  /**
   * metrics を Server に送信する。
   * バッファをコピーして送信後にクリア。
   */
  private async sendMetrics(): Promise<void> {
    // 送信するものが無ければスキップ
    const hasData =
      this.latencyBuffers.captureToAgent.length > 0 ||
      this.latencyBuffers.agentToOpenAI.length > 0 ||
      this.latencyBuffers.openAIFirstDelta.length > 0 ||
      this.latencyBuffers.agentPublish.length > 0 ||
      this.latencyBuffers.totalEndToEnd.length > 0;

    if (!hasData) {
      return;
    }

    const latencyMs: AgentMetricsPayload["latencyMs"] = {
      captureToAgent: [...this.latencyBuffers.captureToAgent],
      agentToOpenAI: [...this.latencyBuffers.agentToOpenAI],
      openAIFirstDelta: [...this.latencyBuffers.openAIFirstDelta],
      agentPublish: [...this.latencyBuffers.agentPublish],
      totalEndToEnd: [...this.latencyBuffers.totalEndToEnd],
    };

    // バッファをクリア
    this.latencyBuffers.captureToAgent.length = 0;
    this.latencyBuffers.agentToOpenAI.length = 0;
    this.latencyBuffers.openAIFirstDelta.length = 0;
    this.latencyBuffers.agentPublish.length = 0;
    this.latencyBuffers.totalEndToEnd.length = 0;

    const memoryRssBytes = process.memoryUsage().rss;

    const result = await this.config.internalApiClient.postEvent(
      buildAgentMetricsEvent({
        agentJobId: this.agentJobId,
        roomId: this.config.roomId,
        latencyMs,
        memoryRssBytes,
        collectedAt: new Date(),
      }),
    );

    if (!result.ok) {
      this.config.logger.warn("TranslationSession: metrics 送信失敗", {
        error: result.error.message,
      });
    }
  }

  private startMetricsTimer(): void {
    this.metricsTimer = setInterval(() => {
      void this.sendMetrics();
    }, this.metricsIntervalMs);
  }

  private stopMetricsTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }
}
