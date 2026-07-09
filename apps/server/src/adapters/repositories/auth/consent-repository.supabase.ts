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

const ACTIVE_CONSENT_COLUMNS =
  "id, user_id, scope, version, recorded_at, revoked_at, ip_address, user_agent, source";

export function createConsentRepository(supabase: SupabaseClient): ConsentRepository {
  return {
    /**
     * 監査証跡保護 (#34): 従来は UPSERT (ON CONFLICT (user_id, scope, version) DO UPDATE) で
     * 実装しており、同一 (user_id, scope, version) への再同意のたびに既存行の recorded_at が
     * 新時刻に、revoked_at が null に上書きされ、初回同意日時・取消履歴が失われていた。
     *
     * 修正後は「同一 (user_id, scope, version) のアクティブ行 (revoked_at IS NULL) があれば
     * それをそのまま返す (真の冪等・書き換えなし)、なければ新規 INSERT で追記する」方式にする。
     * revoke() 済みの行は revoked_at が非 NULL のため対象外になり、再同意は新しい行として
     * 追記されるので、取消時刻・再同意時刻の両方が履歴として残る。
     *
     * 前提: migration 00021 で UNIQUE(user_id, scope, version) を
     * 「revoked_at IS NULL の行のみ一意」の部分一意インデックスに緩和済み
     * (取消済み行を複数保持できるようにするため)。
     */
    async upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>> {
      const { data: existingActive, error: findError } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .select(ACTIVE_CONSENT_COLUMNS)
        .eq("user_id", record.userId)
        .eq("scope", record.scope)
        .eq("version", record.version)
        .is("revoked_at", null)
        .maybeSingle();

      if (findError) {
        return err({
          code: "INTERNAL_ERROR",
          message: findError.message,
          retryable: true,
        });
      }

      if (existingActive) {
        // 冪等: 既存のアクティブ同意をそのまま返す (recorded_at / revoked_at を上書きしない)
        return mapRow(existingActive);
      }

      const id = randomUUID();
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .insert({
          id,
          user_id: record.userId,
          scope: record.scope,
          version: record.version,
          recorded_at: record.recordedAt,
          revoked_at: record.revokedAt,
          ip_address: record.ipAddress,
          user_agent: record.userAgent,
          source: record.source,
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation: 部分一意インデックス (user_id, scope, version) WHERE
        // revoked_at IS NULL に競合状態で抵触した場合、既存のアクティブ行を再取得して返す
        // (真の冪等性を維持する)。
        if (error.code === "23505") {
          const raceResult = await supabase
            .schema("trancall_auth")
            .from("user_consents")
            .select(ACTIVE_CONSENT_COLUMNS)
            .eq("user_id", record.userId)
            .eq("scope", record.scope)
            .eq("version", record.version)
            .is("revoked_at", null)
            .maybeSingle();

          if (!raceResult.error && raceResult.data) {
            return mapRow(raceResult.data);
          }
        }

        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      return mapRow(data as Record<string, unknown>);
    },

    async listActive(userId: UserId): Promise<Result<ConsentRecord[]>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("user_consents")
        .select("id, user_id, scope, version, recorded_at, revoked_at, ip_address, user_agent, source")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("recorded_at", { ascending: false });

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      const records: ConsentRecord[] = [];
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const result = mapRow(row);
        if (!result.ok) return result;
        records.push(result.data);
      }
      return ok(records);
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

      return mapRow(data);
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
