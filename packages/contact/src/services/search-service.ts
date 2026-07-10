/**
 * SearchService — ユーザー検索ドメインサービス
 */

import type { UserId } from "@trancall/shared-kernel";
import type { PublicProfile } from "../schemas";
import type { ProfileSearchRepository } from "../repositories/profile-search-repository";
import type { BlockRepository } from "../repositories/block-repository";

export interface SearchService {
  /**
   * TranCall ID / 名前でユーザーを検索する。
   * - TranCall ID は完全一致
   * - 表示名は部分一致（opt-in ユーザーのみ）
   * - 自分自身を除外
   * - ブロック済みユーザーを除外（双方向）
   *
   * NOTE: Rate limit は本 facade では実装しない。
   *   docs/security-detail.md より、`GET /api/contacts/search` には
   *   **10 req/min/user** のレート制限が要求される。
   *   実際の rate limit は server (Layer 3) のミドルウェア層で実装すること。
   */
  searchUsers(
    query: string,
    callerId: UserId,
  ): Promise<PublicProfile[]>;
}

export function createSearchService(
  profileSearchRepo: ProfileSearchRepository,
  blockRepo: BlockRepository,
): SearchService {
  return {
    searchUsers: async (
      query: string,
      callerId: UserId,
    ): Promise<PublicProfile[]> => {
      // クエリが空の場合は空配列を返す
      if (query.trim().length === 0) {
        return [];
      }

      const [exactMatch, partialMatches, blockedUserIds] = await Promise.all([
        profileSearchRepo.findByTrancallId(query),
        profileSearchRepo.searchByDisplayName(query),
        blockRepo.getBlockedUserIds(callerId),
      ]);

      // 結果を統合し重複を排除
      const seen = new Set<string>();
      const results: PublicProfile[] = [];

      const candidates: PublicProfile[] = [];
      if (exactMatch !== null) {
        candidates.push(exactMatch);
      }
      for (const p of partialMatches) {
        candidates.push(p);
      }

      for (const profile of candidates) {
        // 自分自身を除外
        if (profile.userId === callerId) {
          continue;
        }
        // ブロック済みを除外
        if (blockedUserIds.has(profile.userId)) {
          continue;
        }
        // 重複除外
        if (seen.has(profile.userId)) {
          continue;
        }
        seen.add(profile.userId);
        results.push(profile);
      }

      return results;
    },
  };
}
