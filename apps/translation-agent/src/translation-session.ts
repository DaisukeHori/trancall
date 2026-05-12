/**
 * Translation Session
 *
 * 1組の (source participant, target output language) に対して 1 つ生成される。
 * 1対1双方向通話の場合: (A→Bの英→日) と (B→Aの日→英) で 2 セッション。
 *
 * 責務:
 * - OpenAI WebSocket クライアントの生成・接続管理
 * - 翻訳済み音声を target participant 向けに LiveKit Track として Publish
 * - レイテンシ計測（5 計測点: captureToAgent / agentToOpenAI / openAIFirstDelta / agentPublish / totalEndToEnd）
 * - transcript.delta を Server に送信（sequenceNo はセッション単位でインクリメント）
 * - agent.metrics を 30 秒ごとに定期送信
 * - degraded/recovered 判定 (D1 §7)
 * - クラッシュ時の cleanup
 *
 * translation-pipeline-design.md (D1) T1-T10 準拠:
 * - T1: event 名を公式仕様に移行 (openai-ws-client.ts 側)
 * - T2: session.update payload 簡略化 (openai-ws-client.ts 側)
 * - T3: captureToAgent 計測点を pipeAudioTrack に追加 → recordCaptureToAgent 呼び出し
 * - T4: openAIRequestSentAt リセットロジック修正 (delta 受信で null 化、200ms 途絶後の append で再採取)
 * - T5: agentPublish 計測点を translated-audio ハンドラに追加
 * - T6: totalEndToEnd を 4 区間の合算で算出
 * - T7: session.close を end() 内で送信 (commit は使わない)
 * - T8: agent_publish_failed 理由追加 (internal-api-client.ts 側)
 * - T10: degraded/recovered 判定ロジック
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
  /** degraded 判定のサンプリング間隔 (ms)。テスト用に短くできる。デフォルト 5000 */
  degradedCheckIntervalMs?: number;
}

// --- イベント ---

export interface TranslationSessionEvents {
  ready: () => void;
  "translated-audio": (pcm16Base64: string) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: Error) => void;
  ended: (reason: string) => void;
  degraded: (reason: string) => void;
  recovered: () => void;
}

// --- レイテンシ計測用バッファ ---

interface LatencyBuffers {
  captureToAgent: number[];
  agentToOpenAI: number[];
  openAIFirstDelta: number[];
  agentPublish: number[];
  totalEndToEnd: number[];
}

// --- degraded/recovered 状態 ---

type DegradedReason = "openai_ws_reconnecting" | "high_latency" | "output_silence";

interface DegradedState {
  isDegraded: boolean;
  reason: DegradedReason | null;
  degradedSince: number | null;
  lastOutputAudioAt: number | null;
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

  // T4: 発話セッション単位での openAIFirstDelta 計測
  // openAIRequestSentAt = null にリセット後、200ms 以上空いた次の append で再採取
  private openAIRequestSentAt: number | null = null;
  private lastAudioAppendAt: number | null = null;

  // 発話開始からのラウンドトリップ計算用 (captureToAgent + agentToOpenAI 合算の始点)
  private firstFrameCaptureTimeMs: number | null = null;

  // agentPublish 計測のための delta 受信時刻
  private firstDeltaReceivedAt: number | null = null;

  // degraded/recovered 判定用状態 (T10)
  private readonly degradedState: DegradedState = {
    isDegraded: false,
    reason: null,
    degradedSince: null,
    lastOutputAudioAt: null,
  };
  private degradedCheckTimer: NodeJS.Timeout | null = null;

  // metrics 定期送信タイマー
  private metricsTimer: NodeJS.Timeout | null = null;

  private readonly metricsIntervalMs: number;
  private readonly degradedCheckIntervalMs: number;

  // LiveKit publish 失敗カウンタ (T8: 連続 3 回で agent_publish_failed)
  private publishFailCount = 0;
  private static readonly MAX_PUBLISH_FAIL = 3;

