/**
 * トランスクリプトエンドポイント
 *
 * GET    /api/transcripts/:roomId
 * DELETE /api/transcripts/:roomId
 * POST   /api/transcripts/:roomId/export  (旧、後方互換のため維持)
 *
 * Sprint 3 T-10 追加:
 * GET    /api/transcripts/:roomId/export  — format クエリパラメータでエクスポート (docs/api-spec.md)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { TranscriptFacade } from "@trancall/transcript";
import { brandRoomId } from "@trancall/shared-kernel";
import { getHttpStatus } from "../middleware/error-handler.js";

const ExportBodySchema = z.object({
  format: z.enum(["pdf", "txt"]).default("txt"),
});

const ExportQuerySchema = z.object({
  format: z.enum(["pdf", "txt"]).default("txt"),
});

const TranscriptParamsSchema = z.object({ roomId: z.string() });

/**
 * roomId を検証して RoomId Brand 型に変換する共通ヘルパー
 */
function parseRoomId(rawId: string): { success: true; data: ReturnType<typeof brandRoomId>["data"] } | { success: false } {
  const result = brandRoomId(rawId);
  if (!result.success) return { success: false };
  return { success: true, data: result.data };
}

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

  // GET /api/transcripts/:roomId/export — Sprint 3 T-10 (format クエリパラメータ)
  // docs/api-spec.md 仕様: GET で format=pdf|txt クエリ
  fastify.get("/api/transcripts/:roomId/export", async (request: FastifyRequest, reply: FastifyReply) => {
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

    const parsedQuery = ExportQuerySchema.safeParse(request.query);
    const format = parsedQuery.success ? parsedQuery.data.format : "txt";

    const result = await transcript.exportTranscript(roomIdResult.data, request.userId, format);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/transcripts/:roomId/export (後方互換: body で format を指定する旧 API)
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

    const parsed = ExportBodySchema.safeParse(request.body ?? {});
    const format = parsed.success ? parsed.data.format : "txt";

    const result = await transcript.exportTranscript(roomIdResult.data, request.userId, format);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });
}
