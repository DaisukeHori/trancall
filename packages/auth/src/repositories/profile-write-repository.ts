/**
 * ProfileWriteRepository — プロフィール更新の永続化抽象 (Issue #72.1)
 *
 * `ProfileRepository` (読み取り専用、findByUserId のみ) とは別インターフェースに
 * 分離する。既存の `ProfileRepository` は多数のテストで
 * `{ findByUserId: vi.fn() }` という最小オブジェクトとして直接リテラル構築されており
 * (packages/auth/__tests__/*.test.ts)、`update` を `ProfileRepository` に生やすと
 * それら無関係なテスト全てに影響が及ぶ。CreateAuthFacadeOptions の他の任意依存
 * (consentRepo / legalDocRepo / eventBus) と同じ「省略可能な追加依存」として
 * 独立させることで、既存コードへの影響を最小化する。
 *
 * 本番実装は apps/server/src/adapters/repositories/auth/profile-repository.supabase.ts
 * (createProfileWriteRepository) を参照。
 */

import { type Result, type UserId } from "@trancall/shared-kernel";

export interface ProfileUpdateFields {
  displayName?: string;
  nativeLanguage?: string;
  avatarUrl?: string;
}

export interface ProfileWriteRepository {
  /**
   * プロフィールを更新する (差分のみ、undefined のフィールドは更新しない)。
   * 更新後の値の取得は呼び出し元 (facade) が別途 ProfileRepository.findByUserId で行う。
   */
  update(userId: UserId, updates: ProfileUpdateFields): Promise<Result<void>>;
}
