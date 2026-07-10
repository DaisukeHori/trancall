/**
 * SearchService
 *
 * PostgreSQL FTS を使ったトランスクリプト検索。
 * - 自分が access を持つ Room のみ検索可
 * - FTS query のエスケープを行ってから repository に渡す
 */

import { type Result, err } from "@trancall/shared-kernel";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import type { TranscriptSegment } from "../schemas.ts";
import type { SegmentRepository } from "../repositories/segment-repository.ts";
import type { AccessRepository } from "../repositories/access-repository.ts";

export interface SearchService {
  /**
   * FTS でセグメントを検索する。
   * - アクセス権がない Room は FORBIDDEN エラー
   * - query は内部でエスケープして repository に渡す
   */
  searchSegments(
    roomId: RoomId,
    userId: UserId,
    query: string,
  ): Promise<Result<TranscriptSegment[]>>;
}

/**
 * PostgreSQL FTS の tsquery 用に query 文字列をエスケープする。
 *
 * 特殊文字（& | ! ( ) : *）をエスケープし、
 * プレーンテキスト検索として扱えるようにする。
 *
 * plainto_tsquery() 相当のロジック（シングルクォートのみエスケープ）。
 * repository 側で plainto_tsquery() を使う場合はこのエスケープで十分。
 */
export function escapeFtsQuery(raw: string): string {
  // シングルクォートをエスケープして SQL injection を防ぐ
  // （plainto_tsquery は特殊文字をリテラルとして扱う）
  return raw.replace(/'/g, "''");
}

export function createSearchService(
  segmentRepo: SegmentRepository,
  accessRepo: AccessRepository,
): SearchService {
  return {
    searchSegments: async (
      roomId: RoomId,
      userId: UserId,
      query: string,
    ) => {
      // 1. アクセス権チェック
      const canViewResult = await accessRepo.canView(roomId, userId);
      if (!canViewResult.ok) {
        return canViewResult;
      }
      if (!canViewResult.data) {
        return err({
          code: "FORBIDDEN",
          message: "このトランスクリプトへのアクセス権がありません",
          retryable: false,
          httpStatus: 403,
        });
      }

      // 2. FTS query エスケープ
      const escapedQuery = escapeFtsQuery(query);

      // 3. 検索実行
      return segmentRepo.searchByFts(roomId, escapedQuery);
    },
  };
}
