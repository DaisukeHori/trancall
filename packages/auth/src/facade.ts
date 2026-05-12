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
 *
 * [Sprint 2 D7] 同意管理メソッド追加:
 * - recordConsent / hasConsent / revokeConsent / getRequiredConsents
 * - docs/module-contracts.md v1.3 §2.1 が canonical
 */

import {
  type Result,
  type UserId,
  type ConsentScope,
  type ConsentRecord,
  type LegalDocumentVersion,
  type RequiredConsentView,
  ok,
  err,
} from "@trancall/shared-kernel";

import { type Profile, ProfileSchema } from "./schemas.js";

// =============================================================================
// Repository インターフェース
// =============================================================================

/**
 * Profile ストレージの抽象。
 * 本番では Supabase REST/RPC、テストでは in-memory が入る。
 */
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile>>;
}

/**
 * 同意レコードストレージの抽象。
 * docs/module-contracts.md v1.3 §2.1 の ConsentRepository 契約。
 */
export interface ConsentRepository {
  upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>>;
  findActive(userId: UserId, scope: ConsentScope): Promise<Result<ConsentRecord | null>>;
  revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>>;
}

/**
 * 規約ドキュメントバージョンストレージの抽象。
 * docs/module-contracts.md v1.3 §2.1 の LegalDocumentVersionRepository 契約。
 */
export interface LegalDocumentVersionRepository {
  findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion>>;
  findAllLatest(): Promise<Result<LegalDocumentVersion[]>>;
}

/**
 * EventBus の narrowed interface (auth facade が使う範囲のみ)。
 * auth.consent_recorded / auth.consent_revoked を publish する。
 * EventBus.publish は DomainEvent 全体を受け取るため、broader 型で定義して構造的互換性を確保する。
 */
export interface AuthEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapters/* ではなく facade 境界、構造互換のため許可
  publish(event: { type: string; payload?: unknown }): Promise<void>;
}

// =============================================================================
// AuthFacade インターフェース
// =============================================================================

export interface AuthFacade {
  // Sprint 1 既存
  getProfile: (userId: UserId) => Promise<Result<Profile>>;

  // [Sprint 2 D7] 同意管理
  recordConsent(
    userId: UserId,
    scope: ConsentScope,
    version: string,
    source: ConsentRecord["source"],
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<Result<ConsentRecord>>;

  hasConsent(
    userId: UserId,
    scope: ConsentScope,
    requiredVersion: string,
  ): Promise<Result<boolean>>;

  revokeConsent(
    userId: UserId,
    scope: ConsentScope,
  ): Promise<Result<true>>;

  getRequiredConsents(
    userId: UserId,
  ): Promise<Result<RequiredConsentView[]>>;
}

// =============================================================================
// 依存注入オプション
// =============================================================================

export interface AuthFacadeOptions {
  profileRepo: ProfileRepository;
  consentRepo: ConsentRepository;
  legalDocRepo: LegalDocumentVersionRepository;
  eventBus: AuthEventBus;
}

// =============================================================================
// Factory
// =============================================================================

/** 取消不可の scope (legal_terms / privacy_policy) */
const IRREVOCABLE_SCOPES: ReadonlySet<ConsentScope> = new Set([
  "legal_terms",
  "privacy_policy",
]);

export function createAuthFacade(options: AuthFacadeOptions): AuthFacade {
  const { profileRepo, consentRepo, legalDocRepo, eventBus } = options;

  return {
    // =========================================================================
    // getProfile
    // =========================================================================
    async getProfile(userId: UserId): Promise<Result<Profile>> {
      const result = await profileRepo.findByUserId(userId);
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
    // recordConsent
    // =========================================================================
    async recordConsent(
      userId: UserId,
      scope: ConsentScope,
      version: string,
      source: ConsentRecord["source"],
      metadata?: { ipAddress?: string; userAgent?: string },
    ): Promise<Result<ConsentRecord>> {
      const recordedAt = new Date().toISOString();

      const record: Omit<ConsentRecord, "id"> = {
        userId,
        scope,
        version,
        recordedAt,
        revokedAt: null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        source,
      };

      const result = await consentRepo.upsert(record);
      if (!result.ok) return result;

      // EventBus に publish (best-effort)
      await eventBus.publish({
        type: "auth.consent_recorded",
        payload: {
          userId,
          scope,
          version,
          recordedAt,
        },
      }).catch(() => {
        // publish 失敗はログのみ (同意記録自体は成功扱い)
      });

      return ok(result.data);
    },

    // =========================================================================
    // hasConsent
    // =========================================================================
    async hasConsent(
      userId: UserId,
      scope: ConsentScope,
      requiredVersion: string,
    ): Promise<Result<boolean>> {
      const result = await consentRepo.findActive(userId, scope);
      if (!result.ok) return result;

      const record = result.data;
      if (!record) return ok(false);
      if (record.revokedAt !== null) return ok(false);

      return ok(record.version === requiredVersion);
    },

    // =========================================================================
    // revokeConsent
    // =========================================================================
    async revokeConsent(
      userId: UserId,
      scope: ConsentScope,
    ): Promise<Result<true>> {
      if (IRREVOCABLE_SCOPES.has(scope)) {
        return err({
          code: "AUTH_CONSENT_IRREVOCABLE",
          message: `scope "${scope}" は取消不可です。アカウント削除フローを使用してください。`,
          retryable: false,
        });
      }

      const result = await consentRepo.revoke(userId, scope);
      if (!result.ok) return result;

      const revokedAt = new Date().toISOString();
      await eventBus.publish({
        type: "auth.consent_revoked",
        payload: {
          userId,
          scope,
          revokedAt,
        },
      }).catch(() => {
        // best-effort
      });

      return ok(true);
    },

    // =========================================================================
    // getRequiredConsents
    // =========================================================================
    async getRequiredConsents(
      userId: UserId,
    ): Promise<Result<RequiredConsentView[]>> {
      // 全 scope の最新バージョンを取得
      const latestResult = await legalDocRepo.findAllLatest();
      if (!latestResult.ok) return latestResult;

      const views: RequiredConsentView[] = [];

      for (const doc of latestResult.data) {
        const activeResult = await consentRepo.findActive(userId, doc.scope);
        if (!activeResult.ok) return activeResult;

        const record = activeResult.data;
        const userVersion = record && record.revokedAt === null ? record.version : null;
        const isUpToDate = userVersion === doc.version;

        views.push({
          scope: doc.scope,
          currentVersion: doc.version,
          userVersion,
          isRequired: IRREVOCABLE_SCOPES.has(doc.scope) || doc.scope === "voice_to_openai",
          isUpToDate,
          documentUrl: doc.documentUrl,
        });
      }

      return ok(views);
    },
  };
}
