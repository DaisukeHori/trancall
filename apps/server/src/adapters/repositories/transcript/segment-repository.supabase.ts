/**
 * SegmentRepository — Supabase 実装
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SegmentRepository } from "@trancall/transcript";
import { TranscriptSegmentSchema } from "@trancall/transcript";
import type { TranscriptSegment } from "@trancall/transcript";
import { type Result, type RoomId, type ParticipantId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

function parseSegmentRow(row: Record<string, unknown>): Result<TranscriptSegment, AppError> {
  const parsed = TranscriptSegmentSchema.safeParse({
    segmentId: row["id"],
    roomId: row["room_id"],
    participantId: row["participant_id"],
    speakerName: row["speaker_name"],
    originalText: row["original_text"],
    translatedText: row["translated_text"] ?? null,
    languagePair: row["language_pair"],
    startTimeMs: row["start_time_ms"],
    endTimeMs: row["end_time_ms"],
    sequenceNo: row["sequence_no"],
    sourceEventId: row["source_event_id"],
    agentSessionId: row["agent_session_id"] ?? null,
    retentionUntil: row["retention_until"],
    createdAt: row["created_at"],
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "segments スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createSegmentRepository(supabase: SupabaseClient): SegmentRepository {
  return {
    async upsert(segment: TranscriptSegment): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_transcript")
        .from("segments")
        .upsert(
          {
            id: segment.segmentId,
            room_id: segment.roomId,
            participant_id: segment.participantId,
            speaker_name: segment.speakerName,
            original_text: segment.originalText,
            translated_text: segment.translatedText,
            language_pair: segment.languagePair,
            start_time_ms: segment.startTimeMs,
            end_time_ms: segment.endTimeMs,
            sequence_no: segment.sequenceNo,
            source_event_id: segment.sourceEventId,
            agent_session_id: segment.agentSessionId,
            retention_until: segment.retentionUntil,
            created_at: segment.createdAt,
          },
          { onConflict: "room_id,participant_id,sequence_no", ignoreDuplicates: true },
        );

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async findByRoomId(roomId: RoomId): Promise<Result<TranscriptSegment[], AppError>> {
      const { data, error } = await supabase
        .schema("trancall_transcript")
        .from("segments")
        .select("*")
        .eq("room_id", roomId)
        .order("start_time_ms", { ascending: true });

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const segments: TranscriptSegment[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const result = parseSegmentRow(row);
        if (result.ok) segments.push(result.data);
      }
      return ok(segments);
    },

    async getNextSequenceNo(
      roomId: RoomId,
      participantId: ParticipantId,
    ): Promise<Result<number, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_transcript")
        .from("segments")
        .select("sequence_no")
        .eq("room_id", roomId)
        .eq("participant_id", participantId)
        .order("sequence_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) return ok(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return ok(data["sequence_no"] as number + 1);
    },

    async searchByFts(roomId: RoomId, query: string): Promise<Result<TranscriptSegment[], AppError>> {
      const { data, error } = await supabase
        .schema("trancall_transcript")
        .from("segments")
        .select("*")
        .eq("room_id", roomId)
        .textSearch("original_text", query);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const segments: TranscriptSegment[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const result = parseSegmentRow(row);
        if (result.ok) segments.push(result.data);
      }
      return ok(segments);
    },
  };
}
