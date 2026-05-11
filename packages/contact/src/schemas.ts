/**
 * @trancall/contact 公開スキーマ定義
 *
 * PublicProfile は contact モジュール固有型として定義する。
 * UserProfile (auth モジュール) は email を含むが、PublicProfile は含めない。
 */

import { z } from "zod";

import {
  UserIdSchema,
  OutputLanguage,
} from "@trancall/shared-kernel";

// =============================================================================
// PublicProfile — 検索結果で返すユーザー情報（email 非公開）
// =============================================================================

export const PublicProfileSchema = z.object({
  userId: UserIdSchema,
  trancallId: z.string().min(3).max(30),
  displayName: z.string().min(1).max(50),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

// =============================================================================
// ContactEntry — 連絡先エントリ
// =============================================================================

export const ContactEntrySchema = z.object({
  contactId: z.string().uuid(),
  userId: UserIdSchema,
  contactUserId: UserIdSchema,
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
  addedAt: z.string().datetime(),
  isFavorite: z.boolean(),
  trancallId: z.string().min(3).max(30),
});
export type ContactEntry = z.infer<typeof ContactEntrySchema>;

// =============================================================================
// コマンド
// =============================================================================

export const AddContactCommandSchema = z.object({
  userId: UserIdSchema,
  contactUserId: UserIdSchema,
});
export type AddContactCommand = z.infer<typeof AddContactCommandSchema>;

export const BlockUserCommandSchema = z.object({
  userId: UserIdSchema,
  blockedUserId: UserIdSchema,
  reason: z.string().optional(),
});
export type BlockUserCommand = z.infer<typeof BlockUserCommandSchema>;

export const ReportUserCommandSchema = z.object({
  userId: UserIdSchema,
  reportedUserId: UserIdSchema,
  reason: z.enum(["spam", "harassment", "impersonation", "other"]),
  details: z.string().optional(),
});
export type ReportUserCommand = z.infer<typeof ReportUserCommandSchema>;
