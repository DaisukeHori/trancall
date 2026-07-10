/**
 * in-memory ParticipantRepository — テスト用モック実装
 */

import { randomUUID } from "node:crypto";
import { ok, err } from "@trancall/shared-kernel";
import type { Result, AppError, RoomId, UserId } from "@trancall/shared-kernel";
import type { ParticipantRepository } from "../../src/repositories/participant-repository.js";
import type { ParticipantRow, UpsertParticipantCommand } from "../../src/schemas.js";

export function createInMemoryParticipantRepository(): ParticipantRepository & {
  _store: Map<string, ParticipantRow>;
} {
  // key: `${roomId}:${userId}`
  const store = new Map<string, ParticipantRow>();

  return {
    _store: store,

    async upsert(cmd: UpsertParticipantCommand): Promise<Result<ParticipantRow>> {
      const key = `${cmd.roomId}:${cmd.userId}`;
      const existing = store.get(key);
      if (existing) {
        // 冪等: 既存の場合は joined_at / role を更新
        const updated: ParticipantRow = {
          ...existing,
          role: cmd.role,
          joined_at: cmd.joinedAt,
        };
        store.set(key, updated);
        return ok({ ...updated });
      }
      const row: ParticipantRow = {
        id: randomUUID(),
        room_id: cmd.roomId,
        user_id: cmd.userId,
        role: cmd.role,
        is_muted: false,
        joined_at: cmd.joinedAt,
        left_at: null,
      };
      store.set(key, row);
      return ok({ ...row });
    },

    async findByRoomId(roomId: RoomId): Promise<Result<ParticipantRow[]>> {
      const rows: ParticipantRow[] = [];
      for (const [key, row] of store.entries()) {
        if (key.startsWith(`${roomId}:`)) {
          rows.push({ ...row });
        }
      }
      return ok(rows);
    },

    async setLeftAtForAll(roomId: RoomId, leftAt: string): Promise<Result<true>> {
      for (const [key, row] of store.entries()) {
        if (key.startsWith(`${roomId}:`) && row.left_at === null) {
          store.set(key, { ...row, left_at: leftAt });
        }
      }
      return ok(true as const);
    },

    // 確定#2: room_id + user_id に一致する参加者行を 1 件取得する (存在しなければ null)。
    async findOne(roomId: RoomId, userId: UserId): Promise<Result<ParticipantRow | null>> {
      const key = `${roomId}:${userId}`;
      const row = store.get(key);
      return ok(row ? { ...row } : null);
    },

    // 確定#2: 既存行の joined_at のみを更新する (role は変更しない)。
    async markJoined(roomId: RoomId, userId: UserId, joinedAt: string): Promise<Result<ParticipantRow>> {
      const key = `${roomId}:${userId}`;
      const existing = store.get(key);
      if (!existing) {
        return err({
          code: "ROOM_USER_NOT_INVITED",
          message: `ユーザー ${userId} はこの通話に招待されていません`,
          retryable: false,
        });
      }
      const updated: ParticipantRow = { ...existing, joined_at: joinedAt };
      store.set(key, updated);
      return ok({ ...updated });
    },
  };
}
