/**
 * ExportService — Sprint 2 実装予定の stub
 *
 * 現在は TRANSCRIPT_EXPORT_NOT_IMPLEMENTED エラーを返すのみ。
 * Sprint 2 で PDF/TXT 生成ロジックを実装する。
 */

import { type Result, err } from "@trancall/shared-kernel";
import type { RoomId, UserId } from "@trancall/shared-kernel";

export type ExportFormat = "pdf" | "txt";

export interface ExportResult {
  contentBase64: string;
  mime: string;
}

export interface ExportService {
  /**
   * トランスクリプトをエクスポートする。
   * Sprint 2 実装予定。現状は常に TRANSCRIPT_EXPORT_NOT_IMPLEMENTED を返す。
   */
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: ExportFormat,
  ): Promise<Result<ExportResult>>;
}

export function createExportService(): ExportService {
  return {
    exportTranscript: async (
      _roomId: RoomId,
      _userId: UserId,
      _format: ExportFormat,
    ) => {
      return err({
        code: "TRANSCRIPT_EXPORT_NOT_IMPLEMENTED",
        message: "エクスポート機能は Sprint 2 で実装予定です",
        retryable: false,
        httpStatus: 501,
      });
    },
  };
}
