/**
 * @trancall/translation — Zod スキーマ定義
 *
 * Server 側で Agent イベントを受信・バリデーションし、永続化するためのスキーマ群。
 * Agent 側 (apps/translation-agent) と互換性を保ちつつ独立定義。
 * 互換性はテストで検証する。
 */

import { z } from "zod";

import {
  RoomIdSchema,
  ParticipantIdSchema,
  TranslationSessionIdSchema,
  OutputLanguage,
  DomainEventBase,
} from "@trancall/shared-kernel";

// =============================================================================
// LiveSubtitleDelta — data channel 受信時バリデーション
// =============================================================================

export const LiveSubtitleDeltaSchema = z.object({
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  /** グループ通話時のセッション識別用。1対1の場合は null でもよい */
  translationSessionId: TranslationSessionIdSchema.nullable(),
  speakerName: z.string().min(0),
  originalDelta: z.string(),
  translatedDelta: z.string(),
  language: z.string().min(1),
  isFinal: z.boolean(),
  /** Unix エポック ms。負値は不正 */
  timestamp: z.number().nonnegative(),
});

export type LiveSubtitleDelta = z.infer<typeof LiveSubtitleDeltaSchema>;

// =============================================================================
// Translation Session Record — translation_sessions テーブル永続化用
// =============================================================================

export const TranslationSessionRecordSchema = z.object({
  /** PK: translation_sessions.id */
  id: z.uuid(),
  /** LiveKit Job ID (Agent 側から受け取る) */
  agentJobId: z.uuid(),
  roomId: RoomIdSchema,
  sourceParticipantId: ParticipantIdSchema,
  targetParticipantId: ParticipantIdSchema,
  outputLanguage: OutputLanguage,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** セッション合計ミリ秒（endedAt - startedAt） */
  durationMs: z.number().int().nonnegative().nullable(),
  /** OpenAI 課金単位（秒）= ceil(durationMs / 1000） */
  billableSeconds: z.number().int().nonnegative().nullable(),
  /** 終了理由 */
  reason: z.enum([
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
  ]).nullable(),
  createdAt: z.iso.datetime(),
});

export type TranslationSessionRecord = z.infer<typeof TranslationSessionRecordSchema>;

// =============================================================================
// Agent Metrics Record — agent_metrics テーブル永続化用
// =============================================================================

const LatencyArraySchema = z.array(z.number().nonnegative());

