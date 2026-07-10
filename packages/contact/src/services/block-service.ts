/**
 * BlockService — ブロック管理ドメインサービス
 */

import {
  type Result,
  type UserId,
  err,
} from "@trancall/shared-kernel";

import type { BlockUserCommand } from "../schemas.ts";
import type { BlockRepository } from "../repositories/block-repository.ts";

export interface BlockService {
  blockUser(cmd: BlockUserCommand): Promise<Result<true>>;
  unblockUser(
    userId: UserId,
    blockedUserId: UserId,
  ): Promise<Result<true>>;
}

export function createBlockService(blockRepo: BlockRepository): BlockService {
  return {
    blockUser: async (
      cmd: BlockUserCommand,
    ): Promise<Result<true>> => {
      // 自分自身のブロックは不可
      if (cmd.userId === cmd.blockedUserId) {
        return err({
          code: "CONTACT_SELF_ADD",
          message: "自分をブロックすることはできません",
          retryable: false,
          httpStatus: 400,
        });
      }

      return blockRepo.block(cmd.userId, cmd.blockedUserId, cmd.reason);
    },

    unblockUser: async (
      userId: UserId,
      blockedUserId: UserId,
    ): Promise<Result<true>> => {
      return blockRepo.unblock(userId, blockedUserId);
    },
  };
}
