/**
 * Agent 内部 API エンドポイント
 *
 * POST /internal/agent/events
 * POST /internal/translation/heartbeat
 *
 * docs/module-contracts.md Section 7 に従い HMAC 検証 + 冪等性チェックを行う。
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { TranslationFacade, SessionEndedPayload, TranscriptDeltaPayload } from "@trancall/translation";
import type { TranscriptFacade, TranscriptSegment } from "@trancall/transcript";
import {
  AgentEventSchema,
  TranslationDegradedPayloadSchema,
  TranslationRecoveredPayloadSchema,
  createTranslationEndedEvent,
} from "@trancall/translation";
import { calcRetentionUntilByPlan, type PlanTierKey } from "@trancall/transcript";
import type { AuthFacade } from "@trancall/auth";
import type { RoomFacade } from "@trancall/room";
import type { BillingFacade } from "@trancall/billing";
import {
  brandTranslationSessionId,
  brandRoomId,
  brandUserId,
  brandParticipantId,
} from "@trancall/shared-kernel";
import { z } from "zod";
import { createHmacPreHandler } from "../middleware/hmac-middleware.js";
import type { Config } from "../config.js";
import type { EventBus } from "../adapters/event-bus.js";
import { getHttpStatus } from "../middleware/error-handler.js";
import { logger } from "../logger.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNonceRepository } from "../adapters/repositories/agent/nonce-repository.supabase.js";

// ---------------------------------------------------------------------------
// Heartbeat body schema
// ---------------------------------------------------------------------------

const HeartbeatBodySchema = z.object({
  agentJobId: z.uuid(),
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

type HeartbeatBody = z.infer<typeof HeartbeatBodySchema>;

// ---------------------------------------------------------------------------
// #48: transcript.delta (isFinal=true) → transcript.appendFinalSegment
// ---------------------------------------------------------------------------

/**
 * #48: transcript.delta の payload には speakerName / originalText / languagePair /
 * startTimeMs / retentionUntil が含まれない (module-contracts.md §7.4.3 契約)。
 * これらを以下から補完して TranscriptSegment を組み立てる:
 *
 * - speakerName: `auth.getProfile(sourceParticipantId)` の displayName (未設定なら trancallId)。
 *   sourceParticipantId は LiveKit の participant identity と同一の UUID であり、
 *   apps/translation-agent/src/agent.ts の `resolveParticipantId()` が
 *   `profile.userId` (LiveKit AccessToken 発行時に設定、apps/server/adapters/livekit-adapter.ts
 *   → packages/media/src/adapters/livekit.ts) をそのまま identity として使っているため、
 *   sourceParticipantId をそのまま UserId として auth.getProfile に渡せる。
 * - languagePair: `${話者のnativeLanguage}-${outputLanguage}` (docs/notification-detail.md の
 *   "en-ja" 形式に合わせる)。話者の言語プロフィールが取れない場合は "unknown" にフォールバックする。
 * - originalText: このイベントの `text` は OpenAI `response.audio_transcript.delta`
 *   (= 翻訳後/出力言語側のテキスト、docs/translation-pipeline-design.md §2.4 表) に由来し、
 *   原文 (`session.input_transcript.delta`) は現状 Agent → Server に送られていない
 *   (同ドキュメント L166 「TranCall では使わない」)。そのため `translatedText` に
 *   `event.text` を入れ、`originalText` は空文字とする。Agent 側が原文 delta も送るように
 *   なったら、ここを更新して原文を埋める (Agent 側改修は本 PR スコープ外)。
 * - startTimeMs / endTimeMs: `room.getState(roomId).createdAt` を通話開始時刻とし、
 *   `spokenAt` からの経過 ms を startTimeMs とする。delta には区間長 (duration) がなく
 *   単一時点の情報のため、endTimeMs は startTimeMs と同値にする
 *   (Agent 側が区間長を送るようになれば正確な値に置き換えられる)。
 * - retentionUntil: 話者 (sourceParticipantId) の課金プラン
 *   (`billing.getSubscription(...).plan.tier`) から `calcRetentionUntilByPlan` で算出する。
 *   プラン取得に失敗した場合は最も短い "free" (7日) にフォールバックする (安全側)。
 *
 * いずれの補完ステップも facade 呼び出しが失敗した場合は該当箇所をフォールバック値で
 * 埋めて処理を継続する (best-effort)。room が存在しない等、致命的に文脈が欠ける場合のみ
 * 永続化自体をスキップする。
 */
