/**
 * TranslationUsage 算出サービス
 *
 * TranslationSessionRecord から TranslationUsage を計算する。
 * billableSeconds = ceil(durationMs / 1000)
 */

import { RoomIdSchema, ParticipantIdSchema, validate } from "@trancall/shared-kernel";

import { TranslationSessionRecordSchema, TranslationUsageSchema } from "../schemas.ts";
import type { TranslationSessionRecord, TranslationUsage } from "../schemas.ts";
import type { Result } from "@trancall/shared-kernel";

/**
 * durationMs から billableSeconds を算出する。
 * OpenAI 課金単位: 秒単位切り上げ。
 */
export function calcBillableSeconds(durationMs: number): number {
  return Math.ceil(durationMs / 1000);
}

/**
 * 終了済みセッションレコードから TranslationUsage を生成する。
 * endedAt / durationMs / billableSeconds / reason が null の場合は VALIDATION_ERROR を返す。
 */
export function calcUsageFromRecord(
  record: TranslationSessionRecord,
): Result<TranslationUsage> {
  if (
    record.endedAt === null ||
    record.durationMs === null ||
    record.billableSeconds === null ||
    record.reason === null
  ) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "セッションがまだ終了していません",
        retryable: false,
      },
    };
  }

  const roomResult = RoomIdSchema.safeParse(record.roomId);
  if (!roomResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `roomId が不正: ${record.roomId}`,
        retryable: false,
      },
    };
  }

  const participantResult = ParticipantIdSchema.safeParse(record.sourceParticipantId);
  if (!participantResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `sourceParticipantId が不正: ${record.sourceParticipantId}`,
        retryable: false,
      },
    };
  }

  return validate(TranslationUsageSchema, {
    sessionId: record.id,
    roomId: roomResult.data,
    sourceParticipantId: participantResult.data,
    outputLanguage: record.outputLanguage,
    durationMs: record.durationMs,
    billableSeconds: record.billableSeconds,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    reason: record.reason,
  });
}

// re-export for convenience
export { TranslationSessionRecordSchema };
