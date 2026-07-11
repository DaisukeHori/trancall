/**
 * BlockListRepository — DI 要求 (read-only view)
 *
 * @trancall/contact が所有する trancall_contact.block_list テーブルへの
 * 読み取り専用ビュー。docs/module-contracts.md §6 依存方向マトリクスでは
 * room → contact の facade 直接 import は禁止 (❌) のため、room は
 * @trancall/contact の `BlockRepository` と同型のインターフェースを自身の
 * 境界として独自定義し、apps/server (Layer 3) が contact 側の実装を
 * このインターフェースを満たす形でそのまま注入する。
 *
 * これは `packages/contact` が要求する `ProfileSearchRepository`
 * (auth 所有の profiles テーブルへの read-only view、
 * docs/module-contracts.md §4.4) と同型のパターンであり、
 * モジュール間の「関係の契約」を facade 経由に保ったまま
 * 他モジュール所有テーブルを参照する既存の解決策を踏襲する。
 */

import type { Result, UserId } from "@trancall/shared-kernel";

export interface BlockListRepository {
  /**
   * userId と targetUserId の間にブロック関係があるかどうかを判定する (双方向)。
   * userId が targetUserId をブロックしている、または targetUserId が userId を
   * ブロックしている場合に true を返す。
   */
  isBlocked(userId: UserId, targetUserId: UserId): Promise<Result<boolean>>;
}