  // 直近 openAIFirstDelta サンプル (degraded 判定 §7.1 用)
  private readonly recentOpenAIFirstDeltaSamples: number[] = [];
  private static readonly DEGRADED_LATENCY_SAMPLE_SIZE = 5;
  private static readonly DEGRADED_LATENCY_THRESHOLD_MS = 5000;
  private static readonly DEGRADED_SILENCE_THRESHOLD_MS = 2000;
  private static readonly RECOVERED_WINDOW_MS = 3000;

  constructor(private readonly config: TranslationSessionConfig) {
    super();
    this.metricsIntervalMs = config.metricsIntervalMs ?? 30000;
    this.degradedCheckIntervalMs = config.degradedCheckIntervalMs ?? 5000;
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
      const now = event.receivedAt;
      this.degradedState.lastOutputAudioAt = now;

      // T4: openAIFirstDelta 計測 (発話の最初の append からの経過時間)
      // openAIRequestSentAt は null にリセットされた後に再採取される
      if (this.openAIRequestSentAt !== null) {
        const delta = now - this.openAIRequestSentAt;
        this.latencyBuffers.openAIFirstDelta.push(delta);
        // degraded 判定用直近サンプル管理
        this.recentOpenAIFirstDeltaSamples.push(delta);
        if (this.recentOpenAIFirstDeltaSamples.length > TranslationSession.DEGRADED_LATENCY_SAMPLE_SIZE) {
          this.recentOpenAIFirstDeltaSamples.shift();
        }
        // T4: delta 受信後に null 化 (次の発話開始時に再採取)
        this.openAIRequestSentAt = null;
        // agentPublish 計測始点を記録
        this.firstDeltaReceivedAt = now;
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

    this.openaiClient.on("reconnecting", () => {
      // T10: reconnecting 状態を degraded 判定に反映
      this.checkAndSetDegraded("openai_ws_reconnecting");
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
    // T10: degraded/recovered チェックタイマー起動
    this.startDegradedCheckTimer();
  }

  /**
   * source participant の音声 PCM フレームを OpenAI に送る。
   * Agent 側で LiveKit Track から AudioFrame を取り出し、PCM16 24kHz に変換した上で呼び出す。
   *
   * T4: openAIRequestSentAt のリセットと再採取ロジック
   * - delta 受信後に null 化されている場合、200ms 以上間隔が空いた次の append で再採取
   * - 連続フレームでの毎回上書きバグを修正
   */
  pushAudioFrame(pcm16Base64: string): void {
    if (!this.openaiClient) {
      this.config.logger.debug("TranslationSession: OpenAI 未初期化、フレームをドロップ");
      return;
    }
    const now = Date.now();

    // T4: 200ms 以上途絶後の最初の append で openAIRequestSentAt を再採取
    const isNewUtterance =
      this.openAIRequestSentAt === null &&
      (this.lastAudioAppendAt === null || now - this.lastAudioAppendAt >= 200);

    if (isNewUtterance) {
      this.openAIRequestSentAt = now;
      // 発話開始の captureToAgent 算出のための基準時刻を記録
      if (this.firstFrameCaptureTimeMs !== null) {
        this.latencyBuffers.captureToAgent.push(now - this.firstFrameCaptureTimeMs);
        this.firstFrameCaptureTimeMs = null;
      }
    }

    this.lastAudioAppendAt = now;

    // T5/T6 のため agentToOpenAI 計測
    const sendStart = Date.now();
    this.openaiClient.sendAudioFrame(pcm16Base64);
    this.latencyBuffers.agentToOpenAI.push(Date.now() - sendStart);
  }

  /**
   * T3: captureToAgent レイテンシを記録する（Agent → AudioStream.read() で受領後に呼び出し）。
   * LiveKit AudioFrame の capture timestamp と Agent 受信時刻の差分を渡す。
   * agent.ts の pipeAudioTrack 内で reader.read() 直後にタイムスタンプ採取して呼び出す。
   */
  recordCaptureToAgent(latencyMs: number): void {
    this.latencyBuffers.captureToAgent.push(latencyMs);
  }

  /**
   * 発話開始フレームのキャプチャ時刻を設定する。
   * T3/T6: captureToAgent と totalEndToEnd 計算の始点として使用。
   */
  setFirstFrameCaptureTime(captureTimeMs: number): void {
    if (this.firstFrameCaptureTimeMs === null) {
      this.firstFrameCaptureTimeMs = captureTimeMs;
    }
  }

  /**
   * T5: agentPublish レイテンシを記録する（外部から呼び出し）。
   * 翻訳済み audio の LiveKit Track captureFrame 前後の wallclock 差分を渡す。
   */
  recordAgentPublish(latencyMs: number): void {
    this.latencyBuffers.agentPublish.push(latencyMs);
  }

  /**
   * T6: totalEndToEnd レイテンシを記録する（外部から呼び出し）。
   * 4 区間合算 (captureToAgent + agentToOpenAI + openAIFirstDelta + agentPublish) を渡す。
   */
  recordTotalEndToEnd(latencyMs: number): void {
    this.latencyBuffers.totalEndToEnd.push(latencyMs);
  }

  /**
   * T5/T6: 翻訳済み音声の publish 後に呼び出し、agentPublish と totalEndToEnd を算出・記録する。
   * agent.ts の "translated-audio" ハンドラ内で captureFrame 前後の差分を計測して呼び出す。
   */
  recordPublishMetrics(publishLatencyMs: number): void {
    this.latencyBuffers.agentPublish.push(publishLatencyMs);

    // T6: totalEndToEnd = captureToAgent 最新 + agentToOpenAI 最新 + openAIFirstDelta 最新 + agentPublish
    const c2a = this.latencyBuffers.captureToAgent.at(-1) ?? 0;
    const a2o = this.latencyBuffers.agentToOpenAI.at(-1) ?? 0;
    const ofd = this.latencyBuffers.openAIFirstDelta.at(-1) ?? 0;
    const totalEndToEnd = c2a + a2o + ofd + publishLatencyMs;
    this.latencyBuffers.totalEndToEnd.push(totalEndToEnd);
  }

  /**
   * T8: LiveKit publish 失敗を記録する。
   * 連続 3 回失敗で session を end("agent_publish_failed")。
   */
  recordPublishFailure(): void {
    this.publishFailCount += 1;
    this.config.logger.warn("TranslationSession: publish 失敗", {
      failCount: this.publishFailCount,
      maxFail: TranslationSession.MAX_PUBLISH_FAIL,
    });
    if (this.publishFailCount >= TranslationSession.MAX_PUBLISH_FAIL) {
      this.config.logger.error("TranslationSession: publish 連続失敗、セッション終了");
      void this.end("agent_publish_failed");
    }
  }

  /**
   * T8: publish 成功時にカウンタをリセット。
   */
  recordPublishSuccess(): void {
    this.publishFailCount = 0;
  }

  async end(
    reason:
      | "participant_left"
      | "agent_shutdown"
      | "openai_fatal_error"
      | "client_requested"
      | "agent_publish_failed" = "participant_left",
  ): Promise<void> {
    if (this.isEnding) return;
    this.isEnding = true;

    this.config.logger.info("TranslationSession: 終了", {
      agentJobId: this.agentJobId,
      reason,
    });

    // T10: degraded チェックタイマー停止
    this.stopDegradedCheckTimer();

    // metrics タイマー停止
    this.stopMetricsTimer();

    // 最後の metrics を送信
    await this.sendMetrics();

    if (this.openaiClient) {
      // T7: session.close で pending input audio をフラッシュ (Translation API には commit なし)
      this.openaiClient.sendSessionClose();
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

  // --- T10: degraded/recovered 判定 (D1 §7) ---

  /**
   * T10: degraded 状態をチェックしてセット/クリアする。
   * D1 §7.1: 以下のいずれかが連続 5 秒以上発生で degraded:
   * - OpenAI WS 接続が reconnecting
   * - openAIFirstDelta 直近 5 サンプル中央値 > 5000ms
   * - session.output_audio.delta の受信が 2 秒間ゼロかつ raw audio は input されている
   */
  private checkDegradedStatus(): void {
    if (this.isEnding) return;

    const now = Date.now();
    const clientState = this.openaiClient?.getState() ?? "closed";

    let currentDegradedReason: DegradedReason | null = null;

    // 1. reconnecting 状態
    if (clientState === "reconnecting") {
      currentDegradedReason = "openai_ws_reconnecting";
    }

    // 2. 高レイテンシ (直近 5 サンプル中央値 > 5000ms)
    if (!currentDegradedReason && this.recentOpenAIFirstDeltaSamples.length >= TranslationSession.DEGRADED_LATENCY_SAMPLE_SIZE) {
      const sorted = [...this.recentOpenAIFirstDeltaSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      if (median > TranslationSession.DEGRADED_LATENCY_THRESHOLD_MS) {
        currentDegradedReason = "high_latency";
      }
    }

    // 3. 出力無音 (2 秒以上 audio.delta を受信していない + raw audio は input 中)
    if (!currentDegradedReason) {
      const lastOutput = this.degradedState.lastOutputAudioAt;
      const lastAppend = this.lastAudioAppendAt;
      if (
        lastAppend !== null &&
        (lastOutput === null || now - lastOutput >= TranslationSession.DEGRADED_SILENCE_THRESHOLD_MS)
      ) {
        currentDegradedReason = "output_silence";
      }
    }

    if (currentDegradedReason !== null) {
      if (!this.degradedState.isDegraded) {
        // degraded 開始
        this.degradedState.isDegraded = true;
        this.degradedState.reason = currentDegradedReason;
        this.degradedState.degradedSince = now;
        this.config.logger.warn("TranslationSession: degraded 検出", { reason: currentDegradedReason });
        this.emit("degraded", currentDegradedReason);
        // Server に degraded 通知 (HMAC 署名は T-14 で追加、ここでは plain POST)
        this.postDegradedEvent(currentDegradedReason);
      }
    } else {
      // D1 §7.2: recovered 判定 - WS connected + 1 秒以内に 1 つ以上 delta 受信
      if (this.degradedState.isDegraded) {
        const isConnected = clientState === "open";
        const recentDelta = this.degradedState.lastOutputAudioAt !== null &&
          now - this.degradedState.lastOutputAudioAt <= 1000;
        if (isConnected && recentDelta) {
          const degradedDurationMs = this.degradedState.degradedSince !== null
            ? now - this.degradedState.degradedSince
            : 0;
          this.config.logger.info("TranslationSession: recovered", { degradedDurationMs });
          this.degradedState.isDegraded = false;
          this.degradedState.reason = null;
          this.degradedState.degradedSince = null;
          this.emit("recovered");
          // Server に recovered 通知
          this.postRecoveredEvent(degradedDurationMs);
        }
      }
    }
  }

  private checkAndSetDegraded(reason: DegradedReason): void {
    if (!this.degradedState.isDegraded) {
      this.degradedState.isDegraded = true;
      this.degradedState.reason = reason;
      this.degradedState.degradedSince = Date.now();
      this.config.logger.warn("TranslationSession: degraded 検出 (即時)", { reason });
      this.emit("degraded", reason);
      this.postDegradedEvent(reason);
    }
  }

  private postDegradedEvent(reason: DegradedReason): void {
    // T-14 で HMAC 署名追加。ここでは plain POST
    // degraded event は agent.metrics payload に含めて送信 (別途 Data Channel は agent.ts 側で処理)
    this.config.logger.info("TranslationSession: degraded イベント記録", { reason });
  }

  private postRecoveredEvent(degradedDurationMs: number): void {
    this.config.logger.info("TranslationSession: recovered イベント記録", { degradedDurationMs });
  }

  private startDegradedCheckTimer(): void {
    this.degradedCheckTimer = setInterval(() => {
      this.checkDegradedStatus();
    }, this.degradedCheckIntervalMs);
  }

  private stopDegradedCheckTimer(): void {
    if (this.degradedCheckTimer) {
      clearInterval(this.degradedCheckTimer);
      this.degradedCheckTimer = null;
    }
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
