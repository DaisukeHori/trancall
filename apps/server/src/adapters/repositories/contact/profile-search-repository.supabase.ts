/**
 * ProfileSearchRepository — Supabase 実装
 *
 * trancall_auth.public_profiles VIEW (migration 00017, Issue #26) を検索する。
 * このビューは deleted_at IS NULL の行のみ・公開可能な最小カラムのみを返すため、
 * 退会済みユーザーは検索結果に含まれない。
 *
 * NOTE (#26): 現行スキーマには「検索対象に含めるか」を明示するユーザー opt-in
 * フラグが存在しない (全ユーザーがデフォルトで public_profiles に含まれる)。
 * true の opt-in 制御が必要な場合は profiles テーブルへの列追加 (migration) と
 * UI 設定が別途必要 — 本タスクでは深追いせず、既存の「退会ユーザー除外」までを
 * 検索対象フィルタとして適用する。
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