async function persistFinalTranscriptSegment(
  event: TranscriptDeltaPayload,
  idempotencyKey: string,
  deps: {
    auth: AuthFacade;
    room: RoomFacade;
    billing: BillingFacade;
    transcript: TranscriptFacade;
  },
): Promise<void> {
  const { auth, room, billing, transcript } = deps;

  const roomIdResult = brandRoomId(event.roomId);
  const participantIdResult = brandParticipantId(event.sourceParticipantId);
  const speakerUserIdResult = brandUserId(event.sourceParticipantId);
  if (!roomIdResult.success || !participantIdResult.success || !speakerUserIdResult.success) {
    logger.warn("transcript segment persist skipped: invalid roomId/sourceParticipantId", {
      roomId: event.roomId,
      sourceParticipantId: event.sourceParticipantId,
    });
    return;
  }

  // startTimeMs/endTimeMs: room 開始時刻からの経過 ms。room が見つからない場合は
  // 文脈 (通話開始時刻) が失われるため、このセグメントの永続化自体を諦める。
  const roomStateResult = await room.getState(roomIdResult.data);
  if (!roomStateResult.ok) {
    logger.warn("transcript segment persist skipped: room.getState failed", {
      roomId: event.roomId,
      errorCode: roomStateResult.error.code,
    });
    return;
  }
  const roomCreatedAtMs = Date.parse(roomStateResult.data.createdAt);
  const spokenAtMs = Date.parse(event.spokenAt);
  const startTimeMs = Math.max(0, spokenAtMs - roomCreatedAtMs);

  // speakerName / languagePair 用の話者プロフィール (best-effort)
  let speakerName = "Unknown";
  let sourceLanguage = "unknown";
  const profileResult = await auth.getProfile(speakerUserIdResult.data);
  if (profileResult.ok) {
    speakerName = profileResult.data.displayName ?? profileResult.data.trancallId;
    sourceLanguage = profileResult.data.nativeLanguage;
  } else {
    logger.warn("transcript segment: auth.getProfile failed, using fallback speakerName", {
      sourceParticipantId: event.sourceParticipantId,
      errorCode: profileResult.error.code,
    });
  }

  // retentionUntil 用のプラン tier (best-effort、失敗時は free=7日にフォールバック)
  let planTier: PlanTierKey = "free";
  const subscriptionResult = await billing.getSubscription(speakerUserIdResult.data);
  if (subscriptionResult.ok) {
    planTier = subscriptionResult.data.plan.tier;
  } else {
    logger.warn("transcript segment: billing.getSubscription failed, defaulting to free-tier retention", {
      sourceParticipantId: event.sourceParticipantId,
      errorCode: subscriptionResult.error.code,
    });
  }
  const retentionResult = calcRetentionUntilByPlan(planTier);
  if (!retentionResult.ok) {
    logger.warn("transcript segment persist skipped: calcRetentionUntilByPlan failed", {
      roomId: event.roomId,
      planTier,
    });
    return;
  }

  // sourceEventId: リクエストの idempotencyKey (UUID) を転用する。Agent 実装は常に
  // randomUUID() を送るため通常は妥当だが、念のため UUID 形式を検証しフォールバックする。
  const idempotencyKeyParsed = z.uuid().safeParse(idempotencyKey);
  const sourceEventId = idempotencyKeyParsed.success ? idempotencyKeyParsed.data : randomUUID();

  const segment: TranscriptSegment = {
    segmentId: randomUUID(),
    roomId: roomIdResult.data,
    participantId: participantIdResult.data,
    speakerName,
    originalText: "",
    translatedText: event.text,
    languagePair: `${sourceLanguage}-${event.outputLanguage}`,
    startTimeMs,
    endTimeMs: startTimeMs,
    sequenceNo: event.sequenceNo,
    sourceEventId,
    agentSessionId: event.agentJobId,
    retentionUntil: retentionResult.data,
    createdAt: new Date().toISOString(),
  };

  const appendResult = await transcript.appendFinalSegment(segment);
  if (!appendResult.ok) {
    logger.warn("transcript.appendFinalSegment failed", {
      roomId: event.roomId,
      sequenceNo: event.sequenceNo,
      errorCode: appendResult.error.code,
    });
  }
}

// ---------------------------------------------------------------------------
// #67: translation.session_ended → translation.ended DomainEvent publish
// ---------------------------------------------------------------------------

