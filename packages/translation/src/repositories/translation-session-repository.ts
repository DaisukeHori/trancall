/**
 * Translation Session リポジトリ インターフェース
 *
 * Server 側の translation_sessions テーブルに対する操作。
 * 実装は apps/server のインフラ層で提供する（Supabase）。
 */

import type { Result } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

import type { TranslationSessionRecord } from "../schemas.js";

export interface TranslationSessionRepository {
  /**
   * セッション開始を永続化する。
   * agentJobId で冪等化（重複 INSERT は無視）。
   */
  insert: (
    record: Omit<TranslationSessionRecord, "endedAt" | "durationMs" | "billableSeconds" | "reason" | "createdAt"> & {
      endedAt: null;
      durationMs: null;
      billableSeconds: null;
      reason: null;
    },
  ) => Promise<Result<TranslationSessionRecord, AppError>>;

  /**
   * セッション終了を記録する。
   * agentJobId で検索して update。
   */
  updateEnded: (
    agentJobId: string,
    update: {
      endedAt: string;
      durationMs: number;
      billableSeconds: number;
      reason: TranslationSessionRecord["reason"];
    },
  ) => Promise<Result<TranslationSessionRecord, AppError>>;

  /**
   * agentJobId でセッションを取得する。
   */
  findByAgentJobId: (
    agentJobId: string,
  ) => Promise<Result<TranslationSessionRecord | null, AppError>>;
}
