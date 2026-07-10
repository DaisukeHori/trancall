/**
 * support-api.ts — POST /api/support/inquiry クライアント
 * canonical: docs/support-flow.md §5, §6
 */
import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export const SupportCategorySchema = z.enum([
  "bug",
  "billing",
  "feature_request",
  "privacy",
  "other",
]);
export type SupportCategory = z.infer<typeof SupportCategorySchema>;

export const DiagnosticDataSchema = z.object({
  appVersion: z.string().max(32),
  osVersion: z.string().max(64),
  deviceModel: z.string().max(128),
  submittedAt: z.string(), // ISO 8601 UTC
  locale: z.string().max(16),
  callHistoryLast7d: z.number().int().nonnegative(),
  subscriptionTier: z.string().max(32).optional(),
});
export type DiagnosticData = z.infer<typeof DiagnosticDataSchema>;

export interface SupportInquiryRequest {
  category: SupportCategory;
  subject?: string;
  body: string;
  diagnosticData: DiagnosticData;
}

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

const SupportInquiryResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    ticketId: z.string(),
    estimatedResponseHours: z.number(),
  }),
});

export type SupportInquiryResponse = z.infer<typeof SupportInquiryResponseSchema>;

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

/**
 * POST /api/support/inquiry
 * Bearer token 認証必須 (Supabase JWT)。
 */
export async function submitInquiry(
  request: SupportInquiryRequest,
  accessToken: string,
): Promise<Result<SupportInquiryResponse>> {
  return apiFetch("/api/support/inquiry", SupportInquiryResponseSchema, {
    method: "POST",
    body: request,
    accessToken,
  });
}
