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
  ok,
  err,
} from "@trancall/shared-kernel";

import { type Profile, ProfileSchema } from "./schemas.js";

// =============================================================================
// Sprint 3 拡張: 同意 (Consent) 関連型
// legal-and-consent.md §3 に基づく
// =============================================================================

/** 同意の種別 (legal-and-consent.md §3.1 ConsentScopeSchema) */
export type ConsentScope =
  | "legal_terms"
  | "privacy_policy"
  | "voice_to_openai"
  | "transcript_retention"
  | "data_deletion_request"
  | "push_notification"
  | "marketing_email";

/** 同意取得のコンテキスト */
export type ConsentSource =
  | "onboarding"
  | "incoming_call_first_time"
  | "settings_screen"
  | "terms_revision_prompt";

/** POST /api/auth/consents リクエストボディ */
export interface RecordConsentCommand {
  scope: ConsentScope;
  version: string;
  source: ConsentSource;
}

/** GET /api/auth/consents レスポンス要素 (legal-and-consent.md §3.4 RequiredConsentView) */
export interface RequiredConsentView {
  scope: ConsentScope;
  currentVersion: string;
  userVersion: string | null;
  isRequired: boolean;
  isUpToDate: boolean;
  documentUrl: string | null;
}

/**
 * Profile ストレージの抽象。
 * 本番では Supabase REST/RPC、テストでは in-memory が入る。
 */
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile>>;
}

export interface AuthFacade {
  getProfile: (userId: UserId) => Promise<Result<Profile>>;

  // =========================================================================
  // Sprint 3 拡張メソッド — 同意管理 (legal-and-consent.md §4)
  // =========================================================================

  /** 同意を記録する */
  recordConsent(userId: UserId, cmd: RecordConsentCommand): Promise<Result<true>>;

  /** ユーザーに必要な同意状態の一覧を取得する */
  getRequiredConsents(userId: UserId): Promise<Result<RequiredConsentView[]>>;

  /** 同意を取り消す */
  revokeConsent(userId: UserId, scope: ConsentScope): Promise<Result<true>>;
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

    // =========================================================================
    // Sprint 3 拡張メソッド スタブ実装
    // =========================================================================

    async recordConsent(_userId: UserId, _cmd: RecordConsentCommand): Promise<Result<true>> {
      return err({
        code: "AUTH_NOT_IMPLEMENTED",
        message: "recordConsent は Sprint 3 後半で実装予定",
        retryable: false,
      });
    },

    async getRequiredConsents(_userId: UserId): Promise<Result<RequiredConsentView[]>> {
      return err({
        code: "AUTH_NOT_IMPLEMENTED",
        message: "getRequiredConsents は Sprint 3 後半で実装予定",
        retryable: false,
      });
    },

    async revokeConsent(_userId: UserId, _scope: ConsentScope): Promise<Result<true>> {
      return err({
        code: "AUTH_NOT_IMPLEMENTED",
        message: "revokeConsent は Sprint 3 後半で実装予定",
        retryable: false,
      });
    },
  };
}
