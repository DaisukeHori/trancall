/**
 * LegalDocumentVersionRepository — Supabase 実装
 *
 * trancall_auth.consent_versions テーブルから規約ドキュメントバージョンを取得する。
 * Sprint 3 migration 00008 で scope 列が追加されるテーブルを対象とする。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegalDocumentVersionRepository } from "@trancall/auth";
import type { ConsentScope, LegalDocumentVersion } from "@trancall/shared-kernel";
import { LegalDocumentVersionSchema } from "@trancall/shared-kernel";
import { type Result, err, ok } from "@trancall/shared-kernel";

function mapRow(row: Record<string, unknown>): Result<LegalDocumentVersion> {
  const parsed = LegalDocumentVersionSchema.safeParse({
    scope: row["scope"],
    version: row["version"],
    documentUrl: row["document_url"] ?? null,
    effectiveAt: row["effective_at"],
    supersedes: row["supersedes"] ?? null,
    changeSummary: row["change_summary"] ?? null,
  });

  if (!parsed.success) {
    return err({
      code: "AUTH_LEGAL_DOC_UNAVAILABLE",
      message: "DB から取得した規約バージョンのスキーマが不正です",
      retryable: false,
      details: { issues: parsed.error.issues.map((i) => i.message) },
    });
  }

  return ok(parsed.data);
}

export function createLegalDocVersionRepository(
  supabase: SupabaseClient,
): LegalDocumentVersionRepository {
  return {
    async findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion>> {
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("consent_versions")
        .select("scope, version, document_url, effective_at, supersedes, change_summary")
        .eq("scope", scope)
        .order("effective_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      if (!data) {
        return err({
          code: "AUTH_LEGAL_DOC_UNAVAILABLE",
          message: `scope "${scope}" の規約バージョンが見つかりません`,
          retryable: false,
        });
      }

      return mapRow(data as Record<string, unknown>);
    },

    async findAllLatest(): Promise<Result<LegalDocumentVersion[]>> {
      // 全 scope の最新版を取得 (DISTINCT ON scope + ORDER BY effective_at DESC)
      const { data, error } = await supabase
        .schema("trancall_auth")
        .from("consent_versions")
        .select("scope, version, document_url, effective_at, supersedes, change_summary")
        .order("scope", { ascending: true })
        .order("effective_at", { ascending: false });

      if (error) {
        return err({
          code: "INTERNAL_ERROR",
          message: error.message,
          retryable: true,
        });
      }

      if (!data) return ok([]);

      // scope ごとに最新版のみを抽出
      const latestMap = new Map<string, Record<string, unknown>>();
      for (const row of data as Record<string, unknown>[]) {
        const scope = String(row["scope"]);
        if (!latestMap.has(scope)) {
          latestMap.set(scope, row);
        }
      }

      const results: LegalDocumentVersion[] = [];
      for (const row of latestMap.values()) {
        const mapped = mapRow(row);
        if (!mapped.ok) return mapped;
        results.push(mapped.data);
      }

      return ok(results);
    },
  };
}
