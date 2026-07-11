/**
 * ProfileSearchRepository — Supabase 実装
 *
 * trancall_auth.public_profiles VIEW (migration 00017, Issue #26) を検索する。
 * このビューは deleted_at IS NULL の行のみ・公開可能な最小カラムのみを返すため、
 * 退会済みユーザーは検索結果に含まれない。
 *
 * Issue #64: 表示名の部分一致検索 (searchByDisplayName) は `is_searchable = true`
 * (migration 00024) の opt-in ユーザーのみを対象にする。デフォルト false のため、
 * 既存ユーザーは全員デフォルトで非検索対象になる (プライバシー保護のための
 * 安全側デフォルト)。
 *
 * TranCall ID 完全一致検索 (findByTrancallId) は opt-in フィルタの対象外とする。
 * ProfileSearchRepository インターフェース JSDoc (packages/contact/src/repositories/
 * profile-search-repository.ts) の通り、opt-in 制御は searchByDisplayName にのみ
 * 適用される契約であり、TranCall ID を明示的に知っているユーザーからの追加
 * (招待リンクや ID 共有経由) は「不特定多数からの発見可能性 (discoverability)」を
 * 問題にする opt-in 検索とは性質が異なるため、意図的に除外している。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileSearchRepository } from "@trancall/contact";
import { PublicProfileSchema } from "@trancall/contact";
import type { PublicProfile } from "@trancall/contact";

/**
 * PostgreSQL の ILIKE パターン特殊文字 (`%` `_` `\`) と PostgREST の `*` (ILIKE の
 * `%` の別名として解釈される) をエスケープする。
 * エスケープしないと `q=%` や `q=_` で全件 (あるいは意図しない広範囲) がヒットしてしまう
 * (Issue #26)。確定#3: PostgREST は `ilike` フィルタのパターン文字列中の `*` を `%`
 * のエイリアスとして扱うため、`\%` `\_` `\\` だけでは `q=*` が依然として全件マッチして
 * しまう取りこぼしがあった。`*` もエスケープ対象に追加する。
 * エスケープ後は Supabase 側の `ilike` に `%${escaped}%` として渡すため、
 * ユーザー入力に含まれる `%` `_` `\` `*` はリテラル文字として扱われる。
 */
function escapeIlikePattern(input: string): string {
  return input.replace(/[\\%_*]/g, (char) => `\\${char}`);
}

export function createProfileSearchRepository(
  supabase: SupabaseClient,
): ProfileSearchRepository {
  return {
    async findByTrancallId(trancallId: string): Promise<PublicProfile | null> {
      const { data } = await supabase
        .schema("trancall_auth")
        .from("public_profiles")
        .select("user_id, trancall_id, display_name, native_language, avatar_url")
        .eq("trancall_id", trancallId)
        .maybeSingle();

      if (!data) return null;
      const row = data as Record<string, unknown>;
      const parsed = PublicProfileSchema.safeParse({
        userId: row["user_id"],
        trancallId: row["trancall_id"],
        displayName: row["display_name"] ?? "",
        nativeLanguage: row["native_language"] ?? "ja",
        avatarUrl: row["avatar_url"] ?? null,
      });
      return parsed.success ? parsed.data : null;
    },

    async searchByDisplayName(query: string, limit = 20): Promise<PublicProfile[]> {
      const escapedQuery = escapeIlikePattern(query);
      const { data } = await supabase
        .schema("trancall_auth")
        .from("public_profiles")
        .select("user_id, trancall_id, display_name, native_language, avatar_url")
        // Issue #64: opt-in (is_searchable=true) のユーザーのみを検索対象にする
        .eq("is_searchable", true)
        .ilike("display_name", `%${escapedQuery}%`)
        .limit(limit);

      if (!data) return [];

      const profiles: PublicProfile[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const parsed = PublicProfileSchema.safeParse({
          userId: row["user_id"],
          trancallId: row["trancall_id"],
          displayName: row["display_name"] ?? "",
          nativeLanguage: row["native_language"] ?? "ja",
          avatarUrl: row["avatar_url"] ?? null,
        });
        if (parsed.success) profiles.push(parsed.data);
      }
      return profiles;
    },
  };
}
