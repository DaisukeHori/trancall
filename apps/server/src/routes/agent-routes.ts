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
import type { TranslationFacade } from "@trancall/translation";
import type { TranscriptFacade } from "@trancall/transcript";
import {
  AgentEventSchema,
  TranslationDegradedPayloadSchema,
  TranslationRecoveredPayloadSchema,
} from "@trancall/translation";
import { brandTranslationSessionId } from "@trancall/shared-kernel";
import { z } from "zod";
import { createHmacPreHandler } from "../middleware/hmac-middleware.js";
import type { Config } from "../config.js";
import type { EventBus } from "../adapters/event-bus.js";
import { getHttpStatus } from "../middleware/error-handler.js";
import { logger } from "../logger.js";
import type { SupabaseClient } from "@supabase/supabase-js";

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
// Route registration
// ---------------------------------------------------------------------------

export function registerAgentRoutes(
  fastify: FastifyInstance,
  deps: {
    translation: TranslationFacade;
    transcript: TranscriptFacade;
    config: Config;
    eventBus: EventBus;
    supabase: SupabaseClient;
  },
): void {
  const { translation, config, eventBus, supabase } = deps;
  const hmacPreHandler = createHmacPreHandler(config);

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
          }
        }
      }

      logger.info("agent event processed", {
        type: agentEvent.type,
        idempotencyKey,
      });

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

      return reply.send({ ok: true });
    },
  );
}
