/**
 * TranslationSessionRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationSessionRepository } from "@trancall/translation";
import { TranslationSessionRecordSchema } from "@trancall/translation";
import type { TranslationSessionRecord } from "@trancall/translation";
import { type Result, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

function parseRow(row: Record<string, unknown>): Result<TranslationSessionRecord, AppError> {
  const parsed = TranslationSessionRecordSchema.safeParse({
    id: row["id"],
    agentJobId: row["agent_job_id"],
    roomId: row["room_id"],
    sourceParticipantId: row["source_participant_id"],
    targetParticipantId: row["target_participant_id"],
    outputLanguage: row["output_language"],
    startedAt: row["started_at"],
    endedAt: row["ended_at"] ?? null,
    durationMs: row["duration_ms"] ?? null,
    billableSeconds: row["billable_seconds"] ?? null,
    reason: row["ended_reason"] ?? null,
    createdAt: row["created_at"],
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "translation_sessions スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createTranslationSessionRepository(
  supabase: SupabaseClient,
): TranslationSessionRepository {
  return {
    async insert(record): Promise<Result<TranslationSessionRecord, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_event")
        .from("translation_sessions")
        .insert({
          id: randomUUID(),
          agent_job_id: record.agentJobId,
          room_id: record.roomId,
          source_participant_id: record.sourceParticipantId,
          target_participant_id: record.targetParticipantId,
          output_language: record.outputLanguage,
          started_at: record.startedAt,
          ended_at: null,
          duration_ms: null,
          billable_seconds: null,
          ended_reason: null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        // 冪等: 重複 agentJobId は既存行を取得して返す
        if (error.code === "23505") {
          const { data: existing } = await supabase
            .schema("trancall_event")
            .from("translation_sessions")
            .select("*")
            .eq("agent_job_id", record.agentJobId)
            .single();
          if (existing) return parseRow(existing as Record<string, unknown>);
        }
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async updateEnded(
      agentJobId: string,
      update: {
        endedAt: string;
        durationMs: number;
        billableSeconds: number;
        reason: TranslationSessionRecord["reason"];
      },
    ): Promise<Result<TranslationSessionRecord, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_event")
        .from("translation_sessions")
        .update({
          ended_at: update.endedAt,
          duration_ms: update.durationMs,
          billable_seconds: update.billableSeconds,
          ended_reason: update.reason,
        })
        .eq("agent_job_id", agentJobId)
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async findByAgentJobId(agentJobId: string): Promise<Result<TranslationSessionRecord, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_event")
        .from("translation_sessions")
        .select("*")
        .eq("agent_job_id", agentJobId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return err({ code: "TRANSLATION_SESSION_NOT_FOUND", message: `セッションが見つかりません: ${agentJobId}`, retryable: false });
        }
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },
  };
}
