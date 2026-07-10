/**
 * ProfileSearchRepository — ユーザー検索データアクセスインターフェース
 */

import type { PublicProfile } from "../schemas";

export interface ProfileSearchRepository {
  /**
   * TranCall ID 完全一致でユーザーを検索する。
   */
  findByTrancallId(trancallId: string): Promise<PublicProfile | null>;

  /**
   * 表示名の部分一致でユーザーを検索する（opt-in ユーザーのみ）。
   */
  searchByDisplayName(query: string, limit?: number): Promise<PublicProfile[]>;
}
