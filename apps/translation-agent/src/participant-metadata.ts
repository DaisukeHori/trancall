/**
 * LiveKit Token Metadata のパース
 *
 * media モジュールが Token 発行時に焼き込む participant metadata を
 * Zod で検証し、Branded Type に変換する。
 *
 * 仕様 (C-005):
 *   - metadata は Server-side で Token 発行時に焼き込まれる
 *   - クライアントは metadata を書き換えできない（grant.canUpdateOwnMetadata=false）
 *   - nativeLanguage は OutputLanguage enum の値（"ja", "en", etc.）
 *
 * 設計判断:
 *   - metadata は JSON 文字列として渡される
 *   - パースに失敗した場合は err() を返す（throw しない）
 */

import { z } from "zod";

import { OutputLanguage } from "@trancall/shared-kernel";

// --- スキーマ ---

export const ParticipantMetadataSchema = z.object({
  /** DB から取得した参加者の母国語 */
  nativeLanguage: OutputLanguage,
});

export type ParticipantMetadata = z.infer<typeof ParticipantMetadataSchema>;

// --- パース結果型 ---

export type ParseMetadataResult =
  | { ok: true; data: ParticipantMetadata }
  | { ok: false; error: string };

// --- パース関数 ---

/**
 * participant.metadata (JSON 文字列) を ParticipantMetadata に変換する。
 *
 * @param raw - participant.metadata の生の文字列。undefined の場合は err を返す。
 * @returns ParseMetadataResult
 */
export function parseParticipantMetadata(raw: string | undefined): ParseMetadataResult {
  if (raw === undefined || raw === "") {
    return { ok: false, error: "metadata が未設定です" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `metadata の JSON パースに失敗しました: ${raw}` };
  }

  const result = ParticipantMetadataSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    return { ok: false, error: `metadata バリデーション失敗: ${issues}` };
  }

  return { ok: true, data: result.data };
}
