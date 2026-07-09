/**
 * 通話 (Room) エンドポイント
 *
 * POST /api/rooms
 * GET  /api/rooms/:id
 * POST /api/rooms/:id/join
 * POST /api/rooms/:id/leave
 * POST /api/rooms/:id/token
 *
 * Sprint 3 T-10 追加:
 * GET  /api/rooms/history — 通話履歴 (docs/api-spec.md §GET /api/rooms/history)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { RoomFacade, CreateCallOptions } from "@trancall/room";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade } from "@trancall/notification";
import type { AuthFacade } from "@trancall/auth";
import { brandUserId, brandRoomId, brandTranslationSessionId } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import { randomUUID } from "node:crypto";
import { getHttpStatus } from "../middleware/error-handler.js";
import { logger } from "../logger.js";
import type { RoomReservationSessionRepository } from "../adapters/repositories/billing/room-reservation-session-repository.supabase.js";

const CreateRoomSchema = z.object({
  inviteeIds: z.array(z.uuid()).min(1).max(49),
  roomType: z.enum(["audio", "video"]).default("audio"),
  translationEnabled: z.boolean().default(true),
});

// Sprint 3 T-10 追加 (docs/api-spec.md GET /api/rooms/history)
const RoomHistoryQuerySchema = z.object({
  limit: z.string().optional().transform((v) => {
    const n = v != null ? parseInt(v, 10) : 20;
    return isNaN(n) ? 20 : Math.min(50, Math.max(1, n));
  }),
  before: z.string().optional(),
});

// #43: POST /api/rooms/:id/token は request body を要求しない。旧実装は body の
// userId を信頼していた (他人の Token を発行できてしまう脆弱性) ため廃止し、
// 認証済み request.userId のみを使う。

const RoomParamsSchema = z.object({ id: z.string() });

// TODO(#53): docs/call-lifecycle.md §1 のシーケンス図は reserveMinutes(5) (5分) だが、
// 実装は 60 分を渡している。billing 側の実際の予約仕様 (残量に LEAST(minutes, remaining) が
// 適用されるため実害は限定的) を確認した上でどちらかに合わせる必要がある。本 PR のスコープ外
// のため値は変更せず、相違のみ明記する。
const RESERVE_MINUTES = 60; // デフォルト予約分数

/** #52: 発信者プロフィール解決に失敗した場合のフォールバック値 (push 通知は best-effort) */
const FALLBACK_CALLER_NAME = "TranCall User";
const FALLBACK_LANGUAGE = "en";

/**
 * #52: 着信 Push の callerName / languagePair / callerLanguage を解決する。
 *
 * - callerName: 発信者の表示名 (Profile.displayName、未設定なら trancallId)。UUID は渡さない。
 * - callerLanguage: 発信者の nativeLanguage (DB 値、クライアント入力は信頼しない)。
 * - languagePair: "callerLanguage-calleeLanguage" (docs/notification-detail.md の "en-ja" 形式)。
 *   1 対 1 通話が前提 (packages/room/CLAUDE.md 責務、Phase 2 でグループ対応予定) のため、
 *   複数 invitee の場合も先頭の inviteeId の言語を代表として使う
 *   (call-lifecycle-service.ts が invitee 全員へ同一の IncomingCallNotification を送るため、
 *   現状の設計では invitee ごとに languagePair を出し分けられない)。
 * - auth.getProfile が失敗した場合は best-effort でフォールバック値を使い、通話作成自体は継続する
 *   (push 通知の内容不備で発信を止めない、既存の sendIncomingCall best-effort 方針と同じ)。
 */
async function resolveCreateCallOptions(
  auth: AuthFacade,
  creatorId: UserId,
  inviteeUserIds: UserId[],
  translationEnabled: boolean,
): Promise<CreateCallOptions> {
  const callerProfileResult = await auth.getProfile(creatorId);
  let callerName = FALLBACK_CALLER_NAME;
  let callerLanguage = FALLBACK_LANGUAGE;
  if (callerProfileResult.ok) {
    callerName = callerProfileResult.data.displayName ?? callerProfileResult.data.trancallId;
    callerLanguage = callerProfileResult.data.nativeLanguage;
  } else {
    logger.warn("auth.getProfile failed for caller (best-effort push fallback)", {
      creatorId,
      errorCode: callerProfileResult.error.code,
    });
  }

  let calleeLanguage = FALLBACK_LANGUAGE;
  const firstInviteeId = inviteeUserIds[0];
  if (firstInviteeId !== undefined) {
    const calleeProfileResult = await auth.getProfile(firstInviteeId);
    if (calleeProfileResult.ok) {
      calleeLanguage = calleeProfileResult.data.nativeLanguage;
    } else {
      logger.warn("auth.getProfile failed for invitee (best-effort push fallback)", {
        inviteeId: firstInviteeId,
        errorCode: calleeProfileResult.error.code,
      });
    }
  }

  return {
    translationEnabled,
    callerName,
    callerLanguage,
    languagePair: `${callerLanguage}-${calleeLanguage}`,
  };
}

