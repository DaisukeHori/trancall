/**
 * @trancall/transcript — 公開スキーマ
 *
 * shared-kernel の Branded Types + Result を使い、
 * このモジュール固有の型を定義する。
 */

import { z } from "zod";
import {
  RoomIdSchema,
  ParticipantIdSchema,
  UserIdSchema,
  TranslationSessionIdSchema,
} from "@trancall/shared-kernel";

// ---------------------------------------------------------------------------
// LiveSubtitleDelta
// リアルタイム字幕用（メモリ / LiveKit Data Channel のみ、DB 保存しない）
// ---------------------------------------------------------------------------

export const LiveSubtitleDeltaSchema = z.object({
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  /** グループ通話時のセッション識別用（1対1では null 可） */
  translationSessionId: TranslationSessionIdSchema.nullable(),
  speakerName: z.string().min(1),
  /** 原文 delta テキスト（空文字不可） */
  originalDelta: z.string().min(1),
  /** 翻訳 delta テキスト（空文字不可） */
  translatedDelta: z.string().min(1),
  language: z.string().min(1),
  isFinal: z.boolean(),
  timestamp: z.number(),
});

export type LiveSubtitleDelta = z.infer<typeof LiveSubtitleDeltaSchema>;

// ---------------------------------------------------------------------------
// TranscriptSegment
// DB 保存用（final segment のみ）
// ---------------------------------------------------------------------------

export const TranscriptSegmentSchema = z.object({
  segmentId: z.uuid(),
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  speakerName: z.string().min(1),
  originalText: z.string(),
  translatedText: z.string().nullable(),
  languagePair: z.string().min(1),
  startTimeMs: z.number().int(),
  endTimeMs: z.number().int(),
  sequenceNo: z.number().int().nonnegative(),
  sourceEventId: z.uuid(),
  agentSessionId: z.uuid().nullable(),
  retentionUntil: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

// ---------------------------------------------------------------------------
// TranscriptAccess
// ユーザーごとのアクセス制御
// ---------------------------------------------------------------------------

export const TranscriptAccessSchema = z.object({
  id: z.uuid(),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  canView: z.boolean(),
  canExport: z.boolean(),
  deletedAt: z.iso.datetime().nullable(),
  consentVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type TranscriptAccess = z.infer<typeof TranscriptAccessSchema>;

// ---------------------------------------------------------------------------
// FullTranscript
// getTranscript() の返り値
// ---------------------------------------------------------------------------

export const FullTranscriptSchema = z.object({
  roomId: RoomIdSchema,
  segments: z.array(TranscriptSegmentSchema),
  duration: z.number().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});

export type FullTranscript = z.infer<typeof FullTranscriptSchema>;
