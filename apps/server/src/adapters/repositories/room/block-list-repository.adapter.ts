/**
 * BlockListRepository (room) — contact BlockRepository への adapter
 *
 * Issue #69 (1): room モジュールは @trancall/contact を直接 import できない
 * (docs/module-contracts.md §6 依存方向マトリクス、room → contact ❌)。
 * そのため room 側で自己定義した `BlockListRepository` (read-only view) を、
 * apps/server (Layer 3) が既存の contact `BlockRepository` 実装を包んで満たす。
 *
 * `packages/contact` が要求する `ProfileSearchRepository` (auth 所有 profiles への
 * read-only view、docs/module-contracts.md §4.4) と同型の「他モジュール所有テーブルを
 * 読むための repository」パターン。
 */

import type { BlockRepository } from "@trancall/contact";
import type { BlockListRepository } from "@trancall/room";
import { type Result, ok, err } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";

export function createRoomBlockListRepository(
  blockRepo: BlockRepository,
): BlockListRepository {
  return {
    async isBlocked(userId: UserId, targetUserId: UserId): Promise<Result<boolean>> {
      try {
        const blocked = await blockRepo.isBlocked(userId, targetUserId);
        return ok(blocked);
      } catch (e) {
        return err({
          code: "INTERNAL_ERROR",
          message: e instanceof Error ? e.message : String(e),
          retryable: true,
        });
      }
    },
  };
}
