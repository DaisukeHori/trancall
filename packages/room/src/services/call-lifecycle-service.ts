/**
 * call-lifecycle-service — createCall / endCall のコアロジック
 *
 * docs/call-lifecycle.md Section 1 と Section 4 に準拠。
 */

import { randomUUID } from "crypto";
import type { Result, AppError, UserId, RoomId } from "@trancall/shared-kernel";
import { RoomIdSchema, UserIdSchema, err, ok } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade, IncomingCallNotification } from "@trancall/notification";

import type { RoomState } from "../schemas.js";
import type { RoomRepository } from "../repositories/room-repository.js";
import type { ParticipantRepository } from "../repositories/participant-repository.js";
import type { EventBus } from "../event-bus.js";
import { createRoomCreatedEvent } from "../events/room-created.js";
import { createParticipantLeftEvent } from "../events/participant-left.js";
import { buildRoomState } from "./state-builder.js";

export interface CallLifecycleServiceDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  billing: BillingFacade;
  media: MediaFacade;
  notification: NotificationFacade;
  eventBus: EventBus;
}

export interface CallLifecycleService {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: { translationEnabled: boolean },
  ): Promise<Result<RoomState, AppError>>;

  endCall(roomId: RoomId): Promise<Result<RoomState, AppError>>;
}

export function createCallLifecycleService(
  deps: CallLifecycleServiceDeps,
): CallLifecycleService {
  const { roomRepo, participantRepo, billing, media, notification, eventBus } = deps;

  return {
    // =========================================================================
    // createCall
    // =========================================================================
    async createCall(creatorId, inviteeIds, opts) {
      // 1. billing.canStartCall → 残高チェック
      // billing が返す AppError (BILLING_INSUFFICIENT_BALANCE 等) をそのまま pass-through。
      // room module が billing owner のエラーコードを再定義しない。
      const canStart = await billing.canStartCall(creatorId);
      if (!canStart.ok) {
        return canStart;
      }

      // 2. rooms INSERT
      const roomIdRaw = randomUUID();
      const roomIdResult = RoomIdSchema.safeParse(roomIdRaw);
      if (!roomIdResult.success) {
        return err({
          code: "ROOM_CREATE_FAILED",
          message: "roomId の生成に失敗しました",
          retryable: false,
        });
      }
      const roomId = roomIdResult.data;
      const createdAt = new Date().toISOString();

      const insertResult = await roomRepo.insert({
        roomId,
        status: "waiting",
        translationEnabled: opts.translationEnabled,
        createdBy: creatorId,
        createdAt,
      });
      if (!insertResult.ok) {
        return err({
          code: "ROOM_CREATE_FAILED",
          message: insertResult.error.message,
          retryable: insertResult.error.retryable,
        });
      }
      const roomRow = insertResult.data;

      // 3. participants INSERT — host
      const joinedAt = new Date().toISOString();
      const hostUpsertResult = await participantRepo.upsert({
        roomId,
        userId: creatorId,
        role: "host",
        joinedAt,
      });
      if (!hostUpsertResult.ok) {
        // ロールバック相当: rooms を ended に更新して戻る
        await roomRepo.updateStatus(roomId, "ended", new Date().toISOString());
        return err({
          code: "ROOM_CREATE_FAILED",
          message: `host participant の挿入に失敗しました: ${hostUpsertResult.error.message}`,
          retryable: hostUpsertResult.error.retryable,
        });
      }

      // 4. media.createRoom → 失敗なら rooms を ended に更新
      const mediaResult = await media.createRoom(roomId);
      if (!mediaResult.ok) {
        await roomRepo.updateStatus(roomId, "ended", new Date().toISOString());
        return err({
          code: "ROOM_MEDIA_CREATE_FAILED",
          message: mediaResult.error.message,
          retryable: mediaResult.error.retryable,
        });
      }

      // 5. invitee 全員に sendIncomingCall (並列、best-effort)
      const timestamp = new Date().toISOString();
      const incomingNotification: IncomingCallNotification = {
        roomId,
        callerName: creatorId, // server 側で profile を引いて置換する想定
        callerAvatarUrl: null,
        callerTrancallId: creatorId,
        roomType: "audio",
        translationEnabled: opts.translationEnabled,
        languagePair: "",
        callerLanguage: "",
        timestamp,
      };

      await Promise.allSettled(
        inviteeIds.map((inviteeId) =>
          notification.sendIncomingCall(inviteeId, incomingNotification),
        ),
      );

      // 6. EventBus.publish room.created
      const event = createRoomCreatedEvent({
        roomId,
        creatorId,
        inviteeIds,
        translationEnabled: opts.translationEnabled,
        createdAt,
      });
      await eventBus.publish(event);

      // 7. RoomState を返す
      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }

      return buildRoomState(roomRow, participantsResult.data);
    },

    // =========================================================================
    // endCall
    // =========================================================================
    async endCall(roomId) {
      // 1. rooms.findById → 存在しない or 既に ended なら冪等で OK 返す
      const roomResult = await roomRepo.findById(roomId);
      if (!roomResult.ok) {
        return roomResult;
      }

      const roomRow = roomResult.data;

      // 既に ended なら冪等 OK
      if (roomRow.status === "ended") {
        const participantsResult = await participantRepo.findByRoomId(roomId);
        if (!participantsResult.ok) {
          return participantsResult;
        }
        return buildRoomState(roomRow, participantsResult.data);
      }

      // 2. rooms.update status='ended', ended_at=now()
      const endedAt = new Date().toISOString();
      const updateResult = await roomRepo.updateStatus(roomId, "ended", endedAt);
      if (!updateResult.ok) {
        return updateResult;
      }

      // 3. participants の left_at を全員分更新
      const leftAt = new Date().toISOString();
      await participantRepo.setLeftAtForAll(roomId, leftAt);

      // 4. media.deleteRoom — best-effort
      await media.deleteRoom(roomId).catch(() => {
        // best-effort: 失敗しても進める
      });

      // 5. participants 取得
      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }
      const participants = participantsResult.data;

      // 6. 誰も join しなかった場合 (host のみ = 1 人) → missedCall 通知
      //    ただし invitees の情報は room facade 側が知らないため、
      //    sendMissedCall の対象は「waiting のままで終話」という状態を
      //    server orchestration 層が inviteeIds を使って呼ぶのが正しい設計。
      //    room facade 自体は sendMissedCall を呼ばない (Layer 3 server に委譲)。
      //    ※ 仕様コメント: もし inviteeIds を room が保持するなら notification 可能だが、
      //    現 DB schema に invitees テーブルなし。実装方針: room は通知しない。

      // 7. EventBus.publish participant_left (まだ left_at 未設定だった参加者分)
      await Promise.allSettled(
        participants.map((p) => {
          const parsedUserId = UserIdSchema.safeParse(p.user_id);
          if (!parsedUserId.success) return Promise.resolve();
          return eventBus.publish(
            createParticipantLeftEvent({
              roomId,
              userId: parsedUserId.data,
              leftAt,
            }),
          );
        }),
      );

      return buildRoomState(updateResult.data, participants);
    },
  };
}
