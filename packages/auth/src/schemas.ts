/**
 * Auth モジュール公開スキーマ
 *
 * 全てのモジュール境界は Zod でバリデーションする（プロジェクト規約）。
 */

import { z } from "zod";

import { OutputLanguage, UserIdSchema } from "@trancall/shared-kernel";

/**
 * Profile = アプリ内で参照される認証ユーザーのプロフィール。
 *
 * `nativeLanguage` は **発話を翻訳する元言語**として LiveKit token metadata に
 * 焼き込まれる（クライアントは書き換え不可、C-005 対応）。
 */
export const ProfileSchema = z.object({
  userId: UserIdSchema,
  /** メールアドレス（OAuth 経由の場合は provider の email） */
  email: z.string().email(),
  /** 表示名（任意、未設定時はユーザーが Picker で選択） */
  displayName: z.string().min(1).max(100).optional(),
  /** ネイティブ言語（13 出力言語のいずれか） */
  nativeLanguage: OutputLanguage,
  /** TranCall ID（短いユニーク ID、@hori123 など） */
  trancallId: z
    .string()
    .regex(/^[a-z0-9_]{4,30}$/, "TranCall ID は 4-30 文字の英小文字・数字・アンダースコア"),
  /** プロフィール更新日時 */
  updatedAt: z.string().datetime(),
});
export type Profile = z.infer<typeof ProfileSchema>;
