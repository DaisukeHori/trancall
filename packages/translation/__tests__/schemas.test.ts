import { describe, it, expect } from "vitest";

import {
  TranslationDegradedPayloadSchema,
  TranslationRecoveredPayloadSchema,
  AgentEventSchema,
  TranslationDegradedEventSchema,
  TranslationRecoveredEventSchema,
  TranslationStatusChannelPayloadSchema,
  SessionEndedPayloadSchema,
  TranslationSessionEndedReasonSchema,
  TranslationSessionRecordSchema,
  TranslationUsageSchema,
} from "../src/schemas.js";

const agentJobId = "00000000-0000-4000-8000-000000000011";
const roomId = "00000000-0000-4000-8000-000000000012";
const sessionId = "00000000-0000-4000-8000-000000000015";
const occurredAt = "2026-05-12T00:00:00.000Z";

// =============================================================================
// #49: TranslationSessionEndedReasonSchema / SessionEndedPayloadSchema
//
// apps/translation-agent/src/internal-api-client.ts の TranslationSessionEndedSchema.reason
// (module-contracts.md §7.4.2) と 6 値で同期していることを検証する。
// この非同期により session_ended が 400 になり課金セッションが閉じない問題があった。
// M-9: insufficient_balance (heartbeat shouldContinue=false による翻訳停止) を追加。
// =============================================================================

describe("#49/M-9: TranslationSessionEndedReasonSchema (reason enum 6値)", () => {
  const validReasons = [
    "participant_left",
    "agent_shutdown",
    "openai_fatal_error",
    "client_requested",
    "agent_publish_failed",
    "insufficient_balance",
  ] as const;

  it.each(validReasons)("reason=%s を受理する", (reason) => {
    const result = TranslationSessionEndedReasonSchema.safeParse(reason);
    expect(result.success).toBe(true);
  });

  it("未知の reason はバリデーションエラー", () => {
    const result = TranslationSessionEndedReasonSchema.safeParse("unknown_reason");
    expect(result.success).toBe(false);
  });
});

describe("#49: SessionEndedPayloadSchema (Agent → Server /internal/agent/events)", () => {
  const basePayload = {
    type: "translation.session_ended" as const,
    agentJobId,
    roomId,
    sourceParticipantId: "00000000-0000-4000-8000-000000000013",
    outputLanguage: "en",
    endedAt: occurredAt,
    durationMs: 60000,
    billableSeconds: 60,
  };

  it("reason=agent_publish_failed でパース成功する (5値目、Agent 側と同期済み)", () => {
    const result = SessionEndedPayloadSchema.safeParse({
      ...basePayload,
      reason: "agent_publish_failed",
    });
    expect(result.success).toBe(true);
  });

  it("reason=insufficient_balance でパース成功する (M-9: 6値目、heartbeat 残高不足による翻訳停止)", () => {
    const result = SessionEndedPayloadSchema.safeParse({
      ...basePayload,
      reason: "insufficient_balance",
    });
    expect(result.success).toBe(true);
  });

  it("reason=participant_left など既存 4 値でも引き続きパース成功する", () => {
    const result = SessionEndedPayloadSchema.safeParse({
      ...basePayload,
      reason: "participant_left",
    });
    expect(result.success).toBe(true);
  });

  it("不正な reason ではパース失敗する", () => {
    const result = SessionEndedPayloadSchema.safeParse({
      ...basePayload,
      reason: "bad_reason",
    });
    expect(result.success).toBe(false);
  });
});

