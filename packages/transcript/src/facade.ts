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
import { createExportService, type ExportFormat, type ExportInput, type RoomMeta } from "./services/export-service.js";

/**
 * roomId / userId から room メタ情報を解決するプロバイダ。
 * apps/server 側で Supabase クエリ実装を DI 注入する。
 * テストでは in-memory stub を使う。
 */
export interface RoomMetaProvider {
  getRoomMeta(roomId: RoomId, userId: UserId): Promise<Result<RoomMeta>>;
}

export interface TranscriptFacade {
  /**
   * final segment を永続化する（冪等）。
   * UNIQUE(room_id, participant_id, sequence_no) 制約に従いスキップ。
   */
  appendFinalSegment(
    segment: TranscriptSegment,
  ): Promise<Result<true>>;

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
  ): Promise<Result<TranscriptSegment[]>>;

  /**
   * 自分の transcript_access を論理削除する。
   * 相手のアクセスは維持される。
   */
  deleteAccess(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<true>>;

  /**
   * トランスクリプトをエクスポートする。
   * transcript-export-spec.md (TRANSCRIPT-EXPORT-001) 準拠。
   */
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: ExportFormat,
  ): Promise<Result<{ contentBase64: string; mime: string; filename: string }>>;

  /**
   * LiveSubtitleDelta をバリデーションする。
   * mobile 側の incoming delta バリデーション用。
   */
  validateLiveDelta(
    rawDelta: unknown,
  ): Result<LiveSubtitleDelta>;
}

export function createTranscriptFacade(
  segmentRepo: SegmentRepository,
  accessRepo: AccessRepository,
  roomMetaProvider?: RoomMetaProvider,
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
      // アクセス権チェック
      const canViewResult = await accessService.canView(roomId, userId);
      if (!canViewResult.ok) {
        return canViewResult;
      }
      if (!canViewResult.data) {
        return err({
          code: "TRANSCRIPT_EXPORT_FORBIDDEN",
          message: "このトランスクリプトへのエクスポート権限がありません",
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

      // 空チェック
      if (segments.length === 0) {
        return err({
          code: "TRANSCRIPT_EXPORT_EMPTY",
          message: "録音された会話がありません",
          retryable: false,
          httpStatus: 422,
        });
      }

      // 上限チェック (Phase 1a: 1000 segments)
      if (segments.length > 1000) {
        return err({
          code: "TRANSCRIPT_EXPORT_TOO_LARGE",
          message: "会話が長すぎます (1000 セグメント超)、分割エクスポートを Sprint 3 で実装予定",
          retryable: false,
          httpStatus: 422,
        });
      }

      // RoomMeta 取得（プロバイダ提供時は使用、未提供時はセグメントから推定）
      let roomMeta: RoomMeta;
      if (roomMetaProvider) {
        const metaResult = await roomMetaProvider.getRoomMeta(roomId, userId);
        if (!metaResult.ok) {
          return metaResult;
        }
        roomMeta = metaResult.data;
      } else {
        // fallback: セグメントから推定（apps/server で roomMetaProvider なしにテスト使用時）
        const speakerNames = [...new Set(segments.map((s) => s.speakerName))];
        const myName = speakerNames[0] ?? "Unknown";
        const otherNames = speakerNames.slice(1);
        const langPairs = [...new Set(segments.map((s) => s.languagePair))];
        const firstSegCreatedAt = segments[0]?.createdAt ?? new Date().toISOString();

        roomMeta = {
          roomId,
          createdAt: firstSegCreatedAt,
          endedAt: null,
          myName,
          otherNames,
          languagePairs: langPairs,
        };
      }

      // TODO(Sprint 3 T-6 後): T-2 で追加された trancall_auth.consent_versions テーブルから現行バージョンを取得し置き換える
      // 現状 hardcode は Phase 1a のドラフト法務文書 (legal-and-consent.md §5.3 v2026-05-12) に対応していない
      // AuthFacade.getRequiredConsents() 等経由で DB から取得すること
      const exportInput: ExportInput = {
        roomMeta,
        segments,
        termsVersion: "1.0.0",
        privacyVersion: "1.0.0",
      };

      return exportService.exportTranscript(exportInput, format);
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
