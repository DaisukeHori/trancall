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
} from "./schemas.ts";
import type { FullTranscript } from "./schemas.ts";
import type { SegmentRepository } from "./repositories/segment-repository.ts";
import type { AccessRepository } from "./repositories/access-repository.ts";
import { createSegmentService } from "./services/segment-service.ts";
import { createAccessService } from "./services/access-service.ts";
import { createSearchService } from "./services/search-service.ts";
import { createExportService, type ExportFormat, type ExportInput, type RoomMeta } from "./services/export-service.ts";

/**
 * M-3: 1 パートあたりの最大セグメント数 (Phase 1a 上限)。
 * これを超える長時間通話は `Math.ceil(totalSegments / MAX_SEGMENTS_PER_EXPORT_PART)`
 * パートに分割してエクスポートする (docs/transcript-export-spec.md §2.1 / §8 参照)。
 */
const MAX_SEGMENTS_PER_EXPORT_PART = 1000;

/**
 * ファイル名にパート番号を挿入する (例: `foo.pdf` → `foo-part2of3.pdf`)。
 * totalParts <= 1 の場合は無加工でそのまま返す (既存の命名規則との後方互換を維持)。
 */
function appendPartSuffix(filename: string, partNumber: number, totalParts: number): string {
  if (totalParts <= 1) return filename;
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return `${filename}-part${partNumber}of${totalParts}`;
  const base = filename.slice(0, lastDot);
  const ext = filename.slice(lastDot);
  return `${base}-part${partNumber}of${totalParts}${ext}`;
}

/**
 * roomId / userId から room メタ情報を解決するプロバイダ。
 * apps/server 側で Supabase クエリ実装を DI 注入する。
 * テストでは in-memory stub を使う。
 */
export interface RoomMetaProvider {
  getRoomMeta(roomId: RoomId, userId: UserId): Promise<Result<RoomMeta>>;
}

/**
 * 法務ドキュメントの現行バージョンを取得するリポジトリの最小インターフェース。
 * auth モジュールへの直接依存を避けるため transcript 内で独自定義する。
 * apps/server/container.ts で LegalDocumentVersionRepository (auth) を注入する。
 * docs/legal-and-consent.md §5.3 / docs/transcript-export-spec.md §7.3
 */
export interface LegalDocVersionRepository {
  findLatest(scope: "legal_terms" | "privacy_policy"): Promise<Result<{ version: string } | null>>;
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
   * Issue #69 (2): 参加者に対する transcript_access を作成する (冪等)。
   * 既存行 (deleteAccess 済みを含む) がある場合は何もしない。
   * `room.participant_joined` を購読する apps/server 側の subscriber から、
   * 通話成立時 (2人目以降の参加) に room の現在の参加者全員分呼ばれる想定
   * (docs/module-contracts.md §3.1)。
   */
  grantAccess(
    roomId: RoomId,
    userId: UserId,
    consentVersion: string,
  ): Promise<Result<true>>;

  /**
   * トランスクリプトをエクスポートする。
   * transcript-export-spec.md (TRANSCRIPT-EXPORT-001) 準拠。
   *
   * M-3: 1000 セグメントを超える長時間通話は複数パートに分割してエクスポートする。
   * `partIndex` (0-based、省略時 0) で取得するパートを指定する。返り値の
   * `totalParts` / `hasMore` / `totalSegments` を見て、`hasMore=true` の間
   * `partIndex` をインクリメントしながら追加で呼び出すことで全パートを取得できる。
   * セグメント数が上限以下の場合は常に `totalParts=1` / `hasMore=false` となり、
   * 既存の単発エクスポート (PDF/txt 1 ファイル) と完全に同じ挙動になる
   * (後方互換: 呼び出し側が partIndex を渡さなくても従来通り動作する)。
   */
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: ExportFormat,
    partIndex?: number,
  ): Promise<
    Result<{
      contentBase64: string;
      mime: string;
      filename: string;
      /** 0-based。今回返したパートの番号 */
      partIndex: number;
      /** 総パート数 (1 = 分割不要) */
      totalParts: number;
      /** true の場合、partIndex+1 で追加のパートが取得できる */
      hasMore: boolean;
      /** room 全体のセグメント総数 (パート分割前) */
      totalSegments: number;
    }>
  >;

  /**
   * LiveSubtitleDelta をバリデーションする。
   * mobile 側の incoming delta バリデーション用。
   */
  validateLiveDelta(
    rawDelta: unknown,
  ): Result<LiveSubtitleDelta>;
}

