/**
 * join-service — joinCall のコアロジック
 *
 * docs/call-lifecycle.md Section 2 に準拠。
 */

import type { Result, UserId, RoomId } from "@trancall/shared-kernel";
import { UserIdSchema } from "@trancall/shared-kernel";

import type { RoomState } from "../schemas.ts";
import type { RoomRepository } from "../repositories/room-repository.ts";
import type { ParticipantRepository } from "../repositories/participant-repository.ts";
import type { BlockListRepository } from "../repositories/block-list-repository.ts";
import type { EventBus } from "../event-bus.ts";
import { createParticipantJoinedEvent } from "../events/participant-joined.ts";
import { buildRoomState } from "./state-builder.ts";
import { ROOM_MAX_PARTICIPANTS } from "../constants.ts";

export interface JoinServiceDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  eventBus: EventBus;
  /** Issue #69: joinCall (参加) 時のブロックリスト + 定員チェックに使う */
  blockListRepo: BlockListRepository;
}

export interface JoinService {
  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState>>;
}

export function createJoinService(deps: JoinServiceDeps): JoinService {
  const { roomRepo, participantRepo, eventBus, blockListRepo } = deps;

  return {
    async joinCall(roomId, userId) {
      // 1. rooms.findById → 存在しない or ended なら error
      const roomResult = await roomRepo.findById(roomId);
      if (!roomResult.ok) {
        return roomResult;
      }

      const roomRow = roomResult.data;

      if (roomRow.status === "ended") {
        return {
          ok: false,
          error: {
            code: "ROOM_ALREADY_ENDED",
            message: `Room ${roomId} は既に終了しています`,
            retryable: false,
          },
        };
      }

      // 2. 確定#2 (認可バイパス修正): 招待されていない第三者の自己エンロールを防ぐ。
      // createCall が host + invitee を participants に事前登録している
      // (invitee は joined_at: null の「招待済み・未参加」状態) ため、
      // 既存の participant 行を持たないユーザーは「招待されていない」とみなし拒否する。
      const existingResult = await participantRepo.findOne(roomId, userId);
      if (!existingResult.ok) {
        return existingResult;
      }
      if (existingResult.data === null) {
        return {
          ok: false,
          error: {
            code: "ROOM_USER_NOT_INVITED",
            message: `ユーザー ${userId} はこの通話に招待されていません`,
            retryable: false,
          },
        };
      }

      // Issue #69: 既に join 済み (joined_at !== null) かどうかで以降の分岐を変える。
      // 再 join (冪等パス) は host 自身の再 join テスト等の既存挙動を壊さないよう、
      // ブロックリスト/定員チェックの対象外とする (既に部屋に入っている事実は変わらない)。
      const isFirstJoin = existingResult.data.joined_at === null;

      if (isFirstJoin) {
        // 2.5. Issue #69: 定員チェック (ROOM_FULL) + ブロックリストチェック (ROOM_USER_BLOCKED)。
        // 現在実際に join 済みの参加者一覧を取得する (招待済み・未参加の行は含めない)。
        const currentParticipantsResult = await participantRepo.findByRoomId(roomId);
        if (!currentParticipantsResult.ok) {
          return currentParticipantsResult;
        }
        const joinedParticipants = currentParticipantsResult.data.filter(
          (p) => p.joined_at !== null,
        );

        // 2.5a. 定員チェック: ROOM_MAX_PARTICIPANTS (constants.ts) に既に達している場合は拒否する。
        if (joinedParticipants.length >= ROOM_MAX_PARTICIPANTS) {
          return {
            ok: false,
            error: {
              code: "ROOM_FULL",
              message: `Room ${roomId} は定員 (${String(ROOM_MAX_PARTICIPANTS)}) に達しています`,
              retryable: false,
            },
          };
        }

        // 2.5b. ブロックリストチェック: 既に join 済みの相手 (host を含む) との間に
        // ブロック関係がある場合は参加を拒否する。招待時点ではブロック関係が無くても、
        // 招待後〜join までの間にブロックされた/した可能性があるための防御的チェック。
        const otherJoinedUserIds = joinedParticipants
          .map((p) => p.user_id)
          .filter((id): id is string => id !== null && id !== userId);

        for (const otherUserIdRaw of otherJoinedUserIds) {
          const otherUserIdResult = UserIdSchema.safeParse(otherUserIdRaw);
          if (!otherUserIdResult.success) continue;
          const blockedResult = await blockListRepo.isBlocked(userId, otherUserIdResult.data);
          if (!blockedResult.ok) {
            return blockedResult;
          }
          if (blockedResult.data) {
            return {
              ok: false,
              error: {
                code: "ROOM_USER_BLOCKED",
                message: "ブロック関係にあるユーザーがいる通話には参加できません",
                retryable: false,
              },
            };
          }
        }
      }

      // 3. joined_at のみ更新する (markJoined は role を書き換えない —
      // host が自分自身で再 join しても role が member に降格しないようにするため、
      // upsert (全列書き換え) ではなくこちらを使う)。
      const joinedAt = new Date().toISOString();
      const markResult = await participantRepo.markJoined(roomId, userId, joinedAt);
      if (!markResult.ok) {
        return markResult;
      }
      const participantRow = markResult.data;

      // 4. status='waiting' → 'active' に遷移 (非 host が join した時)
      let updatedRoomRow = roomRow;
      if (roomRow.status === "waiting") {
        const updateResult = await roomRepo.updateStatus(roomId, "active");
        if (!updateResult.ok) {
          return updateResult;
        }
        updatedRoomRow = updateResult.data;
      }

      // 5. EventBus.publish room.participant_joined
      // userId は UserId (Branded Type) なのでそのまま渡せる。role は既存行の実際の role
      // (host が再 join した場合も "host" のまま、旧実装のような固定 "member" にしない)。
      const event = createParticipantJoinedEvent({
        roomId,
        userId,
        role: participantRow.role,
        joinedAt,
      });
      await eventBus.publish(event);

      // 6. RoomState を返す
      const participantsResult = await participantRepo.findByRoomId(roomId);
      if (!participantsResult.ok) {
        return participantsResult;
      }

      return buildRoomState(updatedRoomRow, participantsResult.data);
    },
  };
}