export function registerRoomRoutes(
  fastify: FastifyInstance,
  deps: {
    room: RoomFacade;
    billing: BillingFacade;
    media: MediaFacade;
    notification: NotificationFacade;
    auth: AuthFacade;
    /**
     * #46/#53: roomId ↔ 予約 sessionId (TranslationSessionId) の対応表。DB (trancall_billing.
     * room_reservation_sessions) ベース。旧実装は apps/server 内 in-memory Map
     * (roomSessionMap) だったが、サーバー再起動やマルチインスタンス (Vercel 等) で
     * 失われるため、apps/server/src/adapters/usage-metering-subscriber.ts (#46,
     * translation.ended 購読者) からも同じテーブルを引けるよう DB ベースに置き換えた。
     */
    roomReservationSessionRepo: RoomReservationSessionRepository;
  },
): void {
  const { room, billing, media, auth, roomReservationSessionRepo } = deps;

  // GET /api/rooms/history — 通話履歴 (Sprint 3 T-10)
  // NOTE: 静的パスを /api/rooms/:id より前に登録することで conflict を回避
  fastify.get("/api/rooms/history", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RoomHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "クエリパラメータが無効です", retryable: false },
      });
    }

    const { limit, before } = parsed.data;
    const historyQuery = before != null ? { limit, before } : { limit };
    const result = await room.getRoomHistory(request.userId, historyQuery);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });

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

    // #52: 着信 Push の callerName/languagePair/callerLanguage は room facade が自己解決できない
    // (room は auth に依存しないため) ため、server 層で auth.getProfile から実値を解決して渡す。
    const createCallOpts = await resolveCreateCallOptions(auth, request.userId, inviteeUserIds, translationEnabled);

    // createCall (billing.canStartCall + room作成 + 着信通知)
    const createResult = await room.createCall(request.userId, inviteeUserIds, createCallOpts);
    if (!createResult.ok) {
      return reply.status(getHttpStatus(createResult.error.code)).send({ ok: false, error: createResult.error });
    }

    const roomState = createResult.data;

    // billing.reserveMinutes (best-effort、失敗しても通話は継続)
    // #53: 生成した sessionId を roomId に紐付けて保存する (/leave 時の reconcile と、
    // #46 usage-metering-subscriber.ts の translation.ended → recordUsage で使う)。
    const sessionId = brandTranslationSessionId(randomUUID());
    if (sessionId.success && translationEnabled) {
      const reserveResult = await billing.reserveMinutes(request.userId, sessionId.data, RESERVE_MINUTES);
      if (reserveResult.ok) {
        const saveResult = await roomReservationSessionRepo.save({
          roomId: roomState.roomId,
          userId: request.userId,
          sessionId: sessionId.data,
        });
        if (!saveResult.ok) {
          // best-effort: 対応付け保存に失敗しても通話自体は継続する。ただしこの場合
          // /leave の reconcile と #46 usage metering は roomId から sessionId を解決できず
          // スキップされる (通話は継続、課金記録のみ漏れる)。
          logger.warn("room_reservation_sessions save failed (best-effort, call continues)", {
            roomId: roomState.roomId,
            errorCode: saveResult.error.code,
          });
        }
      } else {
        logger.warn("billing.reserveMinutes failed (best-effort, call continues)", {
          roomId: roomState.roomId,
          errorCode: reserveResult.error.code,
        });
      }
    }

    return reply.status(201).send({ ok: true, data: roomState });
  });

  // GET /api/rooms/:id
  fastify.get("/api/rooms/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = RoomParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id は必須です", retryable: false } });
    }
    const { id } = parsedParams.data;
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

    // #43: room の参加者のみ閲覧可能 (他人の room 状態を覗けないようにする)
    if (!isRoomParticipant(result.data.participants, request.userId)) {
      return reply.status(403).send({
        ok: false,
        error: { code: "FORBIDDEN", message: "この通話の参加者ではありません", retryable: false },
      });
    }

    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/rooms/:id/join
  fastify.post("/api/rooms/:id/join", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = RoomParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id は必須です", retryable: false } });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = RoomParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id は必須です", retryable: false } });
    }
    const { id } = parsedParams.data;
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    // #43: room の参加者のみ終話可能 (endCall 実行前に確認する — 実行後だと副作用が
    // 発生してから拒否することになるため、必ず endCall より前にチェックする)
    const stateResult = await room.getState(roomIdResult.data);
    if (!stateResult.ok) {
      return reply.status(getHttpStatus(stateResult.error.code)).send({ ok: false, error: stateResult.error });
    }
    if (!isRoomParticipant(stateResult.data.participants, request.userId)) {
      return reply.status(403).send({
        ok: false,
        error: { code: "FORBIDDEN", message: "この通話の参加者ではありません", retryable: false },
      });
    }

    const result = await room.endCall(roomIdResult.data);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }

    // #53: 作成時に保存した sessionId を使って billing.reconcile する (roomId をそのまま
    // sessionId として使っていた旧実装は、予約時の sessionId と一致せず reconcile が
    // 常に対象レコードなしで失敗し、予約分数が解放されない「残高ロック」を起こしていた)。
    // #46: 対応付けは roomReservationSessionRepo (DB) から引く。ここでは行を削除しない
    // (後から届く translation.ended (#46 usage-metering-subscriber.ts) が同じ対応付けを
    // 必要とするため。詳細は supabase/migrations/00020_add_room_reservation_sessions_table.sql
    // のコメント参照。そのため、ここでの reconcile が先に成功し、後から usage-metering-
    // subscriber.ts が同じ sessionId で reconcile を再試行して「既に reconciled」エラーに
    // なることがあるが best-effort のため実害はない)。
    const mappingResult = await roomReservationSessionRepo.findByRoomId(roomIdResult.data);
    const storedSessionIdRaw = mappingResult.ok ? mappingResult.data?.sessionId : undefined;

    if (storedSessionIdRaw !== undefined) {
      const sessionIdResult = brandTranslationSessionId(storedSessionIdRaw);
      if (sessionIdResult.success) {
        const reconcileResult = await billing.reconcile(request.userId, sessionIdResult.data);
        if (!reconcileResult.ok) {
          logger.warn("billing.reconcile failed (best-effort)", {
            roomId: roomIdResult.data,
            errorCode: reconcileResult.error.code,
          });
        }
      } else {
        logger.warn("billing.reconcile skipped: stored sessionId is invalid", {
          roomId: roomIdResult.data,
        });
      }
    } else if (result.data.translationEnabled) {
      // translationEnabled=true の room で予約 sessionId が見つからない場合のみ警告する
      // (translationEnabled=false の room はそもそも reserveMinutes を呼んでいないため正常)。
      logger.warn("billing.reconcile skipped: no reservation sessionId found for room", {
        roomId: roomIdResult.data,
      });
    }

    return reply.send({ ok: true, data: result.data });
  });

  // POST /api/rooms/:id/token (LiveKit token 発行)
  fastify.post("/api/rooms/:id/token", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = RoomParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id は必須です", retryable: false } });
    }
    const { id } = parsedParams.data;
    const roomIdResult = brandRoomId(id);
    if (!roomIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "roomId は UUID 形式です", retryable: false },
      });
    }

    // #43: room の参加者のみ Token 発行可能。role (caller/callee) も room.createdBy から
    // 導出する (media.issueAccessToken の IssueAccessTokenRequestSchema は role 必須のため、
    // 以前は role 未指定で呼んでおり常に media.token.invalid_request になっていた)。
    const stateResult = await room.getState(roomIdResult.data);
    if (!stateResult.ok) {
      return reply.status(getHttpStatus(stateResult.error.code)).send({ ok: false, error: stateResult.error });
    }
    if (!isRoomParticipant(stateResult.data.participants, request.userId)) {
      return reply.status(403).send({
        ok: false,
        error: { code: "FORBIDDEN", message: "この通話の参加者ではありません", retryable: false },
      });
    }
    const role: "caller" | "callee" = stateResult.data.createdBy === request.userId ? "caller" : "callee";

    const result = await media.issueAccessToken({
      userId: request.userId,
      roomId: roomIdResult.data,
      role,
    });

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: result.data });
  });
}

/**
 * #43: request.userId が room の参加者一覧に含まれるかを確認する。
 * nullable 追従 (00019 migration): participant.userId は退会済みユーザー物理削除後に
 * null になりうるが、request.userId (認証済みユーザー) は常に非 null のため
 * null 行が誤って一致することはない。
 */
function isRoomParticipant(
  participants: { userId: UserId | null }[],
  userId: UserId,
): boolean {
  return participants.some((p) => p.userId === userId);
}
