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
  // M-9: insufficient_balance を追加 (heartbeat shouldContinue=false による翻訳停止、
  // packages/translation/src/schemas.ts の TranslationSessionEndedReasonSchema と同期)
  reason: z.enum([
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
    "agent_publish_failed",
    "insufficient_balance",
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

/**
 * Issue #69 (4): ハートビート — apps/server/src/routes/agent-routes.ts の
 * `POST /internal/translation/heartbeat` (`HeartbeatBodySchema`) と一致させる。
 * `type` フィールドを持たない (AgentEvent discriminated union とは別の独立した
 * エンドポイント宛のペイロードのため)。
 *
 * M-9: `roomId` を追加。Server 側が billing の残量算出のため
 * roomId → (userId, sessionId) の対応付け (RoomReservationSessionRepository) を
 * 引く必要があるため (docs/billing-detail.md「通話中: heartbeat」)。
 */
export const HeartbeatPayloadSchema = z.object({
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sessionId: z.uuid(),
  alive: z.literal(true),
  occurredAt: z.iso.datetime(),
  metrics: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      memMb: z.number().nonnegative().optional(),
      openaiWsState: z.string().optional(),
    })
    .optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

/**
 * M-9: heartbeat 応答スキーマ。
 * Server (`apps/server/src/routes/agent-routes.ts`) が billing facade 経由で算出した
 * 残量を返す。`shouldContinue=false` (残高不足) の場合、Agent は翻訳セッションを
 * `insufficient_balance` 理由で停止する (通話自体は継続、翻訳のみ停止)。
 */
export const HeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  shouldContinue: z.boolean(),
  remainingMinutes: z.number(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

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
   * レスポンスボディの中身は使わない (`z.unknown()` で受け流す) ため戻り値は void。
   */
  async postEvent(event: AgentEvent): Promise<Result<void, PostError>> {
    const result = await this.postJson("/internal/agent/events", event, z.unknown());
    if (!result.ok) return result;
    return { ok: true, data: undefined };
  }

  /**
   * Issue #69 (4) / M-9: ハートビートを Server に送信する。
   * `POST /internal/translation/heartbeat` (apps/server/src/routes/agent-routes.ts) 宛。
   * 認証方式 (HMAC-SHA256 署名 + idempotency-key + timestamp) は postEvent と同一。
   *
   * M-9: レスポンスボディ (`{ ok, shouldContinue, remainingMinutes }`) を
   * `HeartbeatResponseSchema` で検証して返す。呼び出し元 (TranslationSession) は
   * `shouldContinue=false` を受けて翻訳セッションを停止する。
   */
  async postHeartbeat(payload: HeartbeatPayload): Promise<Result<HeartbeatResponse, PostError>> {
    return this.postJson("/internal/translation/heartbeat", payload, HeartbeatResponseSchema);
  }

  /**
   * 共通送信ロジック (postEvent / postHeartbeat で共有)。
   * Idempotency-Key を付与し、retryable な失敗は exponential backoff で再送する。
   * `responseSchema` で 2xx レスポンスボディを検証し、成功時はそのデータを返す。
   */
  private async postJson<T>(
    path: string,
    payload: unknown,
    responseSchema: z.ZodType<T>,
  ): Promise<Result<T, PostError>> {
    const idempotencyKey = randomUUID();
    const body = JSON.stringify(payload);
    // 確定#4: timestamp は署名対象に含める (apps/server/src/middleware/hmac-middleware.ts
    // と canonical string を一致させる必要がある、両側は必ずペアで変更すること)。
    // リトライ全体で同一 timestamp を使い回す (許容ウィンドウ 5 分に対しリトライの
    // 最大遅延は数十秒程度のため、リトライごとに再生成する必要はない)。
    const timestamp = new Date().toISOString();
    const signature = this.sign(body, idempotencyKey, timestamp);

    let lastError: PostError = {
      code: "network",
      message: "未実行",
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const result = await this.doPost(path, body, signature, idempotencyKey, timestamp, responseSchema);
      if (result.ok) {
        return result;
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

  private async doPost<T>(
    path: string,
    body: string,
    signature: string,
    idempotencyKey: string,
    timestamp: string,
    responseSchema: z.ZodType<T>,
  ): Promise<Result<T, PostError>> {
    try {
      const response = await this.fetchImpl(`${this.config.serverUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trancall-agent": this.config.agentName,
          "x-trancall-signature": signature,
          "x-trancall-idempotency-key": idempotencyKey,
          "x-trancall-timestamp": timestamp,
        },
        body,
      });

      if (response.ok) {
        const text = await response.text();
        // レスポンスボディが JSON でない場合 (空文字・プレーンテキスト等) は
        // 空オブジェクトとして扱う。postEvent (`z.unknown()`) は本文を使わないため
        // これで問題なく成功扱いになる。postHeartbeat 等の厳密なスキーマを使う
        // 呼び出しでは、続く safeParse が必須フィールド欠如として弾く。
        let json: unknown = {};
        if (text.length > 0) {
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            json = {};
          }
        }
        const parsed = responseSchema.safeParse(json);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "invalid_response",
              message: `レスポンススキーマ検証に失敗しました: ${parsed.error.message}`,
              httpStatus: response.status,
            },
          };
        }
        return { ok: true, data: parsed.data };
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
   * HMAC-SHA256 で `body || idempotencyKey || timestamp` に署名する。
   * Server 側 (apps/server/src/middleware/hmac-middleware.ts) で同じ計算をして検証する。
   * 確定#4: timestamp を署名対象に含めることで、リプレイ防止用の timestamp
   * ヘッダー自体の改竄を防ぐ (署名を変えずに timestamp だけ「今」に書き換えて
   * 鮮度チェックを回避する攻撃を塞ぐ)。
   */
  private sign(body: string, idempotencyKey: string, timestamp: string): string {
    return createHmac("sha256", this.config.hmacSecret)
      .update(`${body}|${idempotencyKey}|${timestamp}`)
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

/** Issue #69 (4) / M-9: ハートビートのペイロードを生成する */
export function buildHeartbeatEvent(args: {
  agentJobId: string;
  roomId: string;
  sessionId: string;
  occurredAt: Date;
  metrics?: HeartbeatPayload["metrics"];
}): HeartbeatPayload {
  return {
    agentJobId: args.agentJobId,
    roomId: args.roomId,
    sessionId: args.sessionId,
    alive: true,
    occurredAt: args.occurredAt.toISOString(),
    ...(args.metrics ? { metrics: args.metrics } : {}),
  };
}
