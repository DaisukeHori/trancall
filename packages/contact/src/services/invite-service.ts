/**
 * InviteService — 招待リンク管理ドメインサービス
 */

import {
  type Result,
  type UserId,
  err,
  ok,
} from "@trancall/shared-kernel";

import { nanoid } from "nanoid";
import type { ContactEntry } from "../schemas.ts";
import type { InviteRepository } from "../repositories/invite-repository.ts";
import type { ContactRepository } from "../repositories/contact-repository.ts";

/** 招待トークン長 (nanoid で 30 文字) */
const TOKEN_LENGTH = 30;

/** 招待リンク有効期限（7 日） */
const INVITE_EXPIRES_DAYS = 7;

/**
 * 招待リンクベース URL のフォールバック値。
 *
 * Issue #72.3: 従来はこの値がハードコードされ、環境 (本番/ステージング/開発) に
 * 関わらず常に同じ URL が生成されていた。呼び出し元 (apps/server/src/container.ts) が
 * `config.ts` の `INVITE_BASE_URL` (環境変数、デフォルトは同じ値) を
 * `createInviteService` の第 3 引数として渡すようにし、環境ごとに差し替え可能にする。
 * 引数省略時はこのフォールバック値を使う (後方互換)。
 */
const DEFAULT_INVITE_BASE_URL = "https://trancall.app/invite";

export interface InviteService {
  /**
   * 招待リンクを生成する。
   * @returns url, token, expiresAt
   *
   * NOTE: Rate limit は本 facade では実装しない。
   *   docs/security-detail.md より、`POST /api/contacts/invite-link` には
   *   **10 req/hour/user** のレート制限が要求される。
   *   実際の rate limit は server (Layer 3) のミドルウェア層で実装すること。
   */
  createInviteLink(userId: UserId): Promise<
    Result<{ url: string; token: string; expiresAt: string }>
  >;

  /**
   * 招待リンクを消費して双方向連絡先を作成する。
   * @param token 招待トークン
   * @param newUserId リンクを使用したユーザー
   * @returns 新規追加された ContactEntry（newUserId → inviter）
   */
  consumeInviteLink(
    token: string,
    newUserId: UserId,
  ): Promise<Result<ContactEntry>>;
}

export function createInviteService(
  inviteRepo: InviteRepository,
  contactRepo: ContactRepository,
  options?: { baseUrl?: string },
): InviteService {
  const baseUrl = options?.baseUrl ?? DEFAULT_INVITE_BASE_URL;

  return {
    createInviteLink: async (
      userId: UserId,
    ): Promise<Result<{ url: string; token: string; expiresAt: string }>> => {
      const token = nanoid(TOKEN_LENGTH);
      const expiresAt = new Date(
        Date.now() + INVITE_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
      );

      const result = await inviteRepo.create(userId, token, expiresAt);
      if (!result.ok) {
        return result;
      }

      return ok({
        url: `${baseUrl}/${token}`,
        token,
        expiresAt: expiresAt.toISOString(),
      });
    },

    consumeInviteLink: async (
      token: string,
      newUserId: UserId,
    ): Promise<Result<ContactEntry>> => {
      // トークン検索
      const invite = await inviteRepo.findByToken(token);
      if (invite === null) {
        return err({
          code: "CONTACT_NOT_FOUND",
          message: "招待リンクが見つかりません",
          retryable: false,
          httpStatus: 404,
        });
      }

      // 有効期限チェック
      if (new Date(invite.expiresAt) < new Date()) {
        return err({
          code: "VALIDATION_ERROR",
          message: "招待リンクの有効期限が切れています",
          retryable: false,
          httpStatus: 400,
        });
      }

      // 使用済みチェック
      if (invite.usedBy !== null) {
        return err({
          code: "CONTACT_ALREADY_EXISTS",
          message: "この招待リンクはすでに使用されています",
          retryable: false,
          httpStatus: 409,
        });
      }

      // 無効化チェック
      if (invite.revokedAt !== null) {
        return err({
          code: "VALIDATION_ERROR",
          message: "この招待リンクは無効化されています",
          retryable: false,
          httpStatus: 400,
        });
      }

      // 自分自身のリンクを使用しようとしている場合
      if (invite.userId === newUserId) {
        return err({
          code: "CONTACT_SELF_ADD",
          message: "自分の招待リンクは使用できません",
          retryable: false,
          httpStatus: 400,
        });
      }

      // 使用済みにマーク
      const markResult = await inviteRepo.markUsed(token, newUserId);
      if (!markResult.ok) {
        return markResult;
      }

      // 双方向連絡先作成
      // inviter → newUser
      await contactRepo.add(invite.userId, newUserId);
      // newUser → inviter
      const result = await contactRepo.add(newUserId, invite.userId);

      return result;
    },
  };
}
