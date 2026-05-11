/**
 * SegmentService
 *
 * final segment の永続化を担当する。
 * - UNIQUE(room_id, participant_id, sequence_no) の冪等 INSERT
 * - retention_until は呼び出し元から受け取る（billing プランに依存するため）
 */

import { type Result, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";
import type { TranscriptSegment } from "../schemas.js";
import { TranscriptSegmentSchema } from "../schemas.js";
import type { SegmentRepository } from "../repositories/segment-repository.js";

export interface SegmentService {
  /**
   * final segment を永続化する。
   * - Zod バリデーション後に repository.upsert() を呼ぶ
   * - 同一 sequence_no が既存の場合は repository 側でスキップ（冪等）
   */
  appendFinalSegment(
    rawSegment: unknown,
  ): Promise<Result<true, AppError>>;
}

export function createSegmentService(
  repo: SegmentRepository,
): SegmentService {
  return {
    appendFinalSegment: async (rawSegment: unknown) => {
      // 入力バリデーション
      const parsed = TranscriptSegmentSchema.safeParse(rawSegment);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
            retryable: false,
            details: { issues: parsed.error.issues },
          },
        };
      }

      const segment: TranscriptSegment = parsed.data;
      return repo.upsert(segment);
    },
  };
}

// --- SequenceNo 採番ロジック ---
// segment-service 経由で使うユーティリティ。
// 同一 (room_id, participant_id) の次の sequence_no を取得する。

export interface SequenceNoProvider {
  getNextSequenceNo(
    repo: SegmentRepository,
    roomId: TranscriptSegment["roomId"],
    participantId: TranscriptSegment["participantId"],
  ): Promise<Result<number, AppError>>;
}

export function createSequenceNoProvider(): SequenceNoProvider {
  return {
    getNextSequenceNo: async (repo, roomId, participantId) => {
      return repo.getNextSequenceNo(roomId, participantId);
    },
  };
}

// --- RetentionUntil 計算ユーティリティ ---
// プランごとの保持期限を計算する。
// billing モジュールには依存せず、日数のみ受け取る。

export function calcRetentionUntil(
  retentionDays: number,
  now: Date = new Date(),
): string {
  const d = new Date(now);
  d.setDate(d.getDate() + retentionDays);
  return d.toISOString();
}

// プランごとの保持日数（billing モジュール非依存）
export const RETENTION_DAYS = {
  free: 7,
  light: 30,
  standard: 90,
  business: 365,
} as const satisfies Record<string, number>;

export type PlanTierKey = keyof typeof RETENTION_DAYS;

/**
 * プラン名から retention_until を計算して返す。
 * billing モジュールへの依存を排除するため、単純な switch として実装。
 */
export function calcRetentionUntilByPlan(
  planTier: PlanTierKey,
  now: Date = new Date(),
): Result<string, AppError> {
  const days = RETENTION_DAYS[planTier];
  return ok(calcRetentionUntil(days, now));
}
