/**
 * Transcript API — wraps server REST endpoints with Zod validation.
 *
 * GET  /api/transcripts/:roomId
 * GET  /api/transcripts/:roomId/export?format=pdf|txt  (T-10)
 * DELETE /api/transcripts/:roomId/access
 */

import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TranscriptSegmentSchema = z.object({
  segmentId: z.string(),
  roomId: z.string(),
  participantId: z.string(),
  speakerName: z.string(),
  originalText: z.string(),
  translatedText: z.string().nullable(),
  languagePair: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  sequenceNo: z.number(),
  sourceEventId: z.string(),
  agentSessionId: z.string().nullable(),
  retentionUntil: z.string(),
  createdAt: z.string(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

const FullTranscriptSchema = z.object({
  roomId: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  duration: z.number(),
  participantCount: z.number(),
  generatedAt: z.string(),
});

export type FullTranscript = z.infer<typeof FullTranscriptSchema>;

const TranscriptResponseSchema = z.object({
  ok: z.literal(true),
  data: FullTranscriptSchema,
});

const SegmentListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(TranscriptSegmentSchema),
});

const ExportResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    contentBase64: z.string(),
    mime: z.string(),
    filename: z.string().optional(),
  }),
});

const DeleteResponseSchema = z.object({
  ok: z.literal(true),
  data: z.literal(true),
});

export type ExportFormat = "pdf" | "txt";

export interface ExportResult {
  contentBase64: string;
  mime: string;
  /** Suggested filename from server (e.g. trancall-transcript-20260512-1000-550e8400.pdf) */
  filename?: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch full transcript for a room.
 * GET /api/transcripts/:roomId
 */
export async function getTranscript(
  roomId: string,
  accessToken: string,
): Promise<Result<FullTranscript>> {
  const result = await apiFetch(
    `/api/transcripts/${encodeURIComponent(roomId)}`,
    TranscriptResponseSchema,
    { method: "GET", accessToken },
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.data };
}

/**
 * Search transcript segments by query string.
 * GET /api/transcripts/:roomId/search?q=...
 */
export async function searchSegments(
  roomId: string,
  query: string,
  accessToken: string,
): Promise<Result<TranscriptSegment[]>> {
  const result = await apiFetch(
    `/api/transcripts/${encodeURIComponent(roomId)}/search?q=${encodeURIComponent(query)}`,
    SegmentListResponseSchema,
    { method: "GET", accessToken },
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.data };
}

/**
 * Export transcript as PDF or TXT.
 * GET /api/transcripts/:roomId/export?format=pdf|txt  (Sprint 3 T-10)
 *
 * Returns base64-encoded file content, MIME type, and optional filename.
 */
export async function exportTranscript(
  roomId: string,
  format: ExportFormat,
  accessToken: string,
): Promise<Result<ExportResult>> {
  const result = await apiFetch(
    `/api/transcripts/${encodeURIComponent(roomId)}/export?format=${encodeURIComponent(format)}`,
    ExportResponseSchema,
    {
      method: "GET",
      accessToken,
    },
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.data };
}

/**
 * Soft-delete the current user's transcript access.
 * DELETE /api/transcripts/:roomId/access
 */
export async function deleteAccess(
  roomId: string,
  accessToken: string,
): Promise<Result<true>> {
  const result = await apiFetch(
    `/api/transcripts/${encodeURIComponent(roomId)}/access`,
    DeleteResponseSchema,
    { method: "DELETE", accessToken },
  );
  if (!result.ok) return result;
  return { ok: true, data: true };
}
