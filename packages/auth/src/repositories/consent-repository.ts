/**
 * ConsentRepository — 同意レコードの永続化抽象
 *
 * canonical: docs/legal-and-consent.md v1.2 §4.2
 * canonical: docs/module-contracts.md v1.3 §2.1 (要求 Repository)
 *
 * 本番実装は packages/auth/src/adapters/supabase-consent-repository.ts を参照。
 * テストでは in-memory モックを DI する。
 */

import {
  type Result,
  type UserId,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type ConsentRecord,
} from "@trancall/shared-kernel";

export interface ConsentRepository {
  /**
   * 同意レコードを upsert する。
   * DB UNIQUE 制約 (user_id, scope, version) に依存して冪等性を実現する。
   * 同一 (userId, scope, version) が既存の場合は既存レコードを返す。
   *
   * DB: INSERT ... ON CONFLICT (user_id, scope, version) DO NOTHING
   */
  upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>>;

  /**
   * 指定ユーザー・scope の最新有効な同意レコードを返す。
   * revokedAt IS NULL のレコードのみ対象。
   * 存在しない場合は { ok: true, data: null } を返す。
   */
  findActive(
    userId: UserId,
    scope: ConsentScope,
  ): Promise<Result<ConsentRecord | null>>;

  /**
   * 指定ユーザーの全有効な同意レコードを返す。
   * revokedAt IS NULL のレコードのみ対象。
   * getRequiredConsents() の突き合わせに使用する。
   */
  listActive(userId: UserId): Promise<Result<ConsentRecord[]>>;

  /**
   * 指定 scope の同意を取り消す。
   * user_consents.revoked_at に現在時刻をセットする（論理削除）。
   * 既に取消済みの場合は冪等に ok: true を返す。
   */
  revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>>;
}
