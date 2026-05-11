/**
 * Auth モジュールの外部公開ファサード
 *
 * 他モジュール（media, room など）は **このファイル経由でしか auth に触れない**。
 * 直接 supabase-js を呼び出すと、Supabase 依存が漏れる + テストが書きにくくなる。
 *
 * C-005 対応の中核:
 * - `getProfile(userId)` は media モジュールが LiveKit Token 発行時に呼ぶ
 * - クライアントから受け取った `nativeLanguage` は **使わない**（信頼しない）
 * - DB の `profiles.native_language` を真実のソースとして metadata に焼き込む
 */

import {
  type Result,
  type UserId,
  type AppError,
  ok,
  err,
} from "@trancall/shared-kernel";

import { type Profile, ProfileSchema } from "./schemas.js";

/**
 * Profile ストレージの抽象。
 * 本番では Supabase REST/RPC、テストでは in-memory が入る。
 */
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile, AppError>>;
}

export interface AuthFacade {
  getProfile: (userId: UserId) => Promise<Result<Profile, AppError>>;
}

export function createAuthFacade(repo: ProfileRepository): AuthFacade {
  return {
    getProfile: async (userId: UserId) => {
      const result = await repo.findByUserId(userId);
      if (!result.ok) {
        return result;
      }
      // 保険: ストレージから読んだものも改めてバリデーション
      // （DB スキーマと TS 型がずれた場合の安全網）
      const parsed = ProfileSchema.safeParse(result.data);
      if (!parsed.success) {
        return err({
          code: "auth.profile.invalid_schema",
          message: "プロフィールデータがスキーマと不整合です",
          retryable: false,
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }
      return ok(parsed.data);
    },
  };
}
