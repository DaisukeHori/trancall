/**
 * Agent 内部 API エンドポイント
 *
 * POST /internal/agent/events
 *
 * docs/module-contracts.md Section 7 に従い HMAC 検証 + 冪等性チェックを行う。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { TranslationFacade } from "@trancall/translation";
import type { TranscriptFacade } from "@trancall/transcript";
import { AgentEventSchema } from "@trancall/translation";
import { createHmacPreHandler } from "../middleware/hmac-middleware.js";
import type { Config } from "../config.js";
import { getHttpStatus } from "../middleware/error-handler.js";
import { logger } from "../logger.js";

export function registerAgentRoutes(
  fastify: FastifyInstance,
  deps: {
    translation: TranslationFacade;
    transcript: TranscriptFacade;
    config: Config;
  },
): void {
  const { translation, config } = deps;
  const hmacPreHandler = createHmacPreHandler(config);

  // POST /internal/agent/events
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

      // TranslationFacade.handleAgentEvent に委譲
      // HMAC 検証・冪等性チェックはミドルウェアとここで処理済み
      const result = await translation.handleAgentEvent(eventParsed.data);
      if (!result.ok) {
        return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
      }

      logger.info("agent event processed", {
        type: eventParsed.data.type,
        idempotencyKey,
      });

      return reply.send({ ok: true });
    },
  );
}
