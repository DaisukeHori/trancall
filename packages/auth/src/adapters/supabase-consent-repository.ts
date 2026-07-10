/**
 * SupabaseConsentRepository — ConsentRepository の Supabase 実装
 *
 * canonical: docs/legal-and-consent.md v1.2 §4.3
 * DB: trancall_auth.user_consents (migration 00007)
 *
 * 冪等性: INSERT ... ON CONFLICT (user_id, scope, version) DO NOTHING
 * Layer 3 (apps/server) で DI されて使われる。
 */

import {
  type Result,
  type UserId,
  ok,
  err,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type ConsentRecord,
  ConsentRecordSchema,
} from "@trancall/shared-kernel";

import { type ConsentRepository } from "../repositories/consent-repository.ts";

/**
 * Supabase クライアントの最小インターフェース。
 * 本番では @supabase/supabase-js の SupabaseClient を渡す。
 * テストでは mock を渡す。
 */
export interface SupabaseClientLike {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: unknown): {
        is(column: string, value: null): {
          order(column: string, options?: { ascending: boolean }): {
            limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
          limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
        eq(column: string, value: unknown): {
          is(column: string, value: null): {
            order(column: string, options?: { ascending: boolean }): {
              limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
            limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
        order(column: string, options?: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
        limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
    insert(data: Record<string, unknown>): {
      select(): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    upsert(data: Record<string, unknown>, options?: { onConflict?: string; ignoreDuplicates?: boolean }): {
      select(): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    update(data: Record<string, unknown>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          is(column: string, value: null): Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
}

/**
 * DB 行を ConsentRecord に変換する。
 * カラム名 (snake_case) → TypeScript フィールド名 (camelCase)
 */
function rowToConsentRecord(row: Record<string, unknown>): Result<ConsentRecord> {
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
      code: "AUTH_CONSENT_SCHEMA_ERROR",
      message: `user_consents 行のスキーマ不整合: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      retryable: false,
    });
  }
  return ok(parsed.data);
}

export function createSupabaseConsentRepository(
  client: SupabaseClientLike,
): ConsentRepository {
  return {
    async upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>> {
      // ON CONFLICT (user_id, scope, version) DO NOTHING で冪等
      // ignoreDuplicates: true でコンフリクト時は既存行を返すのではなく無視するが、
      // その場合は SELECT で取得する
      const insertData = {
        user_id: record.userId,
        scope: record.scope,
        version: record.version,
        recorded_at: record.recordedAt,
        revoked_at: record.revokedAt ?? null,
        ip_address: record.ipAddress ?? null,
        user_agent: record.userAgent ?? null,
        source: record.source,
      };

      const { data, error } = await client
        .from("trancall_auth.user_consents")
        .upsert(insertData, {
          onConflict: "user_id,scope,version",
          ignoreDuplicates: true,
        })
        .select();

      if (error) {
        return err({
          code: "AUTH_CONSENT_WRITE_ERROR",
          message: `user_consents upsert 失敗: ${error.message}`,
          retryable: true,
        });
      }

      // ignoreDuplicates: true 時は data が空配列になる可能性がある
      // その場合は既存レコードを SELECT で取得する
      if (!data || data.length === 0) {
        return this.findActive(record.userId, record.scope).then((result) => {
          if (!result.ok) return result;
          if (!result.data) {
            return err({
              code: "AUTH_CONSENT_NOT_FOUND",
              message: "upsert 後に同意レコードが見つかりません",
              retryable: false,
            });
          }
          return ok(result.data);
        });
      }

      const row = data[0];
      if (!row || typeof row !== "object") {
        return err({
          code: "AUTH_CONSENT_WRITE_ERROR",
          message: "upsert 結果が不正です",
          retryable: false,
        });
      }
      return rowToConsentRecord(row as Record<string, unknown>);
    },

    async findActive(
      userId: UserId,
      scope: ConsentScope,
    ): Promise<Result<ConsentRecord | null>> {
      const { data, error } = await client
        .from("trancall_auth.user_consents")
        .select()
        .eq("user_id", userId)
        .eq("scope", scope)
        .is("revoked_at", null)
        .order("recorded_at", { ascending: false })
        .limit(1);

      if (error) {
        return err({
          code: "AUTH_CONSENT_READ_ERROR",
          message: `user_consents 取得失敗: ${error.message}`,
          retryable: true,
        });
      }

      if (!data || data.length === 0) {
        return ok(null);
      }

      const row = data[0];
      if (!row || typeof row !== "object") {
        return ok(null);
      }
      return rowToConsentRecord(row as Record<string, unknown>);
    },

    async listActive(userId: UserId): Promise<Result<ConsentRecord[]>> {
      const { data, error } = await client
        .from("trancall_auth.user_consents")
        .select()
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("recorded_at", { ascending: false })
        .limit(100);

      if (error) {
        return err({
          code: "AUTH_CONSENT_READ_ERROR",
          message: `user_consents 一覧取得失敗: ${error.message}`,
          retryable: true,
        });
      }

      if (!data) {
        return ok([]);
      }

      const records: ConsentRecord[] = [];
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const result = rowToConsentRecord(row as Record<string, unknown>);
        if (!result.ok) {
          return result;
        }
        records.push(result.data);
      }
      return ok(records);
    },

    async revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>> {
      const revokedAt = new Date().toISOString();
      const { error } = await client
        .from("trancall_auth.user_consents")
        .update({ revoked_at: revokedAt })
        .eq("user_id", userId)
        .eq("scope", scope)
        .is("revoked_at", null);

      if (error) {
        return err({
          code: "AUTH_CONSENT_WRITE_ERROR",
          message: `user_consents revoke 失敗: ${error.message}`,
          retryable: true,
        });
      }

      return ok(true as const);
    },
  };
}
