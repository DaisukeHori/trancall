/**
 * call-lifecycle-service — createCall / endCall のコアロジック
 *
 * docs/call-lifecycle.md Section 1 と Section 4 に準拠。
 */

import { randomUUID } from "node:crypto";
import type { Result, UserId, RoomId } from "@trancall/shared-kernel";
import { RoomIdSchema, UserIdSchema, err } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade, IncomingCallNotification } from "@trancall/notification";

import type { RoomState, ParticipantRow } from "../schemas.js";
import type { RoomRepository } from "../repositories/room-repository.js";
import type { ParticipantRepository } from "../repositories/participant-repository.js";
import type { EventBus } from "../event-bus.js";
import { createRoomCreatedEvent } from "../events/room-created.js";
import { createParticipantLeftEvent } from "../events/participant-left.js";
import { buildRoomState } from "./state-builder.js";

/**
 * 2巡目 finding3: invitee 事前登録 (upsert, joined_at: null) の best-effort リトライ。
 * retryable (transient) エラーのみ 1 回だけ再試行する。非 retryable エラー
 * (制約違反等、再試行しても結果が変わらないもの) は即座に返し、無駄な再試行をしない。
 * 想定外の例外 (throw) も 1 回だけ再試行し、それでも失敗すれば呼び出し元
 * (Promise.allSettled) に rejected として伝播させる。
 */
async function upsertInviteeWithRetry(
  participantRepo: ParticipantRepository,
  roomId: RoomId,
  inviteeId: UserId,
): Promise<Result<ParticipantRow>> {
  const attempt = () =>
    participantRepo.upsert({ roomId, userId: inviteeId, role: "member", joinedAt: null });

  try {
    const result = await attempt();
    if (result.ok || !result.error.retryable) return result;
    return await attempt();
  } catch {
    return await attempt();
  }
}

export interface CallLifecycleServiceDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  billing: BillingFacade;
  media: MediaFacade;
  notification: NotificationFacade;
  eventBus: EventBus;
}

/**
 * #52: 着信 Push (IncomingCallNotification) の callerName/languagePair/callerLanguage は
 * min(1) 必須フィールドであり、room facade は auth/profile への依存を持たないため
 * 自力で解決できない。呼び出し元 (apps/server の room-routes、auth facade で
 * creatorId → 表示名/言語設定を解決できる層) が実際の値を渡す「呼び出し側が渡す」構造にする。
 */
export interface CreateCallOptions {
  translationEnabled: boolean;
  /** 着信 Push の callerName に使用する発信者の表示名 (UUID ではない) */
  callerName: string;
  /** 着信 Push の languagePair に使用する言語ペア表示 (例: "ja → en") */
  languagePair: string;
  /** 着信 Push の callerLanguage に使用する発信者の言語コード (例: "ja") */
  callerLanguage: string;
}

