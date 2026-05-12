/**
 * consent.ts — 同意フロー系 Zod スキーマ
 *
 * canonical 定義: docs/legal-and-consent.md v1.2 §3
 * 関連契約: docs/module-contracts.md v1.3 §2.1 AuthFacade
 *
 * ここで定義したスキーマは packages/auth/src/schemas.ts から import して使用する。
 * このファイル自体はビジネスロジックを持たず、値の契約のみを提供する。
 */

import { z } from "zod";

import { UserIdSchema } from "./brand.js";

// ============================================================
// §3.1 ConsentScope — 同意の種別 (7 値 canonical)
// ============================================================

/**
 * TranCall で取得する同意の種別。
 * 新規 scope を追加する場合は docs/legal-and-consent.md §5 (ライフサイクル表) も同時に更新すること。
 *
 * - legal_terms: 利用規約への同意 (アカウント作成時 + 規約改訂時)
 * - privacy_policy: プライバシーポリシーへの同意 (同上)
 * - voice_to_openai: OpenAI への音声送信同意 (初回通話前、最重要)
 * - transcript_retention: トランスクリプト保持への同意 (プラン別保持期間)
 * - data_deletion_request: 退会・データ削除リクエスト確認
 * - push_notification: Push 通知許可 (iOS POST_NOTIFICATIONS と連動)
 * - marketing_email: マーケティングメール (オプトイン、Phase 2)
 */
export const ConsentScopeSchema = z.enum([
  "legal_terms",
  "privacy_policy",
  "voice_to_openai",
  "transcript_retention",
  "data_deletion_request",
  "push_notification",
  "marketing_email",
]);
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;

// ============================================================
// §3.2 LegalDocumentVersion — 規約ドキュメントのバージョン
// ============================================================

/**
 * 各 scope のバージョン管理エントリ。
 * 規約改訂時はこのレコードを INSERT し、既存レコードの supersedes に前バージョンを入れる。
 * DB: trancall_auth.consent_versions (Sprint 3 migration 00008 で scope 列追加)
 */
export const LegalDocumentVersionSchema = z.object({
  /** scope 識別子 */
  scope: ConsentScopeSchema,
  /**
   * バージョン文字列。
   * `YYYY-MM-DD` または同日複数改訂時 `YYYY-MM-DD-rN` 形式
   */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(-r\d+)?$/),
  /**
   * 規約本文の URL。legal_terms / privacy_policy のみ必須。
   * voice_to_openai 等は null を許容。
   */
  documentUrl: z.url().nullable(),
  /** この版が発効する日時 (UTC ISO 8601) */
  effectiveAt: z.iso.datetime(),
  /** 前バージョン。初版は null。 */
  supersedes: z.string().nullable(),
  /**
   * 改訂内容のサマリ（日本語）。
   * 多言語サマリは i18n key で別途管理する。
   * 例: "OpenAI 零保持ポリシーへの言及を追記"
   */
  changeSummary: z.string().nullable(),
});
export type LegalDocumentVersion = z.infer<typeof LegalDocumentVersionSchema>;

// ============================================================
// §3.3 ConsentRecord — 同意レコード (DB 行に対応)
// ============================================================

/**
 * ユーザーが scope に同意した記録。DB では 1 行 = 1 同意行為。
 * 取消時は revokedAt を SET する（物理削除しない）。
 *
 * DB: trancall_auth.user_consents (Sprint 3 migration 00007 で新規作成)
 *
 * 注意: legal_terms / privacy_policy scope は revokeConsent が
 *       AUTH_CONSENT_IRREVOCABLE (422) を返す。
 *       docs/module-contracts.md §2.1 の契約注釈参照。
 */
export const ConsentRecordSchema = z.object({
  /** 同意レコード UUID */
  id: z.uuid(),
  /** 同意したユーザー */
  userId: UserIdSchema,
  /** 同意の種別 */
  scope: ConsentScopeSchema,
  /**
   * 同意したドキュメントのバージョン (YYYY-MM-DD または YYYY-MM-DD-rN)。
   * LegalDocumentVersionSchema.version と整合させる。
   */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(-r\d+)?$/),
  /** 同意が記録された日時 (UTC) */
  recordedAt: z.iso.datetime(),
  /**
   * 同意を取り消した日時。null = 現在有効。
   * 取消不可 scope (legal_terms / privacy_policy) では原則 null のまま。
   */
  revokedAt: z.iso.datetime().nullable(),
  /**
   * 同意記録時の IP アドレス。PII のため Sprint 3 では暗号化なしで記録し、
   * 退会後 30 日で削除する。
   */
  ipAddress: z.string().nullable(),
  /** HTTP User-Agent (監査証跡用) */
  userAgent: z.string().nullable(),
  /**
   * 同意を取得した文脈 (source)。
   * - onboarding: オンボーディング画面
   * - incoming_call_first_time: 着信応答後初回通話前
   * - settings_screen: Settings → プライバシーと同意 画面
   * - terms_revision_prompt: 規約改訂バナー経由
   */
  source: z.enum([
    "onboarding",
    "incoming_call_first_time",
    "settings_screen",
    "terms_revision_prompt",
  ]),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

// ============================================================
// §3.4 RequiredConsentView — UI 表示用同意状態ビュー
// ============================================================

/**
 * AuthFacade.getRequiredConsents() の返り値要素。
 * mobile は各 scope の状態をこの型で受け取り、Consent Screen の表示を制御する。
 */
export const RequiredConsentViewSchema = z.object({
  /** 対象 scope */
  scope: ConsentScopeSchema,
  /** LegalDocumentVersion における最新バージョン */
  currentVersion: z.string(),
  /**
   * ユーザーが同意済みのバージョン。
   * null = 一度も同意していない。
   */
  userVersion: z.string().nullable(),
  /** この scope が機能利用に必須か (false = オプショナル) */
  isRequired: z.boolean(),
  /** userVersion === currentVersion (同意が最新版か) */
  isUpToDate: z.boolean(),
  /** 規約本文 URL (null = 別途説明文のみ) */
  documentUrl: z.url().nullable(),
});
export type RequiredConsentView = z.infer<typeof RequiredConsentViewSchema>;
