/**
 * SegmentRepository — interface
 *
 * Supabase 実装は apps/server 側で DI 注入する。
 * テストでは in-memory stub を使う。
 */

import type { Result } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";
import type { RoomId, ParticipantId } from "@trancall/shared-kernel";
import type { TranscriptSegment } from "../schemas.js";

export interface SegmentRepository {
  /**
   * final segment を upsert する。
   * UNIQUE(room_id, participant_id, sequence_no) 制約に従い冪等に動作する。
   * 同一 sequence_no が既に存在する場合は INSERT をスキップして ok(true) を返す。
   */
  upsert(segment: TranscriptSegment): Promise<Result<true, AppError>>;

  /**
   * 指定 Room の全 segment を start_time_ms 昇順で返す。
   * transcript_access の可視性チェックは呼び出し側（サービス層）で行う。
   */
  findByRoomId(roomId: RoomId): Promise<Result<TranscriptSegment[], AppError>>;

  /**
   * 同一参加者の次の sequence_no を返す。
   * (room_id, participant_id) 単位で現在の最大 sequence_no + 1 を返す。
   * レコードが存在しない場合は 0 を返す。
   */
  getNextSequenceNo(
    roomId: RoomId,
    participantId: ParticipantId,
  ): Promise<Result<number, AppError>>;

  /**
   * FTS（PostgreSQL to_tsvector）を使ってセグメントを検索する。
   * query は呼び出し側でエスケープ済みであること。
   */
  searchByFts(
    roomId: RoomId,
    query: string,
  ): Promise<Result<TranscriptSegment[], AppError>>;
}
