/**
 * history-service — L-13: GET /api/rooms/history のコアロジック
 *
 * docs/api-spec.md §GET /api/rooms/history 準拠。
 */
import type { Result, RoomId, UserId } from "@trancall/shared-kernel";
import { RoomIdSchema, UserIdSchema, ok, err } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { PlanTier } from "@trancall/billing";

import type {
  GetRoomHistoryQuery,
  RoomHistoryEntry,
  RoomHistoryParticipant,
  RoomHistoryResponse,
} from "../schemas.ts";
import { RoomHistoryEntrySchema } from "../schemas.ts";
import type { RoomRepository } from "../repositories/room-repository.ts";
import type { ParticipantRepository } from "../repositories/participant-repository.ts";
import type { RoomHistoryEnrichmentRepository } from "../repositories/room-history-enrichment-repository.ts";

/**
 * 通話履歴一覧の表示保持日数 (docs/api-spec.md GET /api/rooms/history 実装側の制約)。
 *
 * ⚠️ `@trancall/billing` の `PlanConfig.transcriptRetentionDays` (7/30/90/365、
 * 4 段階) とは別の値。あちらは「トランスクリプト本文をいつ物理削除するか」を決める
 * 別機能の設定であり、本値は「通話履歴一覧に何日分のエントリを表示するか」という
 * 表示上のウィンドウに過ぎない (room/participants 行自体を削除するものではない)。
 * 混同すると Free プランの履歴が 7 日分しか出なくなる (api-spec.md の意図する 90 日と
 * 乖離する) ため、意図的に切り離して定義する。
 */
const HISTORY_WINDOW_DAYS: Record<PlanTier, number> = {
  free: 90,
  light: 90,
  standard: 365,
  business: 365,
};
const DEFAULT_HISTORY_WINDOW_DAYS = 90;

export interface HistoryServiceDeps {
  roomRepo: RoomRepository;
  participantRepo: ParticipantRepository;
  billing: BillingFacade;
  /** 未注入時はフォールバック値 (costYen=0 / hasTranscript=false / displayName プレースホルダ) */
  historyEnrichmentRepo?: RoomHistoryEnrichmentRepository;
}

export interface HistoryService {
  getRoomHistory(
    userId: UserId,
    query: GetRoomHistoryQuery,
  ): Promise<Result<RoomHistoryResponse>>;
}

async function resolveParticipantProfile(
  enrichmentRepo: RoomHistoryEnrichmentRepository | undefined,
  userId: UserId,
): Promise<{ displayName: string; trancallId: string; avatarUrl: string | null }> {
  if (!enrichmentRepo) {
    return { displayName: "Unknown", trancallId: "@unknown", avatarUrl: null };
  }
  const result = await enrichmentRepo.getProfile(userId);
  if (!result.ok || result.data === null) {
    // best-effort: プロフィール取得不能 (退会済み等) でも履歴一覧の表示自体は止めない
    return { displayName: "Unknown", trancallId: "@unknown", avatarUrl: null };
  }
  return result.data;
}

async function resolveCostYen(
  enrichmentRepo: RoomHistoryEnrichmentRepository | undefined,
  roomId: RoomId,
  userId: UserId,
): Promise<number> {
  if (!enrichmentRepo) return 0;
  const result = await enrichmentRepo.getCostYen(roomId, userId);
  return result.ok ? result.data : 0;
}

async function resolveHasTranscript(
  enrichmentRepo: RoomHistoryEnrichmentRepository | undefined,
  roomId: RoomId,
  userId: UserId,
): Promise<boolean> {
  if (!enrichmentRepo) return false;
  const result = await enrichmentRepo.hasTranscript(roomId, userId);
  return result.ok ? result.data : false;
}

export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  const { roomRepo, participantRepo, billing, historyEnrichmentRepo } = deps;

  return {
    async getRoomHistory(
      userId: UserId,
      query: GetRoomHistoryQuery,
    ): Promise<Result<RoomHistoryResponse>> {
      // プラン別の履歴表示ウィンドウを解決する (best-effort: 取得失敗時は既定値 90 日)
      let windowDays = DEFAULT_HISTORY_WINDOW_DAYS;
      const subResult = await billing.getSubscription(userId);
      if (subResult.ok) {
        windowDays = HISTORY_WINDOW_DAYS[subResult.data.plan.tier];
      }
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

      const roomsResult = await roomRepo.findEndedByParticipantId(userId, {
        limit: query.limit,
        // exactOptionalPropertyTypes: true のため、undefined を明示的に渡さず条件付きで spread する
        ...(query.before !== undefined ? { before: query.before } : {}),
        since,
      });
      if (!roomsResult.ok) {
        return roomsResult;
      }
      const rooms = roomsResult.data;

      const entries: RoomHistoryEntry[] = [];
      for (const room of rooms) {
        // 不変条件: status='ended' の行は ended_at が設定されている想定だが、
        // 万一 null の場合は履歴一覧の対象外として skip する (防御的)
        if (room.ended_at === null) continue;

        const roomIdResult = RoomIdSchema.safeParse(room.room_id);
        if (!roomIdResult.success) {
          return err({
            code: "INTERNAL_ERROR",
            message: `DB の room_id が UUID 形式ではありません: ${room.room_id}`,
            retryable: false,
          });
        }
        const roomId = roomIdResult.data;

        const participantsResult = await participantRepo.findByRoomId(roomId);
        if (!participantsResult.ok) {
          return participantsResult;
        }
        // 実際に join した参加者のみ (joined_at !== null、招待のみで未参加の行は除外)
        const joinedRows = participantsResult.data.filter(
          (p) => p.joined_at !== null && p.user_id !== null,
        );

        const participants: RoomHistoryParticipant[] = [];
        let myRole: "host" | "member" = "member";
        let sawMyself = false;
        for (const row of joinedRows) {
          const rowUserIdResult = UserIdSchema.safeParse(row.user_id);
          if (!rowUserIdResult.success) {
            // 不正な user_id は履歴エントリの参加者一覧から静かに除外する (防御的)
            continue;
          }
          const rowUserId = rowUserIdResult.data;
          const profile = await resolveParticipantProfile(historyEnrichmentRepo, rowUserId);
          participants.push({
            userId: rowUserId,
            displayName: profile.displayName,
            trancallId: profile.trancallId,
            avatarUrl: profile.avatarUrl,
            isHost: row.role === "host",
          });
          if (rowUserId === userId) {
            myRole = row.role;
            sawMyself = true;
          }
        }
        // 自分の join 行が見つからない (データ不整合) 場合はこの room を履歴に含めない
        if (!sawMyself) continue;

        const durationSeconds = Math.max(
          0,
          Math.round(
            (new Date(room.ended_at).getTime() - new Date(room.created_at).getTime()) / 1000,
          ),
        );
        const costYen = await resolveCostYen(historyEnrichmentRepo, roomId, userId);
        const hasTranscript = await resolveHasTranscript(historyEnrichmentRepo, roomId, userId);

        const candidate = {
          roomId,
          status: "ended" as const,
          roomType: room.room_type,
          translationEnabled: room.translation_enabled,
          startedAt: room.created_at,
          endedAt: room.ended_at,
          durationSeconds,
          participants,
          myRole,
          costYen,
          hasTranscript,
        };
        const parsed = RoomHistoryEntrySchema.safeParse(candidate);
        if (parsed.success) {
          entries.push(parsed.data);
        }
      }

      const nextCursor =
        rooms.length === query.limit && entries.length > 0
          ? (entries[entries.length - 1]?.startedAt ?? null)
          : null;

      return ok({ rooms: entries, nextCursor });
    },
  };
}
