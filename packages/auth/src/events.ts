/**
 * auth モジュールが発行する DomainEvent 定義
 *
 * canonical: docs/legal-and-consent.md v1.2 §3.5
 * canonical: docs/module-contracts.md v1.3 §3.1 (イベント発行・購読マトリクス)
 *
 * 購読者 (Phase 1 では未実装):
 * - auth.user_registered  → 将来の analytics (Issue #67)
 * - auth.consent_recorded → 将来の analytics / audit log
 * - auth.consent_revoked  → 将来の analytics / billing
 */

import { z } from "zod";

import {
  DomainEventBase,
  UserIdSchema,
  ConsentScopeSchema,
  OutputLanguage,
} from "@trancall/shared-kernel";

// ============================================================
// auth.user_registered — ユーザー登録完了時に発行 (Issue #67)
// canonical payload: docs/schemas.ts UserRegisteredEvent /
// docs/module-contracts.md §3.1 §3.3
// ============================================================

export const AuthUserRegisteredEventSchema = DomainEventBase.extend({
  type: z.literal("auth.user_registered"),
  payload: z.object({
    /** 登録したユーザー */
    userId: UserIdSchema,
    /** 登録に使用したメールアドレス */
    email: z.email(),
    /** 登録時点のネイティブ言語 */
    nativeLanguage: OutputLanguage,
  }),
});
export type AuthUserRegisteredEvent = z.infer<typeof AuthUserRegisteredEventSchema>;

// ============================================================
// auth.consent_recorded — 同意記録時に発行
// ============================================================

export const AuthConsentRecordedEventSchema = DomainEventBase.extend({
  type: z.literal("auth.consent_recorded"),
  payload: z.object({
    /** 同意したユーザー */
    userId: UserIdSchema,
    /** 同意の種別 */
    scope: ConsentScopeSchema,
    /** 同意したドキュメントバージョン */
    version: z.string(),
    /** 同意取得文脈 */
    source: z.enum([
      "onboarding",
      "incoming_call_first_time",
      "settings_screen",
      "terms_revision_prompt",
    ]),
    /** 同意記録日時 (UTC) */
    recordedAt: z.iso.datetime(),
  }),
});
export type AuthConsentRecordedEvent = z.infer<typeof AuthConsentRecordedEventSchema>;

// ============================================================
// auth.consent_revoked — 同意取消時に発行
// ============================================================

export const AuthConsentRevokedEventSchema = DomainEventBase.extend({
  type: z.literal("auth.consent_revoked"),
  payload: z.object({
    /** 取消したユーザー */
    userId: UserIdSchema,
    /** 取消した同意の種別 */
    scope: ConsentScopeSchema,
    /** 取消時の同意バージョン */
    version: z.string(),
    /** 取消日時 (UTC) */
    revokedAt: z.iso.datetime(),
  }),
});
export type AuthConsentRevokedEvent = z.infer<typeof AuthConsentRevokedEventSchema>;

/**
 * auth モジュールが発行する全 DomainEvent の union。
 * EventBus の narrowed interface で使用する。
 */
export type AuthDomainEvent =
  | AuthUserRegisteredEvent
  | AuthConsentRecordedEvent
  | AuthConsentRevokedEvent;
