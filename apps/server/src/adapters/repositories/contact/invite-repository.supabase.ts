/**
 * InviteRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InviteRepository } from "@trancall/contact";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

// InviteLink 型はリポジトリインターフェース側で定義されている
type InviteLink = {
  id: string;
  userId: UserId;
  token: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function parseRow(row: Record<string, unknown>): InviteLink {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as UserId,
    token: row["token"] as string,
    expiresAt: row["expires_at"] as string,
    usedBy: (row["used_by"] as string | null) ?? null,
    usedAt: (row["used_at"] as string | null) ?? null,
    revokedAt: (row["revoked_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
  };
}

export function createInviteRepository(supabase: SupabaseClient): InviteRepository {
  return {
    async create(userId: UserId, token: string, expiresAt: Date): Promise<Result<InviteLink, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_contact")
        .from("invite_links")
        .insert({
          id: randomUUID(),
          user_id: userId,
          token,
          expires_at: expiresAt.toISOString(),
          used_by: null,
          used_at: null,
          revoked_at: null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(parseRow(data as Record<string, unknown>));
    },

    async findByToken(token: string): Promise<InviteLink | null> {
      const { data } = await supabase
        .schema("trancall_contact")
        .from("invite_links")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (!data) return null;
      return parseRow(data as Record<string, unknown>);
    },

    async markUsed(token: string, usedBy: UserId): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_contact")
        .from("invite_links")
        .update({ used_by: usedBy, used_at: new Date().toISOString() })
        .eq("token", token);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