export interface CallLifecycleService {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: CreateCallOptions,
  ): Promise<Result<RoomState>>;

  endCall(roomId: RoomId): Promise<Result<RoomState>>;
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

      // 4.5. 確定#2 (認可バイパス修正): invitee 全員を participants に
      // 「招待済み・未参加」ステータス (joined_at: null) で事前登録する。
      // joinCall はこの行の有無で「招待されているか」を判定するため、ここで
      // 登録しておかないと invitee は永久に join できなくなる。
      //
      // 2巡目 finding1/4 (regression): participantRepo.upsert は room_id, user_id の
      // onConflict で role/joined_at を含む全列を上書きする。creatorId が inviteeIds に
      // 混入すると、直前に host として登録した行 (step 3) が role='member' /
      // joined_at=null で上書きされ、state-builder が joined_at=null の行を
      // RoomState.participants から除外するため host が自室から締め出される
      // (GET/token/leave が 403、host 非降格の不変条件も破れる)。
      // 対策: creatorId を除外し、重複 inviteeId も 1 回に集約してから事前登録・
      // 通知・イベント発行に使う (route 層の CreateRoomSchema/handler でも
      // 同種の入力を弾く二重防御を行うが、facade を直接呼ぶ経路 (agent-routes 等) も
      // あるためここでも防御する)。
      const sanitizedInviteeIds = [...new Set(inviteeIds)].filter((id) => id !== creatorId);

      // best-effort: push 通知の失敗と同じ方針で、事前登録に失敗した invitee が
      // いても通話作成自体は失敗させない。ただし 2巡目 finding3: 失敗を握り潰さず
      // error レベルでログし (どの invitee か特定可能に)、transient (retryable) な
      // 失敗には軽いリトライを行う。それでも失敗した invitee は join 時に
      // ROOM_USER_NOT_INVITED で永久に join できなくなるため、このログを監視対象と
      // する運用が必要 (join 経路での招待照合を復活させる設計変更は確定#2 の
      // 認可バイパス修正を弱めるため行わない — プロダクト判断が要る場合は別途検討)。
      const inviteResults = await Promise.allSettled(
        sanitizedInviteeIds.map((inviteeId) => upsertInviteeWithRetry(participantRepo, roomId, inviteeId)),
      );
      const failedInviteeIds: UserId[] = [];
      inviteResults.forEach((result, index) => {
        const inviteeId = sanitizedInviteeIds[index];
        if (inviteeId === undefined) return;
        if (result.status === "rejected") {
          failedInviteeIds.push(inviteeId);
          console.error("[room] invitee 事前登録に失敗 (リトライ後も失敗、best-effort で通話作成は継続)", {
            roomId,
            inviteeId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        } else if (!result.value.ok) {
          failedInviteeIds.push(inviteeId);
          console.error("[room] invitee 事前登録がエラーを返した (リトライ後も失敗、best-effort で通話作成は継続)", {
            roomId,
            inviteeId,
            errorCode: result.value.error.code,
            errorMessage: result.value.error.message,
          });
        }
      });
      if (failedInviteeIds.length > 0) {
        // 監視可能なシグナルとして集計もログに残す (アラート集計のトリガーに使える)。
        console.error("[room] invitee 事前登録に失敗したユーザーが存在します (集計)", {
          roomId,
          failedCount: failedInviteeIds.length,
          totalInvitees: sanitizedInviteeIds.length,
          failedInviteeIds,
        });
      }

      // 5. invitee 全員に sendIncomingCall (並列、best-effort)
      // #52: callerName/languagePair/callerLanguage は呼び出し元 (server route) が
      // auth/profile 解決済みの値を opts 経由で渡す (room facade は auth に依存しないため自己解決不可)。
      const timestamp = new Date().toISOString();
      const incomingNotification: IncomingCallNotification = {
        roomId,
        uuid: randomUUID(), // CallKit 用 UUID (roomId とは独立)
        callerId: creatorId, // 発信者の内部ユーザー ID
        callerName: opts.callerName,
        callerAvatarUrl: null,
        callerTrancallId: creatorId,
        roomType: "audio",
        translationEnabled: opts.translationEnabled,
        languagePair: opts.languagePair,
        callerLanguage: opts.callerLanguage,
        timestamp,
      };

      // best-effort: sendIncomingCall の失敗は createCall 自体を失敗させない。
      // ただし握り潰しっぱなしにはせず、結果を明示的に warn ログへ出す。
      // 2巡目 finding1/4: creator への自己着信通知・重複通知を避けるため sanitizedInviteeIds を使う。
      const notifyResults = await Promise.allSettled(
        sanitizedInviteeIds.map((inviteeId) =>
          notification.sendIncomingCall(inviteeId, incomingNotification),
        ),
      );
      notifyResults.forEach((result, index) => {
        const inviteeId = sanitizedInviteeIds[index];
        if (inviteeId === undefined) return;
        if (result.status === "rejected") {
          console.warn("[room] sendIncomingCall failed (best-effort, call continues)", {
            roomId,
            inviteeId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        } else if (!result.value.ok) {
          console.warn("[room] sendIncomingCall returned error (best-effort, call continues)", {
            roomId,
            inviteeId,
            errorCode: result.value.error.code,
            errorMessage: result.value.error.message,
          });
        }
      });

      // 6. EventBus.publish room.created
      // 2巡目 finding1/4: イベント payload の inviteeIds も creatorId 混入/重複のない
      // sanitizedInviteeIds を使う (実際に招待・通知された相手と一致させる)。
      const event = createRoomCreatedEvent({
        roomId,
        creatorId,
        inviteeIds: sanitizedInviteeIds,
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