export const AgentMetricsRecordSchema = z.object({
  id: z.uuid(),
  agentJobId: z.uuid(),
  roomId: RoomIdSchema,
  latencyMs: z.object({
    captureToAgent: LatencyArraySchema,
    agentToOpenAI: LatencyArraySchema,
    openAIFirstDelta: LatencyArraySchema,
    agentPublish: LatencyArraySchema,
    totalEndToEnd: LatencyArraySchema,
  }),
  memoryRssBytes: z.number().int().nonnegative(),
  collectedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type AgentMetricsRecord = z.infer<typeof AgentMetricsRecordSchema>;

// =============================================================================
// Agent Event Payload Schemas — /internal/agent/events ハンドラ用バリデーター
// =============================================================================

export const SessionStartedPayloadSchema = z.object({
  type: z.literal("translation.session_started"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sourceParticipantId: z.uuid(),
  targetParticipantId: z.uuid(),
  outputLanguage: z.string(),
  startedAt: z.iso.datetime(),
});
export type SessionStartedPayload = z.infer<typeof SessionStartedPayloadSchema>;

export const SessionEndedPayloadSchema = z.object({
  type: z.literal("translation.session_ended"),
  agentJobId: z.uuid(),
  roomId: z.uuid(),
  sourceParticipantId: z.uuid(),
  outputLanguage: z.string(),
  endedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  billableSeconds: z.number().int().nonnegative(),
  reason: z.enum([
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
  ]),
});
export type SessionEndedPayload = z.infer<typeof SessionEndedPayloadSchema>;

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
  latencyMs: z.object({
    captureToAgent: z.array(z.number().nonnegative()),
    agentToOpenAI: z.array(z.number().nonnegative()),
    openAIFirstDelta: z.array(z.number().nonnegative()),
    agentPublish: z.array(z.number().nonnegative()),
    totalEndToEnd: z.array(z.number().nonnegative()),
  }),
  memoryRssBytes: z.number().int().nonnegative(),
  collectedAt: z.iso.datetime(),
});
export type AgentMetricsPayload = z.infer<typeof AgentMetricsPayloadSchema>;

// =============================================================================
// Translation Degraded / Recovered Payload Schemas
// Agent → Server POST /internal/agent/events 用 (module-contracts.md §3.3 準拠)
// =============================================================================

export const TranslationDegradedPayloadSchema = z.object({
  type: z.literal("translation.degraded"),
  agentJobId: z.string(),
  roomId: z.string(),
  sessionId: z.string(),
  sourceLang: OutputLanguage,
  targetLang: OutputLanguage,
  reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
  occurredAt: z.iso.datetime(),
});
export type TranslationDegradedPayload = z.infer<typeof TranslationDegradedPayloadSchema>;

export const TranslationRecoveredPayloadSchema = z.object({
  type: z.literal("translation.recovered"),
  agentJobId: z.string(),
  roomId: z.string(),
  sessionId: z.string(),
  sourceLang: OutputLanguage,
  targetLang: OutputLanguage,
  degradedDurationMs: z.number().int().min(0),
  occurredAt: z.iso.datetime(),
});
export type TranslationRecoveredPayload = z.infer<typeof TranslationRecoveredPayloadSchema>;

/**
 * Agent イベントの Union Schema。
 * discriminatedUnion で type フィールドで分岐。
 */
export const AgentEventSchema = z.discriminatedUnion("type", [
  SessionStartedPayloadSchema,
  SessionEndedPayloadSchema,
  TranscriptDeltaPayloadSchema,
  AgentMetricsPayloadSchema,
  TranslationDegradedPayloadSchema,
  TranslationRecoveredPayloadSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// =============================================================================
// EventBus DomainEvent Schemas (in-process pub/sub)
// module-contracts.md §3.3 canonical
// =============================================================================

export const TranslationDegradedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.degraded"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    agentJobId: z.uuid(),
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
    timestamp: z.iso.datetime(),
    latencyP95Ms: z.number().int().nonnegative().nullable(),
    consecutiveSilenceMs: z.number().int().nonnegative().nullable(),
  }),
});
export type TranslationDegradedEvent = z.infer<typeof TranslationDegradedEventSchema>;

export const TranslationRecoveredEventSchema = DomainEventBase.extend({
  type: z.literal("translation.recovered"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    agentJobId: z.uuid(),
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    degradedDurationMs: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  }),
});
export type TranslationRecoveredEvent = z.infer<typeof TranslationRecoveredEventSchema>;

// =============================================================================
// LiveKit Data Channel Payload Schema (UI 配信用)
// Agent → mobile 直接配信 (module-contracts.md §3.4 canonical)
// =============================================================================

export const TranslationStatusChannelPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subtitle.delta"),
    sessionId: TranslationSessionIdSchema,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    text: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    isFinal: z.boolean(),
    timestamp: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("translation.degraded"),
    sessionId: TranslationSessionIdSchema,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
    timestamp: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("translation.recovered"),
    sessionId: TranslationSessionIdSchema,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    degradedDurationMs: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  }),
]);
export type TranslationStatusChannelPayload = z.infer<typeof TranslationStatusChannelPayloadSchema>;

// =============================================================================
// Translation Usage — billing 連携用集計
// =============================================================================

export const TranslationUsageSchema = z.object({
  sessionId: z.uuid(),
  roomId: RoomIdSchema,
  sourceParticipantId: ParticipantIdSchema,
  outputLanguage: OutputLanguage,
  durationMs: z.number().int().nonnegative(),
  /** OpenAI 課金単位（秒）= ceil(durationMs / 1000） */
  billableSeconds: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  reason: z.enum([
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
  ]),
});
export type TranslationUsage = z.infer<typeof TranslationUsageSchema>;
