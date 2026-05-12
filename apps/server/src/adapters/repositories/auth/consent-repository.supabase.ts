/**
 * ConsentRepository — Supabase 実装
 *
 * trancall_auth.user_consents テーブルからユーザー同意レコードを管理する。
 * Sprint 3 migration 00007 で作成されるテーブルを対象とする。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentRepository } from "@trancall/auth";
import type { ConsentRecord, ConsentScope, UserId } from "@trancall/shared-kernel";
import { ConsentRecordSchema } from "@trancall/shared-kernel";
import { type Result, err, ok } from "@trancall/shared-kernel";
import { randomUUID } from "node:crypto";

function mapRow(row: Record<string, unknown>): Result<ConsentRecord> {
  const parsed = ConsentRecordSchema.safeParse({
    id: row["id"],
    userId: row["user_id"],
    scope: row["scope"],
    version: row["version"],
    recordedAt: row["recorded_at"],
    revokedAt: row["revoked_at"] ?? null,
    ipAddress: row["ip_address"] ?? null,
    userAgent: row["user_agent"] ?? null,
    source: row["source"],
  });

  if (!parsed.success) {
    return err({
      code: "INTERNAL_ERROR",
      message: "DB から取得した同意レコードのスキーマが不正です",
      retryable: false,
      details: { issues: parsed.error.issues.map((i) => i.message) },
    });
  }

  return ok(parsed.data);
}

export function createConsentRepository(supabase: SupabaseClient): ConsentRepository {
  return {
    async upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>> {
      const id = randomUUID();

      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .upsert(
          {
            id,
            user_id: record.userId,
            scope: record.scope,
            version: record.version,
            recorded_at: record.recordedAt,
            revoked_at: record.revokedAt,
            ip_address: record.ipAddress,
            user_agent: record.userAgent,
            source: record.source,
          },
          { onConflict: "user_id,scope,version" },
        )
        .select()
        .single();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      return mapRow(data as Record<string, unknown>);
    },

    async findActive(userId: UserId, scope: ConsentScope): Promise<Result<ConsentRecord | null>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .select("id, user_id, scope, version, recorded_at, revoked_at, ip_address, user_agent, source")
        .eq("user_id", userId)
        .eq("scope", scope)
        .is("revoked_at", null)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      if (!data) return ok(null);

      return mapRow(data as Record<string, unknown>);
    },

    async revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>> {
      const revokedAt = new Date().toISOString();

      const { error } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .update({ revoked_at: revokedAt })
        .eq("user_id", userId)
        .eq("scope", scope)
        .is("revoked_at", null);

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      return ok(true);
    },
  };
}
