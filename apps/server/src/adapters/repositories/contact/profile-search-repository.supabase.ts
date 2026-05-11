/**
 * ProfileSearchRepository — Supabase 実装
 *
 * trancall_auth.profiles を読み取り専用ビューとして検索する。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileSearchRepository } from "@trancall/contact";
import { PublicProfileSchema } from "@trancall/contact";
import type { PublicProfile } from "@trancall/contact";

export function createProfileSearchRepository(
  supabase: SupabaseClient,
): ProfileSearchRepository {
  return {
    async findByTrancallId(trancallId: string): Promise<PublicProfile | null> {
      const { data } = await supabase
        .schema("trancall_auth")
        .from("profiles")
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
      const { data } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .select("user_id, trancall_id, display_name, native_language, avatar_url")
        .ilike("display_name", `%${query}%`)
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
