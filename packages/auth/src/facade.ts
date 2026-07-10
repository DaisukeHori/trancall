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
 * [Sprint 2 D7 拡張] 同意管理 4 メソッド追加:
 * - recordConsent / hasConsent / revokeConsent / getRequiredConsents
 * - canonical: docs/legal-and-consent.md v1.2 §4 / docs/module-contracts.md v1.3 §2.1
 */

import {
  type Result,
  type UserId,
  ok,
  err,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type ConsentRecord,
  type LegalDocumentVersion,
  type RequiredConsentView,
} from "@trancall/shared-kernel";

import { type Profile, ProfileSchema } from "./schemas.ts";
import { type ConsentRepository } from "./repositories/consent-repository.ts";
import { type LegalDocumentVersionRepository } from "./repositories/legal-document-version-repository.ts";
import {
  type AuthConsentRecordedEvent,
  type AuthConsentRevokedEvent,
} from "./events.ts";

// ============================================================
// Repository interfaces (再 export)
// ============================================================

/**
 * Profile ストレージの抽象。
 * 本番では Supabase REST/RPC、テストでは in-memory が入る。
 */
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile>>;
}

export type { ConsentRepository } from "./repositories/consent-repository.ts";
export type { LegalDocumentVersionRepository } from "./repositories/legal-document-version-repository.ts";

// ============================================================
// EventBus narrowed interface (auth モジュール用)
// ============================================================

/**
 * auth モジュールが publish に使う EventBus の narrowed interface。
 * Interface Segregation: auth は自身が発行するイベント型のみを知る。
 * Layer 3 server の統合 EventBus 実装がこの interface を満たす。
 */
export interface AuthEventBus {
  publish(event: AuthConsentRecordedEvent | AuthConsentRevokedEvent): Promise<void>;
}

// ============================================================
// UUID 生成ヘルパー (node:crypto / globalThis.crypto 非依存)
// ============================================================

/**
 * RFC 4122 v4 UUID を生成する。
 * `@types/node` がなくても動作するように Math.random ベースで実装する。
 * 監査証跡用途のため暗号強度は不要。
 */
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================
// 取消不可 scope の定義
// ============================================================

const IRREVOCABLE_SCOPES: ReadonlySet<ConsentScope> = new Set<ConsentScope>([
  "legal_terms",
  "privacy_policy",
]);

// ============================================================
// AuthFacade interface
// ============================================================

export interface AuthFacade {
  // ─────────────────────────────────────────────────────────
  // 既存メソッド (module-contracts.md §2.1)
  // ─────────────────────────────────────────────────────────

  /** プロフィール取得 (C-005 対応: media module が Token metadata 焼き込み時に呼ぶ) */
  getProfile(userId: UserId): Promise<Result<Profile>>;

  // ─────────────────────────────────────────────────────────
  // [新規 Sprint 2 D7] 同意管理メソッド
  // ─────────────────────────────────────────────────────────

