/**
 * 通話 (Room) エンドポイント
 *
 * POST /api/rooms
 * GET  /api/rooms/:id
 * POST /api/rooms/:id/join
 * POST /api/rooms/:id/leave
 * POST /api/rooms/:id/token
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { RoomFacade } from "@trancall/room";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade } from "@trancall/notification";
import { brandUserId, brandRoomId, brandTranslationSessionId } from "@trancall/shared-kernel";
import { randomUUID } from "node:crypto";
import { getHttpStatus } from "../middleware/error-handler.js";

const CreateRoomSchema = z.object({
  inviteeIds: z.array(z.string().uuid()).min(1).max(49),
  roomType: z.enum(["audio", "video"]).default("audio"),
  translationEnabled: z.boolean().default(true),
});

const IssueTokenSchema = z.object({
  userId: z.string().uuid(),
  roomName: z.string().optional(),
});

const RESERVE_MINUTES = 60; // デフォルト予約分数

export function registerRoomRoutes(
  fastify: FastifyInstance,
  deps: {
    room: RoomFacade;
    billing: BillingFacade;
    media: MediaFacade;
    notification: NotificationFacade;
  },
): void {
  const { room, billing, media } = deps;

  // POST /api/rooms
  fastify.post("/api/rooms", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "入力が無効です", retryable: false },
      });
    }

    const { inviteeIds, translationEnabled } = parsed.data;

    // inviteeIds を UserId に変換
    const inviteeUserIds = [];
    for (const id of inviteeIds) {
      const r = brandUserId(id);
      if (!r.success) {
        return reply.status(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: `inviteeId ${id} は UUID 形式です`, retryable: false },
        });
      }
      inviteeUserIds.push(r.data);
    }

    // createCall (billing.canStartCall + room作成 + 着信通知)
    const createResult = await room.createCall(request.userId, inviteeUserIds, { translationEnabled });
    if (!createResult.ok) {
      return reply.status(getHttpStatus(createResult.error.code)).send({ ok: false, error: createResult.error });
    }

    const roomState = createResult.data;

    // billing.reserveMinutes (best-effort、失敗しても通話は継続)
    const sessionId = brandTranslationSessionId(randomUUID());
    if (sessionId.success && translationEnabled) {
      await billing.reserveMinutes(request.userId, sessionId.data, RESERVE_MINUTES);
    }

    return reply.status(201).send({ ok: true, data: roomState });
  });

  // GET /api/rooms/:id
  fastify.get("/api/rooms/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const result = await room.getState(roomIdResult.data);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/rooms/:id/join
  fastify.post("/api/rooms/:id/join", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const result = await room.joinCall(roomIdResult.data, request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/rooms/:id/leave (endCall 相当)
  fastify.post("/api/rooms/:id/leave", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const result = await room.endCall(roomIdResult.data);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }

    // billing.reconcile (best-effort)
    const sessionIdResult = brandTranslationSessionId(roomIdResult.data);
    if (sessionIdResult.success) {
      await billing.reconcile(request.userId, sessionIdResult.data).catch(() => undefined);
    }

    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/rooms/:id/token (LiveKit token 発行)
  fastify.post("/api/rooms/:id/token", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    const parsed = IssueTokenSchema.safeParse(request.body ?? {});
    const userIdToUse = parsed.success && parsed.data.userId
      ? brandUserId(parsed.data.userId).data ?? request.userId
      : request.userId;

    const result = await media.issueAccessToken({
      userId: userIdToUse,
      roomId: roomIdResult.data,
    });

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });
}
