/**
 * InviteRepository — 招待リンクデータアクセスインターフェース
 */

import type { Result, AppError, UserId } from "@trancall/shared-kernel";

export interface InviteLink {
  id: string;
  userId: UserId;
  token: string;
  expiresAt: string; // ISO 8601
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InviteRepository {
  /**
   * 招待リンクを作成する。
   */
  create(
    userId: UserId,
    token: string,
    expiresAt: Date,
  ): Promise<Result<InviteLink, AppError>>;

  /**
   * トークンで招待リンクを取得する。
   */
  findByToken(token: string): Promise<InviteLink | null>;

  /**
   * 招待リンクを使用済みにする。
   */
  markUsed(
    token: string,
    usedBy: UserId,
  ): Promise<Result<true, AppError>>;
}
