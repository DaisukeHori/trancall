/**
 * in-memory RoomRepository — テスト用モック実装
 */

import { ok, err } from "@trancall/shared-kernel";
import type { Result, AppError, RoomId, UserId } from "@trancall/shared-kernel";
import type {
  FindEndedRoomsOptions,
  RoomRepository,
} from "../../src/repositories/room-repository.js";
import type { RoomRow, InsertRoomCommand } from "../../src/schemas.js";

export function createInMemoryRoomRepository(): RoomRepository & {
  _store: Map<string, RoomRow>;
  /**
   * L-13 テスト用フック: findEndedByParticipantId は room_id → participant userId[]
   * の対応が必要 (実 Supabase 実装は trancall_room.participants を直接クエリする)。
   * in-memory 版はテストコードから後付けで参照関数を渡してもらう
   * (history-service.test.ts が InMemoryParticipantRepository._store から解決する)。
   */
  _setParticipantLookup: (fn: (userId: UserId) => string[]) => void;
} {
  const store = new Map<string, RoomRow>();
  let participantLookup: ((userId: UserId) => string[]) | null = null;

  return {
    _store: store,
    _setParticipantLookup: (fn) => {
      participantLookup = fn;
    },

    async insert(cmd: InsertRoomCommand): Promise<Result<RoomRow>> {
      const row: RoomRow = {
        room_id: cmd.roomId,
        status: cmd.status,
        room_type: "audio",
        translation_enabled: cmd.translationEnabled,
        created_by: cmd.createdBy,
        created_at: cmd.createdAt,
        ended_at: null,
      };
      store.set(cmd.roomId, row);
      return ok(row);
    },

    async findById(roomId: RoomId): Promise<Result<RoomRow>> {
      const row = store.get(roomId);
      if (!row) {
        return err({
          code: "ROOM_NOT_FOUND",
          message: `Room ${roomId} が見つかりません`,
          retryable: false,
        });
      }
      return ok({ ...row });
    },

    async updateStatus(
      roomId: RoomId,
      status: "active" | "ended",
      endedAt?: string,
    ): Promise<Result<RoomRow>> {
      const row = store.get(roomId);
      if (!row) {
        return err({
          code: "ROOM_NOT_FOUND",
          message: `Room ${roomId} が見つかりません`,
          retryable: false,
        });
      }
      const updated: RoomRow = {
        ...row,
        status,
        ended_at: endedAt ?? row.ended_at,
      };
      store.set(roomId, updated);
      return ok({ ...updated });
    },

    async findEndedByParticipantId(
      userId: UserId,
      opts: FindEndedRoomsOptions,
    ): Promise<Result<RoomRow[]>> {
      const roomIds = new Set(participantLookup ? participantLookup(userId) : []);
      let rows = [...store.values()].filter(
        (r) => r.status === "ended" && roomIds.has(r.room_id),
      );
      const since = opts.since;
      if (since != null) {
        rows = rows.filter((r) => r.created_at >= since);
      }
      const before = opts.before;
      if (before != null) {
        rows = rows.filter((r) => r.created_at < before);
      }
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok(rows.slice(0, opts.limit));
    },
  };
}
