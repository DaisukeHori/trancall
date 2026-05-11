/**
 * TranscriptFacade — 実装
 *
 * 他モジュールはこのファイル経由でしか transcript に触れない。
 * services/ と repositories/ は直接 import 禁止。
 */

import {
  type Result,
  type ResultOf,
  type RoomId,
  type UserId,
  ok,
  err,
  validate,
} from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";
import {
  type TranscriptSegment,
  type LiveSubtitleDelta,
  LiveSubtitleDeltaSchema,
  FullTranscriptSchema,
} from "./schemas.js";
import type { FullTranscript } from "./schemas.js";
import type { SegmentRepository } from "./repositories/segment-repository.js";
import type { AccessRepository } from "./repositories/access-repository.js";
import { createSegmentService } from "./services/segment-service.js";
import { createAccessService } from "./services/access-service.js";
import { createSearchService } from "./services/search-service.js";
import { createExportService, type ExportFormat } from "./services/export-service.js";

export interface TranscriptFacade {
  /**
   * final segment を永続化する（冪等）。
   * UNIQUE(room_id, participant_id, sequence_no) 制約に従いスキップ。
   */
  appendFinalSegment(
    segment: TranscriptSegment,
  ): Promise<Result<true, AppError>>;

  /**
   * Room のトランスクリプト全文を取得する。
   * transcript_access で可視性チェック済みのセグメントのみ返す。
   */
  getTranscript(
    roomId: RoomId,
    userId: UserId,
  ): Promise<ResultOf<typeof FullTranscriptSchema>>;

  /**
   * FTS でセグメントを検索する。
   * 自分が access を持つ Room のみ検索可。
   */
  searchSegments(
    roomId: RoomId,
    userId: UserId,
    query: string,
  ): Promise<Result<TranscriptSegment[], AppError>>;

  /**
   * 自分の transcript_access を論理削除する。
   * 相手のアクセスは維持される。
   */
  deleteAccess(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<true, AppError>>;

  /**
   * トランスクリプトをエクスポートする（Sprint 2 実装予定）。
   * 現状は常に TRANSCRIPT_EXPORT_NOT_IMPLEMENTED を返す。
   */
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: ExportFormat,
  ): Promise<Result<{ contentBase64: string; mime: string }, AppError>>;

  /**
   * LiveSubtitleDelta をバリデーションする。
   * mobile 側の incoming delta バリデーション用。
   */
  validateLiveDelta(
    rawDelta: unknown,
  ): Result<LiveSubtitleDelta, AppError>;
}

export function createTranscriptFacade(
  segmentRepo: SegmentRepository,
  accessRepo: AccessRepository,
): TranscriptFacade {
  const segmentService = createSegmentService(segmentRepo);
  const accessService = createAccessService(accessRepo);
  const searchService = createSearchService(segmentRepo, accessRepo);
  const exportService = createExportService();

  return {
    appendFinalSegment: async (segment: TranscriptSegment) => {
      return segmentService.appendFinalSegment(segment);
    },

    getTranscript: async (roomId: RoomId, userId: UserId) => {
      // アクセス権チェック
      const canViewResult = await accessService.canView(roomId, userId);
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

      // セグメント取得
      const segmentsResult = await segmentRepo.findByRoomId(roomId);
      if (!segmentsResult.ok) {
        return segmentsResult;
      }

      const segments = segmentsResult.data;

      // 参加者数を重複排除で計算
      const participantIds = new Set(
        segments.map((s) => s.participantId),
      );

      // duration: 最後の end_time_ms / 1000 (秒単位)
      const duration =
        segments.length > 0
          ? Math.max(...segments.map((s) => s.endTimeMs)) / 1000
          : 0;

      const fullTranscript: FullTranscript = {
        roomId,
        segments,
        duration,
        participantCount: participantIds.size,
        generatedAt: new Date().toISOString(),
      };

      return validate(FullTranscriptSchema, fullTranscript);
    },

    searchSegments: async (
      roomId: RoomId,
      userId: UserId,
      query: string,
    ) => {
      return searchService.searchSegments(roomId, userId, query);
    },

    deleteAccess: async (roomId: RoomId, userId: UserId) => {
      return accessService.deleteAccess(roomId, userId);
    },

    exportTranscript: async (
      roomId: RoomId,
      userId: UserId,
      format: ExportFormat,
    ) => {
      return exportService.exportTranscript(roomId, userId, format);
    },

    validateLiveDelta: (rawDelta: unknown) => {
      const parsed = LiveSubtitleDeltaSchema.safeParse(rawDelta);
      if (parsed.success) {
        return ok(parsed.data);
      }
      return err({
        code: "VALIDATION_ERROR",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
        retryable: false,
        details: { issues: parsed.error.issues },
      });
    },
  };
}