  /**
   * 同意を記録する。
   *
   * @param userId   同意したユーザー
   * @param scope    同意の種別
   * @param version  同意したドキュメントバージョン (YYYY-MM-DD)
   * @param source   同意が取得された文脈
   * @param metadata オプション: IP アドレス / User-Agent (監査証跡)
   * @returns        作成された ConsentRecord
   *
   * **冪等性**: 同一 (userId, scope, version) が既存の場合、既存レコードを返す。
   * **副作用**: `auth.consent_recorded` DomainEvent を EventBus に発行する。
   * **retry**: 可 (冪等)。
   */
  recordConsent(
    userId: UserId,
    scope: ConsentScope,
    version: string,
    source: ConsentRecord["source"],
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<Result<ConsentRecord>>;

  /**
   * 指定 scope について、requiredVersion に同意済みかチェックする。
   *
   * @returns { ok: true, data: true }  → 同意済み (requiredVersion と一致)
   * @returns { ok: true, data: false } → 未同意 または バージョン不一致
   *
   * **冪等性**: 読み取り専用。副作用なし。
   * **判定条件**: revokedAt IS NULL AND version === requiredVersion
   */
  hasConsent(
    userId: UserId,
    scope: ConsentScope,
    requiredVersion: string,
  ): Promise<Result<boolean>>;

  /**
   * 指定 scope の同意を取り消す。
   *
   * 取消不可 scope (legal_terms / privacy_policy) を渡した場合は
   * `AUTH_CONSENT_IRREVOCABLE` エラー (422) を返す。
   *
   * **副作用**:
   * - DB: `user_consents.revoked_at` に現在時刻をセット
   * - `auth.consent_revoked` DomainEvent を EventBus に発行
   * **retry**: 可 (既取消済みの場合は ok: true を返す)。
   */
  revokeConsent(
    userId: UserId,
    scope: ConsentScope,
  ): Promise<Result<true>>;

  /**
   * ユーザーが同意すべき scope 一覧と現在の状態を返す。
   *
   * mobile はアプリ起動時・通話前・Settings 表示時にこのメソッドを呼び、
   * 必要な同意画面を表示するかどうかを判断する。
   *
   * @returns RequiredConsentView[] — isRequired=true かつ isUpToDate=false の
   *          scope が存在すれば Consent Screen を表示する。
   *
   * **実装**: LegalDocumentVersionRepository.findAllLatest() と
   *           ConsentRepository.listActive(userId) を突き合わせて構築する。
   * **ソート**: isRequired=true を先頭に。
   * **除外**: data_deletion_request は通常一覧に含めない（退会フロー専用）。
   * **冪等性**: 読み取り専用。副作用なし。
   */
  getRequiredConsents(
    userId: UserId,
  ): Promise<Result<RequiredConsentView[]>>;
}

// ============================================================
// scope 別の設定 (canonical: legal-and-consent.md §5.1)
// ============================================================

interface ScopeConfig {
  isRequired: boolean;
  /** getRequiredConsents 一覧から除外するか */
  excludeFromList: boolean;
}

const SCOPE_CONFIG: Record<ConsentScope, ScopeConfig> = {
  legal_terms: { isRequired: true, excludeFromList: false },
  privacy_policy: { isRequired: true, excludeFromList: false },
  voice_to_openai: { isRequired: true, excludeFromList: false },
  transcript_retention: { isRequired: false, excludeFromList: false },
  data_deletion_request: { isRequired: true, excludeFromList: true }, // 退会フロー専用
  push_notification: { isRequired: false, excludeFromList: false },
  marketing_email: { isRequired: false, excludeFromList: false },
};

// ============================================================
// Factory
// ============================================================

export interface CreateAuthFacadeOptions {
  profileRepo: ProfileRepository;
  consentRepo?: ConsentRepository;
  legalDocRepo?: LegalDocumentVersionRepository;
  eventBus?: AuthEventBus;
}

/**
 * AuthFacade の factory 関数。
 *
 * consentRepo / legalDocRepo / eventBus を省略すると、
 * 同意管理メソッドは AUTH_CONSENT_NOT_CONFIGURED エラーを返す。
 * (後方互換のため: Sprint 1 まで consentRepo 不要だった)
 */
export function createAuthFacade(
  repoOrOptions: ProfileRepository | CreateAuthFacadeOptions,
): AuthFacade {
  // 後方互換: ProfileRepository を直接渡した場合のサポート
  const options: CreateAuthFacadeOptions =
    "findByUserId" in repoOrOptions
      ? { profileRepo: repoOrOptions }
      : repoOrOptions;

  const { profileRepo, consentRepo, legalDocRepo, eventBus } = options;

  return {
    // ─────────────────────────────────────────────────────
    // getProfile (既存実装)
    // ─────────────────────────────────────────────────────
    async getProfile(userId: UserId): Promise<Result<Profile>> {
      const result = await profileRepo.findByUserId(userId);
      if (!result.ok) {
        return result;
      }
      // 保険: ストレージから読んだものも改めてバリデーション
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

    // ─────────────────────────────────────────────────────
    // recordConsent
    // ─────────────────────────────────────────────────────
    async recordConsent(
      userId: UserId,
      scope: ConsentScope,
      version: string,
      source: ConsentRecord["source"],
      metadata?: { ipAddress?: string; userAgent?: string },
    ): Promise<Result<ConsentRecord>> {
      if (!consentRepo) {
        return err({
          code: "AUTH_CONSENT_NOT_CONFIGURED",
          message: "ConsentRepository が設定されていません",
          retryable: false,
        });
      }

      const record: Omit<ConsentRecord, "id"> = {
        userId,
        scope,
        version,
        recordedAt: new Date().toISOString(),
        revokedAt: null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        source,
      };

      const result = await consentRepo.upsert(record);
      if (!result.ok) {
        return result;
      }

      // EventBus 発行 (失敗してもサイレント — イベント未接続時に同意記録を止めない)
      if (eventBus) {
        const event: AuthConsentRecordedEvent = {
          eventId: generateUUID(),
          occurredAt: record.recordedAt,
          aggregateId: userId,
          type: "auth.consent_recorded",
          payload: {
            userId,
            scope,
            version,
            source,
            recordedAt: record.recordedAt,
          },
        };
        try {
          await eventBus.publish(event);
        } catch {
          // サイレント失敗 (canonical: legal-and-consent.md §4.3)
        }
      }

      return result;
    },

    // ─────────────────────────────────────────────────────
    // hasConsent
    // ─────────────────────────────────────────────────────
    async hasConsent(
      userId: UserId,
      scope: ConsentScope,
      requiredVersion: string,
    ): Promise<Result<boolean>> {
      if (!consentRepo) {
        return err({
          code: "AUTH_CONSENT_NOT_CONFIGURED",
          message: "ConsentRepository が設定されていません",
          retryable: false,
        });
      }

      const result = await consentRepo.findActive(userId, scope);
      if (!result.ok) {
        return result;
      }

      if (!result.data) {
        // 未同意
        return ok(false);
      }

      // revokedAt IS NULL (findActive で保証) かつ version 一致
      const hasMatch = result.data.version === requiredVersion;
      return ok(hasMatch);
    },

    // ─────────────────────────────────────────────────────
    // revokeConsent
    // ─────────────────────────────────────────────────────
    async revokeConsent(
      userId: UserId,
      scope: ConsentScope,
    ): Promise<Result<true>> {
      // 取消不可 scope チェック
      if (IRREVOCABLE_SCOPES.has(scope)) {
        return err({
          code: "AUTH_CONSENT_IRREVOCABLE",
          message:
            `${scope} scope の同意は取り消せません。退会フロー (docs/account-deletion.md) を経由してください。`,
          retryable: false,
          httpStatus: 422,
        });
      }

      if (!consentRepo) {
        return err({
          code: "AUTH_CONSENT_NOT_CONFIGURED",
          message: "ConsentRepository が設定されていません",
          retryable: false,
        });
      }

      // 現在の有効な同意レコードを取得 (EventBus 発行用の version を取得するため)
      const activeResult = await consentRepo.findActive(userId, scope);
      if (!activeResult.ok) {
        return activeResult;
      }

      const revokeResult = await consentRepo.revoke(userId, scope);
      if (!revokeResult.ok) {
        return revokeResult;
      }

      // EventBus 発行 (サイレント失敗)
      if (eventBus && activeResult.data) {
        const revokedAt = new Date().toISOString();
        const event: AuthConsentRevokedEvent = {
          eventId: generateUUID(),
          occurredAt: revokedAt,
          aggregateId: userId,
          type: "auth.consent_revoked",
          payload: {
            userId,
            scope,
            version: activeResult.data.version,
            revokedAt,
          },
        };
        try {
          await eventBus.publish(event);
        } catch {
          // サイレント失敗
        }
      }

      return ok(true as const);
    },

    // ─────────────────────────────────────────────────────
    // getRequiredConsents
    // ─────────────────────────────────────────────────────
    async getRequiredConsents(
      userId: UserId,
    ): Promise<Result<RequiredConsentView[]>> {
      if (!consentRepo || !legalDocRepo) {
        return err({
          code: "AUTH_CONSENT_NOT_CONFIGURED",
          message: "ConsentRepository または LegalDocumentVersionRepository が設定されていません",
          retryable: false,
        });
      }

      // 全 scope の最新バージョンを一括取得
      const allVersionsResult = await legalDocRepo.findAllLatest();
      if (!allVersionsResult.ok) {
        return allVersionsResult;
      }

      // ユーザーの有効な同意一覧を取得
      const activeConsentsResult = await consentRepo.listActive(userId);
      if (!activeConsentsResult.ok) {
        return activeConsentsResult;
      }

      // scope → 最新バージョン の Map
      const versionMap = new Map<ConsentScope, LegalDocumentVersion>();
      for (const doc of allVersionsResult.data) {
        versionMap.set(doc.scope, doc);
      }

      // scope → 有効な ConsentRecord の Map
      const activeConsentMap = new Map<ConsentScope, ConsentRecord>();
      for (const consent of activeConsentsResult.data) {
        // 同一 scope で複数ある場合は最初（最新）を使う
        if (!activeConsentMap.has(consent.scope)) {
          activeConsentMap.set(consent.scope, consent);
        }
      }

      // RequiredConsentView 配列を構築
      const views: RequiredConsentView[] = [];

      for (const [scope, latestDoc] of versionMap.entries()) {
        const config = SCOPE_CONFIG[scope];
        if (!config) continue;

        // data_deletion_request は通常一覧から除外
        if (config.excludeFromList) continue;

        const activeConsent = activeConsentMap.get(scope) ?? null;
        const userVersion = activeConsent?.version ?? null;
        const isUpToDate = userVersion === latestDoc.version;

        views.push({
          scope,
          currentVersion: latestDoc.version,
          userVersion,
          isRequired: config.isRequired,
          isUpToDate,
          documentUrl: latestDoc.documentUrl,
        });
      }

      // ソート: isRequired=true を先頭に (canonical: legal-and-consent.md §4.1)
      views.sort((a, b) => {
        if (a.isRequired && !b.isRequired) return -1;
        if (!a.isRequired && b.isRequired) return 1;
        return 0;
      });

      return ok(views);
    },
  };
}
