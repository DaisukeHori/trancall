/**
 * ProfileDeletionRepository — 退会 (soft delete) 状態の永続化抽象 (Issue #72.1)
 *
 * apps/server/src/routes/account-routes.ts (POST /api/account/delete /
 * POST /api/account/restore) が直接 `supabase.schema("trancall_auth").from("profiles")`
 * を呼んで `deleted_at` を読み書きしていた (facade バイパス) ものを置き換える。
 *
 * `ProfileRepository` (findByUserId、行が無ければ AUTH_PROFILE_NOT_FOUND エラー) とは
 * 読み取りセマンティクスが異なる — account-routes.ts は「行が存在しない」を
 * エラーではなく正常な null として扱う (`.maybeSingle()` 相当) ため、
 * 別インターフェースとして分離する (profile-write-repository.ts と同じ理由で、
 * 既存の ProfileRepository 利用テストへの影響を避ける)。
 *
 * 本番実装は apps/server/src/adapters/repositories/auth/
 * profile-deletion-repository.supabase.ts を参照。
 */

import { type Result, type UserId } from "@trancall/shared-kernel";

export interface ProfileDeletionStatus {
  deletedAt: string | null;
}

export interface ProfileDeletionRepository {
  /**
   * 退会状態 (deleted_at) を取得する。
   * プロフィール行が存在しない場合は `ok(null)` を返す (エラーにしない)。
   */
  findStatus(userId: UserId): Promise<Result<ProfileDeletionStatus | null>>;

  /**
   * deleted_at を設定する。`null` を渡すと退会状態を解除する
   * (POST /api/account/restore、およびサブスク変更失敗時のロールバックで使用)。
   */
  setDeletedAt(userId: UserId, deletedAt: string | null): Promise<Result<true>>;
}