describe("#49: TranslationSessionRecordSchema / TranslationUsageSchema も reason=agent_publish_failed を受理する", () => {
  it("TranslationSessionRecordSchema", () => {
    const result = TranslationSessionRecordSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000021",
      agentJobId,
      roomId,
      sourceParticipantId: "00000000-0000-4000-8000-000000000013",
      targetParticipantId: "00000000-0000-4000-8000-000000000014",
      outputLanguage: "en",
      startedAt: occurredAt,
      endedAt: occurredAt,
      durationMs: 60000,
      billableSeconds: 60,
      reason: "agent_publish_failed",
      createdAt: occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("TranslationUsageSchema", () => {
    const result = TranslationUsageSchema.safeParse({
      sessionId: "00000000-0000-4000-8000-000000000021",
      roomId,
      sourceParticipantId: "00000000-0000-4000-8000-000000000013",
      outputLanguage: "en",
      durationMs: 60000,
      billableSeconds: 60,
      startedAt: occurredAt,
      endedAt: occurredAt,
      reason: "agent_publish_failed",
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// TranslationDegradedPayloadSchema
// =============================================================================

describe("TranslationDegradedPayloadSchema", () => {
  it("正常データでパース成功", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "openai_ws_reconnecting",
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("reason: high_latency でパース成功", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "high_latency",
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("reason: output_silence でパース成功", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "output_silence",
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("不正な reason でパース失敗", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "unknown_reason",
      occurredAt,
    });
    expect(result.success).toBe(false);
  });

  it("不正な sourceLang でパース失敗", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "zz",
      targetLang: "en",
      reason: "high_latency",
      occurredAt,
    });
    expect(result.success).toBe(false);
  });

  it("必須フィールド欠如でパース失敗", () => {
    const result = TranslationDegradedPayloadSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      // targetLang 欠如
      reason: "high_latency",
      occurredAt,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// TranslationRecoveredPayloadSchema
// =============================================================================

describe("TranslationRecoveredPayloadSchema", () => {
  it("正常データでパース成功", () => {
    const result = TranslationRecoveredPayloadSchema.safeParse({
      type: "translation.recovered",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 3000,
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("degradedDurationMs: 0 でパース成功", () => {
    const result = TranslationRecoveredPayloadSchema.safeParse({
      type: "translation.recovered",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 0,
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("負の degradedDurationMs でパース失敗", () => {
    const result = TranslationRecoveredPayloadSchema.safeParse({
      type: "translation.recovered",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: -1,
      occurredAt,
    });
    expect(result.success).toBe(false);
  });

  it("必須フィールド欠如でパース失敗", () => {
    const result = TranslationRecoveredPayloadSchema.safeParse({
      type: "translation.recovered",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      // degradedDurationMs 欠如
      occurredAt,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// AgentEventSchema — discriminatedUnion に degraded/recovered が含まれること
// =============================================================================

describe("AgentEventSchema (discriminatedUnion)", () => {
  it("translation.degraded がバリデーション通過", () => {
    const result = AgentEventSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "openai_ws_reconnecting",
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("translation.recovered がバリデーション通過", () => {
    const result = AgentEventSchema.safeParse({
      type: "translation.recovered",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 5000,
      occurredAt,
    });
    expect(result.success).toBe(true);
  });

  it("不正な reason で translation.degraded がバリデーション失敗", () => {
    const result = AgentEventSchema.safeParse({
      type: "translation.degraded",
      agentJobId,
      roomId,
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "bad_reason",
      occurredAt,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// TranslationDegradedEventSchema / TranslationRecoveredEventSchema (EventBus)
// =============================================================================

const eventId = "00000000-0000-4000-8000-000000000099";
const aggregateId = "00000000-0000-4000-8000-000000000015";
const timestamp = "2026-05-12T00:00:00.000Z";

describe("TranslationDegradedEventSchema (EventBus DomainEvent)", () => {
  it("正常データでパース成功", () => {
    const result = TranslationDegradedEventSchema.safeParse({
      eventId,
      occurredAt,
      aggregateId,
      type: "translation.degraded",
      payload: {
        sessionId,
        agentJobId,
        sourceLang: "ja",
        targetLang: "en",
        reason: "high_latency",
        timestamp,
        latencyP95Ms: 800,
        consecutiveSilenceMs: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("latencyP95Ms: null でパース成功", () => {
    const result = TranslationDegradedEventSchema.safeParse({
      eventId,
      occurredAt,
      aggregateId,
      type: "translation.degraded",
      payload: {
        sessionId,
        agentJobId,
        sourceLang: "ja",
        targetLang: "en",
        reason: "output_silence",
        timestamp,
        latencyP95Ms: null,
        consecutiveSilenceMs: 3000,
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("TranslationRecoveredEventSchema (EventBus DomainEvent)", () => {
  it("正常データでパース成功", () => {
    const result = TranslationRecoveredEventSchema.safeParse({
      eventId,
      occurredAt,
      aggregateId,
      type: "translation.recovered",
      payload: {
        sessionId,
        agentJobId,
        sourceLang: "ja",
        targetLang: "en",
        degradedDurationMs: 5000,
        timestamp,
      },
    });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// TranslationStatusChannelPayloadSchema (LiveKit Data Channel)
// =============================================================================

describe("TranslationStatusChannelPayloadSchema (Data Channel)", () => {
  it("translation.degraded variant でパース成功", () => {
    const result = TranslationStatusChannelPayloadSchema.safeParse({
      type: "translation.degraded",
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "openai_ws_reconnecting",
      timestamp,
    });
    expect(result.success).toBe(true);
  });

  it("translation.recovered variant でパース成功", () => {
    const result = TranslationStatusChannelPayloadSchema.safeParse({
      type: "translation.recovered",
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      degradedDurationMs: 2500,
      timestamp,
    });
    expect(result.success).toBe(true);
  });

  it("subtitle.delta variant でパース成功", () => {
    const result = TranslationStatusChannelPayloadSchema.safeParse({
      type: "subtitle.delta",
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      text: "Hello",
      elapsedMs: 500,
      isFinal: false,
      timestamp,
    });
    expect(result.success).toBe(true);
  });

  it("不明な type でパース失敗", () => {
    const result = TranslationStatusChannelPayloadSchema.safeParse({
      type: "unknown.type",
      sessionId,
      timestamp,
    });
    expect(result.success).toBe(false);
  });

  it("translation.degraded で不正な reason はパース失敗", () => {
    const result = TranslationStatusChannelPayloadSchema.safeParse({
      type: "translation.degraded",
      sessionId,
      sourceLang: "ja",
      targetLang: "en",
      reason: "bad_reason",
      timestamp,
    });
    expect(result.success).toBe(false);
  });
});
