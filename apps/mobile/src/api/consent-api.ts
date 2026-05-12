/**
 * consent-api.ts — 同意管理 API クライアント
 *
 * canonical: docs/legal-and-consent.md v1.2 §4, §6
 * サーバー実装: apps/server/src/routes/auth-routes.ts (T-10)
 *
 * GET    /api/auth/consents
 * POST   /api/auth/consents
 * DELETE /api/auth/consents/:scope
 */

import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import type { RequiredConsentView } from "@trancall/shared-kernel";
import { RequiredConsentViewSchema } from "@trancall/shared-kernel";
import { apiFetch } from "./client.js";

// ============================================================
// Schemas
// ============================================================

const RequiredConsentsResponseSchema = z.object({
  consents: z.array(RequiredConsentViewSchema),
});

const RecordConsentResponseSchema = z.object({
  ok: z.boolean(),
});

const RevokeConsentResponseSchema = z.object({
  ok: z.boolean(),
});

// ============================================================
// API functions
// ============================================================

/**
 * GET /api/auth/consents
 * 現在のユーザーが同意すべき scope 一覧と同意状態を返す。
 * isRequired=true かつ isUpToDate=false の scope が存在すれば Consent Screen を表示する。
 */
export async function getRequiredConsents(
  accessToken: string,
): Promise<Result<RequiredConsentView[]>> {
  const result = await apiFetch("/api/auth/consents", RequiredConsentsResponseSchema, {
    method: "GET",
    accessToken,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.consents };
}

/**
 * POST /api/auth/consents
 * 指定 scope / version / source で同意を記録する。冪等 (upsert)。
 *
 * @param scope   - ConsentScope (legal_terms, voice_to_openai, etc.)
 * @param version - YYYY-MM-DD 形式のバージョン
 * @param source  - 同意取得文脈
 */
export async function recordConsent(
  scope: string,
  version: string,
  source: "onboarding" | "incoming_call_first_time" | "settings_screen" | "terms_revision_prompt",
  accessToken: string,
): Promise<Result<{ ok: boolean }>> {
  return apiFetch("/api/auth/consents", RecordConsentResponseSchema, {
    method: "POST",
    body: { scope, version, source },
    accessToken,
  });
}

/**
 * DELETE /api/auth/consents/:scope
 * 指定 scope の同意を取り消す。
 * 取消不可 scope (legal_terms / privacy_policy) には AUTH_CONSENT_IRREVOCABLE (422) が返る。
 */
export async function revokeConsentByScope(
  scope: string,
  accessToken: string,
): Promise<Result<{ ok: boolean }>> {
  return apiFetch(`/api/auth/consents/${encodeURIComponent(scope)}`, RevokeConsentResponseSchema, {
    method: "DELETE",
    accessToken,
  });
}
