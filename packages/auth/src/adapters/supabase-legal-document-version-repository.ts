/**
 * SupabaseLegalDocumentVersionRepository — LegalDocumentVersionRepository の Supabase 実装
 *
 * canonical: docs/legal-and-consent.md v1.2 §4.2
 * DB: trancall_auth.consent_versions (migration 00008 で scope 列追加)
 *
 * Layer 3 (apps/server) で DI されて使われる。
 */

import {
  type Result,
  ok,
  err,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type LegalDocumentVersion,
  LegalDocumentVersionSchema,
} from "@trancall/shared-kernel";

import { type LegalDocumentVersionRepository } from "../repositories/legal-document-version-repository";

/**
 * Supabase クライアントの最小インターフェース (consent_versions 用)。
 */
export interface SupabaseClientLike {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: unknown): {
        order(column: string, options?: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
        limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
      order(column: string, options?: { ascending: boolean }): {
        limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
      limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
}

/**
 * DB 行を LegalDocumentVersion に変換する。
 * カラム名 (snake_case) → TypeScript フィールド名 (camelCase)
 */
function rowToLegalDocumentVersion(row: Record<string, unknown>): Result<LegalDocumentVersion> {
  const parsed = LegalDocumentVersionSchema.safeParse({
    scope: row["scope"],
    version: row["version"],
    documentUrl: row["policy_url"] ?? null,
    effectiveAt: row["effective_at"],
    supersedes: row["supersedes"] ?? null,
    changeSummary: row["change_summary"] ?? null,
  });
  if (!parsed.success) {
    return err({
      code: "AUTH_LEGAL_DOC_SCHEMA_ERROR",
      message: `consent_versions 行のスキーマ不整合: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      retryable: false,
    });
  }
  return ok(parsed.data);
}

export function createSupabaseLegalDocumentVersionRepository(
  client: SupabaseClientLike,
): LegalDocumentVersionRepository {
  return {
    async findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion | null>> {
      const { data, error } = await client
        .from("trancall_auth.consent_versions")
        .select()
        .eq("scope", scope)
        .order("effective_at", { ascending: false })
        .limit(1);

      if (error) {
        return err({
          code: "AUTH_LEGAL_DOC_UNAVAILABLE",
          message: `consent_versions 取得失敗: ${error.message}`,
          retryable: true,
          httpStatus: 503,
        });
      }

      if (!data || data.length === 0) {
        return ok(null);
      }

      const row = data[0];
      if (!row || typeof row !== "object") {
        return ok(null);
      }
      return rowToLegalDocumentVersion(row as Record<string, unknown>);
    },

    async findAllLatest(): Promise<Result<LegalDocumentVersion[]>> {
      // 全 scope の最新版を一括取得する。
      // Supabase では DISTINCT ON が直接使えないため、全件取得して
      // TypeScript 側で scope ごとの最新を絞り込む。
      // データ量は scope 数 × バージョン数のオーダーで小規模のため問題なし。
      const { data, error } = await client
        .from("trancall_auth.consent_versions")
        .select()
        .order("effective_at", { ascending: false })
        .limit(200);

      if (error) {
        return err({
          code: "AUTH_LEGAL_DOC_UNAVAILABLE",
          message: `consent_versions 一覧取得失敗: ${error.message}`,
          retryable: true,
          httpStatus: 503,
        });
      }

      if (!data || data.length === 0) {
        return ok([]);
      }

      // scope ごとの最新バージョン 1 件だけを残す
      const latestByScopeMap = new Map<ConsentScope, LegalDocumentVersion>();
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const result = rowToLegalDocumentVersion(row as Record<string, unknown>);
        if (!result.ok) {
          return result;
        }
        const doc = result.data;
        if (!latestByScopeMap.has(doc.scope)) {
          // effective_at 降順で取得しているため、最初に登場したものが最新
          latestByScopeMap.set(doc.scope, doc);
        }
      }

      return ok([...latestByScopeMap.values()]);
    },
  };
}
