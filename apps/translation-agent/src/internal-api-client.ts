/**
 * TranCall Server ⇔ Translation Agent 内部 API クライアント
 *
 * 設計書 docs/security-detail.md の "Agent 内部 API" 節を参照。
 *
 * 役割:
 * - Agent → Server: 翻訳セッション開始/終了通知、トランスクリプト永続化、メトリクス送信
 * - HMAC-SHA256 で署名（共有鍵 TRANCALL_AGENT_HMAC_SECRET）
 * - Idempotency-Key を付与（再送時の二重実行防止）
 * - リトライは exponential backoff、最大3回
 *
 * 設計判断:
 * - Server → Agent 向け（dispatch 系）は LiveKit Job Assignment 機構に乗せるため、
 *   Agent 側からは「outbox 投函」しかしない（Pull は LiveKit Worker が担当）
 * - 翻訳音声本体は LiveKit Room を通るため、ここでは送らない
 */

import { createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  type Result,
  type OutputLanguage,
} from "@trancall/shared-kernel";

import { type Logger } from "./logger.js";

// --- リクエスト/レスポンススキーマ ---

export const TranslationSessionStartedSchema = z.object({
  type: z.literal("translation.session_started"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sourceParticipantId: z.uuid(),
  targetParticipantId: z.uuid(),
  outputLanguage: z.string(),
  startedAt: z.iso.datetime(),
});
export type TranslationSessionStartedEvent = z.infer<typeof TranslationSessionStartedSchema>;

export const TranslationSessionEndedSchema = z.object({
  type: z.literal("translation.session_ended"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sourceParticipantId: z.uuid(),
  outputLanguage: z.string(),
  endedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  /** OpenAI 課金単位（秒）。billing モジュールが Stripe/IAP に転送する */
  billableSeconds: z.number().int().nonnegative(),
  // T8: agent_publish_failed を v1.1.0 で追加 (module-contracts.md §7.4.2 に同期)
  reason: z.enum([
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
    "agent_publish_failed",
  ]),
});
export type TranslationSessionEndedEvent = z.infer<typeof TranslationSessionEndedSchema>;

export const TranscriptDeltaPayloadSchema = z.object({
  type: z.literal("transcript.delta"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sourceParticipantId: z.uuid(),
  outputLanguage: z.string(),
  sequenceNo: z.number().int().nonnegative(),
  text: z.string(),
  isFinal: z.boolean(),
  spokenAt: z.iso.datetime(),
});
export type TranscriptDeltaPayload = z.infer<typeof TranscriptDeltaPayloadSchema>;

export const AgentMetricsPayloadSchema = z.object({
  type: z.literal("agent.metrics"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  /** ホップ別レイテンシ（ms）、p50/p95/p99 を後で計算するため raw 値を送る */
  latencyMs: z.object({
    captureToAgent: z.array(z.number()),
    agentToOpenAI: z.array(z.number()),
    openAIFirstDelta: z.array(z.number()),
    agentPublish: z.array(z.number()),
    totalEndToEnd: z.array(z.number()),
  }),
  memoryRssBytes: z.number().int().nonnegative(),
  collectedAt: z.iso.datetime(),
});
export type AgentMetricsPayload = z.infer<typeof AgentMetricsPayloadSchema>;

/**
 * T-14: translation.degraded — module-contracts.md §7.4 / §3.3
 * degraded 判定時に Internal API 経由で Server に POST し EventBus に publish。
 */
export const TranslationDegradedPayloadSchema = z.object({
  type: z.literal("translation.degraded"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sessionId: z.uuid(),
  sourceLang: z.string(),
  targetLang: z.string(),
  reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
  occurredAt: z.iso.datetime(),
});
export type TranslationDegradedPayload = z.infer<typeof TranslationDegradedPayloadSchema>;

/**
 * T-14: translation.recovered — module-contracts.md §7.4 / §3.3
 * recovered 判定時に Internal API 経由で Server に POST し EventBus に publish。
 */
export const TranslationRecoveredPayloadSchema = z.object({
  type: z.literal("translation.recovered"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sessionId: z.uuid(),
  sourceLang: z.string(),
  targetLang: z.string(),
  degradedDurationMs: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
});
export type TranslationRecoveredPayload = z.infer<typeof TranslationRecoveredPayloadSchema>;

export type AgentEvent =
  | TranslationSessionStartedEvent
  | TranslationSessionEndedEvent
  | TranscriptDeltaPayload
  | AgentMetricsPayload
  | TranslationDegradedPayload
  | TranslationRecoveredPayload;

// --- クライアント本体 ---

export interface InternalApiClientConfig {
  serverUrl: string;
  hmacSecret: string;
  agentName: string;
  /** リトライ最大回数（テスト時は 0） */
  maxRetries: number;
  logger: Logger;
  /** テスト用 fetch 差し替え */
  fetchImpl?: typeof fetch;
}

export interface PostError {
  code: "network" | "server_4xx" | "server_5xx" | "invalid_response" | "timeout";
  message: string;
  httpStatus?: number;
}

export class InternalApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: InternalApiClientConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * イベントを Server に送信する。
   * Idempotency-Key を付与し、retryable な失敗は exponential backoff で再送する。
   */
  async postEvent(event: AgentEvent): Promise<Result<void, PostError>> {
    const idempotencyKey = randomUUID();
    const body = JSON.stringify(event);
    const signature = this.sign(body, idempotencyKey);

    let lastError: PostError = {
      code: "network",
      message: "未実行",
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const result = await this.doPost(body, signature, idempotencyKey);
      if (result.ok) {
        return { ok: true, data: undefined };
      }
      lastError = result.error;

      // 4xx はリトライしない（idempotency 違反 / バリデーションエラー）
      if (result.error.code === "server_4xx") {
        return result;
      }

      if (attempt < this.config.maxRetries) {
        const delayMs = Math.min(10000, 500 * 2 ** attempt);
        this.config.logger.warn("内部API: リトライ", {
          attempt: attempt + 1,
          delayMs,
          error: result.error.message,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return { ok: false, error: lastError };
  }

  private async doPost(
    body: string,
    signature: string,
    idempotencyKey: string,
  ): Promise<Result<void, PostError>> {
    try {
      const response = await this.fetchImpl(`${this.config.serverUrl}/internal/agent/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trancall-agent": this.config.agentName,
          "x-trancall-signature": signature,
          "x-trancall-idempotency-key": idempotencyKey,
        },
        body,
      });

      if (response.ok) {
        return { ok: true, data: undefined };
      }

      const text = await response.text();
      if (response.status >= 400 && response.status < 500) {
        return {
          ok: false,
          error: {
            code: "server_4xx",
            message: `Server 4xx: ${text}`,
            httpStatus: response.status,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "server_5xx",
          message: `Server 5xx: ${text}`,
          httpStatus: response.status,
        },
      };
    } catch (e: unknown) {
      return {
        ok: false,
        error: {
          code: "network",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  /**
   * HMAC-SHA256 で `body || idempotencyKey` に署名する。
   * Server 側で同じ計算をして検証する。
   */
  private sign(body: string, idempotencyKey: string): string {
    return createHmac("sha256", this.config.hmacSecret)
      .update(`${body}|${idempotencyKey}`)
      .digest("hex");
  }
}

// --- ヘルパー: ペイロード生成 ---

export function buildSessionStartedEvent(args: {
  agentJobId: string;
  roomId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  outputLanguage: OutputLanguage;
}): TranslationSessionStartedEvent {
  return {
    type: "translation.session_started",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sourceParticipantId: args.sourceParticipantId,
    targetParticipantId: args.targetParticipantId,
    outputLanguage: args.outputLanguage,
    startedAt: new Date().toISOString(),
  };
}

export function buildSessionEndedEvent(args: {
  agentJobId: string;
  roomId: string;
  sourceParticipantId: string;
  outputLanguage: OutputLanguage;
  startedAt: Date;
  endedAt: Date;
  reason: TranslationSessionEndedEvent["reason"];
}): TranslationSessionEndedEvent {
  const durationMs = args.endedAt.getTime() - args.startedAt.getTime();
  return {
    type: "translation.session_ended",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sourceParticipantId: args.sourceParticipantId,
    outputLanguage: args.outputLanguage,
    endedAt: args.endedAt.toISOString(),
    durationMs,
    billableSeconds: Math.ceil(durationMs / 1000),
    reason: args.reason,
  };
}

export function buildTranscriptDeltaEvent(args: {
  agentJobId: string;
  roomId: string;
  sourceParticipantId: string;
  outputLanguage: OutputLanguage;
  sequenceNo: number;
  text: string;
  isFinal: boolean;
  spokenAt: Date;
}): TranscriptDeltaPayload {
  return {
    type: "transcript.delta",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sourceParticipantId: args.sourceParticipantId,
    outputLanguage: args.outputLanguage,
    sequenceNo: args.sequenceNo,
    text: args.text,
    isFinal: args.isFinal,
    spokenAt: args.spokenAt.toISOString(),
  };
}

export function buildAgentMetricsEvent(args: {
  agentJobId: string;
  roomId: string;
  latencyMs: AgentMetricsPayload["latencyMs"];
  memoryRssBytes: number;
  collectedAt: Date;
}): AgentMetricsPayload {
  return {
    type: "agent.metrics",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    latencyMs: args.latencyMs,
    memoryRssBytes: args.memoryRssBytes,
    collectedAt: args.collectedAt.toISOString(),
  };
}

/** T-14: degraded イベントのペイロードを生成する */
export function buildDegradedEvent(args: {
  agentJobId: string;
  roomId: string;
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  reason: TranslationDegradedPayload["reason"];
  occurredAt: Date;
}): TranslationDegradedPayload {
  return {
    type: "translation.degraded",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sessionId: args.sessionId,
    sourceLang: args.sourceLang,
    targetLang: args.targetLang,
    reason: args.reason,
    occurredAt: args.occurredAt.toISOString(),
  };
}

/** T-14: recovered イベントのペイロードを生成する */
export function buildRecoveredEvent(args: {
  agentJobId: string;
  roomId: string;
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  degradedDurationMs: number;
  occurredAt: Date;
}): TranslationRecoveredPayload {
  return {
    type: "translation.recovered",
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sessionId: args.sessionId,
    sourceLang: args.sourceLang,
    targetLang: args.targetLang,
    degradedDurationMs: args.degradedDurationMs,
    occurredAt: args.occurredAt.toISOString(),
  };
}