/** createTranscriptFacade に渡す依存オブジェクト */
export interface TranscriptFacadeDeps {
  segmentRepo: SegmentRepository;
  accessRepo: AccessRepository;
  roomMetaProvider?: RoomMetaProvider;
  /**
   * 法務ドキュメントバージョンリポジトリ (optional)。
   * 注入時は exportTranscript の termsVersion / privacyVersion を DB から取得する。
   * 未注入時は "unknown" にフォールバックする。
   * docs/legal-and-consent.md §5.3 / docs/transcript-export-spec.md §7.3
   */
  legalDocVersionRepo?: LegalDocVersionRepository;
}

export function createTranscriptFacade(
  segmentRepo: SegmentRepository,
  accessRepo: AccessRepository,
  roomMetaProvider?: RoomMetaProvider,
  legalDocVersionRepo?: LegalDocVersionRepository,
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

    grantAccess: async (roomId: RoomId, userId: UserId, consentVersion: string) => {
      return accessService.grantAccess(roomId, userId, consentVersion);
    },

    exportTranscript: async (
      roomId: RoomId,
      userId: UserId,
      format: ExportFormat,
      partIndex?: number,
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

      // M-3: 1000 セグメント超は複数パートに分割する (旧: TOO_LARGE ハードエラー)。
      // セグメント数が上限以下なら totalParts=1 で従来と完全に同じ単発エクスポート。
      const totalSegments = segments.length;
      const totalParts = Math.max(1, Math.ceil(totalSegments / MAX_SEGMENTS_PER_EXPORT_PART));
      const requestedPartIndex = partIndex ?? 0;

      if (
        !Number.isInteger(requestedPartIndex) ||
        requestedPartIndex < 0 ||
        requestedPartIndex >= totalParts
      ) {
        return err({
          code: "TRANSCRIPT_EXPORT_INVALID_PART",
          message: `partIndex は 0〜${totalParts - 1} の範囲で指定してください (指定値: ${requestedPartIndex})`,
          retryable: false,
          httpStatus: 400,
        });
      }

      const partStart = requestedPartIndex * MAX_SEGMENTS_PER_EXPORT_PART;
      const partSegments = segments.slice(partStart, partStart + MAX_SEGMENTS_PER_EXPORT_PART);

      // RoomMeta 取得（プロバイダ提供時は使用、未提供時はセグメントから推定）。
      // 話者名・翻訳ペアの推定は room 全体の segments を使う (パートごとに変わらないため)。
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

      // termsVersion / privacyVersion を DB から取得する。
      // legalDocVersionRepo が注入されている場合は DB から取得し、
      // 未注入またはレコード不在の場合は "unknown" にフォールバックする。
      // docs/legal-and-consent.md §5.3 / docs/transcript-export-spec.md §7.3
      let termsVersion = "unknown";
      let privacyVersion = "unknown";
      if (legalDocVersionRepo) {
        const [termsResult, privacyResult] = await Promise.all([
          legalDocVersionRepo.findLatest("legal_terms"),
          legalDocVersionRepo.findLatest("privacy_policy"),
        ]);
        if (termsResult.ok && termsResult.data !== null) {
          termsVersion = termsResult.data.version;
        }
        if (privacyResult.ok && privacyResult.data !== null) {
          privacyVersion = privacyResult.data.version;
        }
      }

      const exportInput: ExportInput = {
        roomMeta,
        segments: partSegments,
        termsVersion,
        privacyVersion,
      };

      const exportResult = await exportService.exportTranscript(exportInput, format);
      if (!exportResult.ok) {
        return exportResult;
      }

      const filename = appendPartSuffix(
        exportResult.data.filename,
        requestedPartIndex + 1,
        totalParts,
      );

      return ok({
        ...exportResult.data,
        filename,
        partIndex: requestedPartIndex,
        totalParts,
        hasMore: requestedPartIndex + 1 < totalParts,
        totalSegments,
      });
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