/**
 * #67: session_ended を受信し永続化 (handleAgentEvent 内で updateEnded 済み) した後、
 * `translation.getUsage(agentJobId)` で確定した TranslationUsage (sessionId 含む) を取得し、
 * `translation.ended` DomainEvent を EventBus に publish する。
 *
 * #46 usage metering (別担当 W2c) がこのイベントを subscribe して billing.recordUsage を呼ぶ想定。
 */
async function publishTranslationEndedEvent(
  event: SessionEndedPayload,
  deps: { translation: TranslationFacade; eventBus: EventBus },
): Promise<void> {
  const { translation, eventBus } = deps;

  const usageResult = await translation.getUsage(event.agentJobId);
  if (!usageResult.ok) {
    logger.warn("translation.ended publish skipped: getUsage failed", {
      agentJobId: event.agentJobId,
      errorCode: usageResult.error.code,
    });
    return;
  }
  const usage = usageResult.data;

  const sessionIdResult = brandTranslationSessionId(usage.sessionId);
  if (!sessionIdResult.success) {
    logger.warn("translation.ended publish skipped: invalid sessionId", {
      agentJobId: event.agentJobId,
      sessionId: usage.sessionId,
    });
    return;
  }

  // #46/#49/#67: TranslationEndedEventSchema.payload.reason は
  // packages/translation/src/events/translation-ended.ts で TranslationSessionEndedReasonSchema
  // (5 値、agent_publish_failed 含む) を参照するよう同期済みのため、reason を絞り込まず
  // そのまま渡す。agent_publish_failed (音声送出失敗) でも通話自体は発生しているため、
  // #46 usage metering (translation.ended 購読者 = usage-metering-subscriber.ts) の対象とする。
  const domainEvent = createTranslationEndedEvent({
    sessionId: sessionIdResult.data,
    roomId: usage.roomId,
    sourceParticipantId: usage.sourceParticipantId,
    outputLanguage: usage.outputLanguage,
    durationMs: usage.durationMs,
    billableSeconds: usage.billableSeconds,
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    reason: usage.reason,
  });

  await eventBus.publish(domainEvent);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentRoutes(
  fastify: FastifyInstance,
  deps: {
    translation: TranslationFacade;
    transcript: TranscriptFacade;
    auth: AuthFacade;
    room: RoomFacade;
    billing: BillingFacade;
    config: Config;
    eventBus: EventBus;
    supabase: SupabaseClient;
  },
): void {
  const { translation, transcript, auth, room, billing, config, eventBus, supabase } = deps;
  // #63: idempotencyKey 単位のリクエスト重複排除 (nonce store)。
  const nonceRepo = createNonceRepository(supabase);
  const hmacPreHandler = createHmacPreHandler(config, nonceRepo);

  // --------------------------------------------------------------------------
  // POST /internal/agent/events
  // --------------------------------------------------------------------------
  fastify.post(
    "/internal/agent/events",
    {
      preHandler: [hmacPreHandler],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idempotencyKey = request.headers["x-trancall-idempotency-key"];
      if (typeof idempotencyKey !== "string") {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "x-trancall-idempotency-key は必須です", retryable: false },
        });
      }

      // Zod discriminatedUnion で event type バリデーション
      const eventParsed = AgentEventSchema.safeParse(request.body);
      if (!eventParsed.success) {
        logger.warn("agent event validation failed", {
          issues: eventParsed.error.issues.map((i) => i.message),
          idempotencyKey,
        });
        return reply.status(400).send({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: eventParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
            retryable: false,
          },
        });
      }

      const agentEvent = eventParsed.data;

      // TranslationFacade.handleAgentEvent に委譲
      // HMAC 検証・冪等性チェックはミドルウェアとここで処理済み
      const result = await translation.handleAgentEvent(agentEvent);
      if (!result.ok) {
        return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
      }

      // translation.degraded / translation.recovered を EventBus に publish
      if (agentEvent.type === "translation.degraded") {
        const degradedParsed = TranslationDegradedPayloadSchema.safeParse(agentEvent);
        if (degradedParsed.success) {
          const p = degradedParsed.data;
          const sessionIdResult = brandTranslationSessionId(p.sessionId);
          if (sessionIdResult.success) {
            await eventBus.publish({
              eventId: randomUUID(),
              occurredAt: p.occurredAt,
              aggregateId: p.agentJobId,
              type: "translation.degraded",
              payload: {
                sessionId: sessionIdResult.data,
                agentJobId: p.agentJobId,
                sourceLang: p.sourceLang,
                targetLang: p.targetLang,
                reason: p.reason,
                timestamp: p.occurredAt,
                latencyP95Ms: null,
                consecutiveSilenceMs: null,
              },
            });
          } else {
            // #67: サイレントドロップにせず warn を出す
            logger.warn("translation.degraded publish skipped: invalid sessionId", {
              agentJobId: p.agentJobId,
              sessionId: p.sessionId,
            });
          }
        }
      } else if (agentEvent.type === "translation.recovered") {
        const recoveredParsed = TranslationRecoveredPayloadSchema.safeParse(agentEvent);
        if (recoveredParsed.success) {
          const p = recoveredParsed.data;
          const sessionIdResult = brandTranslationSessionId(p.sessionId);
          if (sessionIdResult.success) {
            await eventBus.publish({
              eventId: randomUUID(),
              occurredAt: p.occurredAt,
              aggregateId: p.agentJobId,
              type: "translation.recovered",
              payload: {
                sessionId: sessionIdResult.data,
                agentJobId: p.agentJobId,
                sourceLang: p.sourceLang,
                targetLang: p.targetLang,
                degradedDurationMs: p.degradedDurationMs,
                timestamp: p.occurredAt,
              },
            });
          } else {
            // #67: サイレントドロップにせず warn を出す
            logger.warn("translation.recovered publish skipped: invalid sessionId", {
              agentJobId: p.agentJobId,
              sessionId: p.sessionId,
            });
          }
        }
      } else if (agentEvent.type === "translation.session_ended") {
        // #67: translation.ended DomainEvent を publish する (#46 usage metering が subscribe)
        await publishTranslationEndedEvent(agentEvent, { translation, eventBus });
      } else if (agentEvent.type === "transcript.delta") {
        // #48: isFinal=true (確定セグメント) のみ DB へ永続化する
        if (agentEvent.isFinal) {
          await persistFinalTranscriptSegment(agentEvent, idempotencyKey, { auth, room, billing, transcript });
        }
      }

      logger.info("agent event processed", {
        type: agentEvent.type,
        idempotencyKey,
      });

      // #63: 正常完了をマークし、以後の同一 idempotencyKey リクエスト
      // (リトライ/リプレイ) が副作用を再実行しないようにする。
      const markResult = await nonceRepo.markProcessed(idempotencyKey);
      if (!markResult.ok) {
        logger.warn("nonce markProcessed failed", {
          idempotencyKey,
          errorCode: markResult.error.code,
        });
      }

      return reply.send({ ok: true });
    },
  );

  // --------------------------------------------------------------------------
  // POST /internal/translation/heartbeat
  // --------------------------------------------------------------------------
  fastify.post(
    "/internal/translation/heartbeat",
    {
      preHandler: [hmacPreHandler],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const idempotencyKey = request.headers["x-trancall-idempotency-key"];
      if (typeof idempotencyKey !== "string") {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "x-trancall-idempotency-key は必須です", retryable: false },
        });
      }

      const bodyParsed = HeartbeatBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        logger.warn("heartbeat validation failed", {
          issues: bodyParsed.error.issues.map((i) => i.message),
          idempotencyKey,
        });
        return reply.status(400).send({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: bodyParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
            retryable: false,
          },
        });
      }

      const body: HeartbeatBody = bodyParsed.data;
      const runId = randomUUID();

      const { error: dbError } = await supabase
        .schema("trancall_event")
        .from("agent_heartbeats")
        .insert({
          run_id: runId,
          agent_job_id: body.agentJobId,
          session_id: body.sessionId,
          occurred_at: body.occurredAt,
          metrics: body.metrics ?? null,
          created_at: new Date().toISOString(),
        });

      if (dbError) {
        logger.error("agent heartbeat DB insert failed", {
          message: dbError.message,
          agentJobId: body.agentJobId,
          sessionId: body.sessionId,
        });
        return reply.status(500).send({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "heartbeat の保存に失敗しました", retryable: true },
        });
      }

      logger.info("agent heartbeat recorded", {
        runId,
        agentJobId: body.agentJobId,
        sessionId: body.sessionId,
        occurredAt: body.occurredAt,
      });

      // #63: 正常完了をマークし、以後の同一 idempotencyKey リクエスト
      // (リトライ/リプレイ) が副作用を再実行しないようにする。
      const markResult = await nonceRepo.markProcessed(idempotencyKey);
      if (!markResult.ok) {
        logger.warn("nonce markProcessed failed", {
          idempotencyKey,
          errorCode: markResult.error.code,
        });
      }

      return reply.send({ ok: true });
    },
  );
}
