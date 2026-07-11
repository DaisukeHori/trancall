/**
 * ContactRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRepository } from "@trancall/contact";
import { ContactEntrySchema } from "@trancall/contact";
import type { ContactEntry } from "@trancall/contact";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";

function parseContactRow(row: Record<string, unknown>): Result<ContactEntry> {
  const parsed = ContactEntrySchema.safeParse({
    contactId: row["id"],
    userId: row["user_id"],
    contactUserId: row["contact_user_id"],
    displayName: row["display_name"] ?? "",
    nativeLanguage: row["native_language"] ?? "ja",
    avatarUrl: row["avatar_url"] ?? null,
    addedAt: row["added_at"],
    isFavorite: row["is_favorite"] ?? false,
    trancallId: row["trancall_id"] ?? "",
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "contacts スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createContactRepository(supabase: SupabaseClient): ContactRepository {
  return {
    async add(userId: UserId, contactUserId: UserId): Promise<Result<ContactEntry>> {
      const { data, error } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .insert({
          id: randomUUID(),
          user_id: userId,
          contact_user_id: contactUserId,
          added_at: new Date().toISOString(),
          is_favorite: false,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          return err({ code: "CONTACT_ALREADY_EXISTS", message: "すでに連絡先に追加されています", retryable: false });
        }
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseContactRow(data as Record<string, unknown>);
    },

    async remove(userId: UserId, contactId: string): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .delete()
        .eq("id", contactId)
        .eq("user_id", userId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async list(userId: UserId): Promise<Result<ContactEntry[]>> {
      const { data, error } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .select("*")
        .eq("user_id", userId)
        .order("added_at", { ascending: false });

      // Issue #72.2: DB エラー時に空配列を返すと呼び出し元がエラーを検知できない
      // (「連絡先 0 件」と「取得失敗」が区別できなくなる) ため、Result 型で伝播する。
      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const entries: ContactEntry[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const result = parseContactRow(row);
        if (result.ok) entries.push(result.data);
      }
      return ok(entries);
    },

    async exists(userId: UserId, contactUserId: UserId): Promise<boolean> {
      const { count } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("contact_user_id", contactUserId);

      return (count ?? 0) > 0;
    },

    async toggleFavorite(userId: UserId, contactId: string): Promise<Result<true>> {
      // まず現状取得
      const { data: existing, error: fetchErr } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .select("is_favorite")
        .eq("id", contactId)
        .eq("user_id", userId)
        .single();

      if (fetchErr) {
        return err({ code: "INTERNAL_ERROR", message: fetchErr.message, retryable: true });
      }

      const { error } = await supabase
        .schema("trancall_contact")
        .from("contacts")
        .update({ is_favorite: !existing["is_favorite"] })
        .eq("id", contactId)
        .eq("user_id", userId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
