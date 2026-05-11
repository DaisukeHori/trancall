/**
 * トランスクリプトエンドポイント
 *
 * GET    /api/transcripts/:roomId
 * DELETE /api/transcripts/:roomId
 * POST   /api/transcripts/:roomId/export
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { TranscriptFacade } from "@trancall/transcript";
import { brandRoomId } from "@trancall/shared-kernel";
import { getHttpStatus } from "../middleware/error-handler.js";

const ExportSchema = z.object({
  format: z.enum(["pdf", "txt"]).default("txt"),
});

const TranscriptParamsSchema = z.object({ roomId: z.string() });

export function registerTranscriptRoutes(
  fastify: FastifyInstance,
  deps: { transcript: TranscriptFacade },
): void {
  const { transcript } = deps;

  // GET /api/transcripts/:roomId
  fastify.get("/api/transcripts/:roomId", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = TranscriptParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "roomId は必須です", retryable: false } });
    }
    const { roomId } = parsedParams.data;
    const roomIdResult = brandRoomId(roomId);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const result = await transcript.getTranscript(roomIdResult.data, request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // DELETE /api/transcripts/:roomId (soft delete)
  fastify.delete("/api/transcripts/:roomId", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = TranscriptParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "roomId は必須です", retryable: false } });
    }
    const { roomId } = parsedParams.data;
    const roomIdResult = brandRoomId(roomId);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const result = await transcript.deleteAccess(roomIdResult.data, request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // POST /api/transcripts/:roomId/export
  fastify.post("/api/transcripts/:roomId/export", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = TranscriptParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "roomId は必須です", retryable: false } });
    }
    const { roomId } = parsedParams.data;
    const roomIdResult = brandRoomId(roomId);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const parsed = ExportSchema.safeParse(request.body ?? {});
    const format = parsed.success ? parsed.data.format : "txt";

    const result = await transcript.exportTranscript(roomIdResult.data, request.userId, format);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });
}
