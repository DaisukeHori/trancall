/**
 * in-memory RoomRepository — テスト用モック実装
 */

import { ok, err } from "@trancall/shared-kernel";
import type { Result, AppError, RoomId } from "@trancall/shared-kernel";
import type { RoomRepository } from "../../src/repositories/room-repository.js";
import type { RoomRow, InsertRoomCommand } from "../../src/schemas.js";

export function createInMemoryRoomRepository(): RoomRepository & {
  _store: Map<string, RoomRow>;
} {
  const store = new Map<string, RoomRow>();

  return {
    _store: store,

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
  };
}
