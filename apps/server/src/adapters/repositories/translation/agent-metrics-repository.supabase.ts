/**
 * AgentMetricsRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentMetricsRepository } from "@trancall/translation";
import { AgentMetricsRecordSchema } from "@trancall/translation";
import type { AgentMetricsRecord } from "@trancall/translation";
import { type Result, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

export function createAgentMetricsRepository(
  supabase: SupabaseClient,
): AgentMetricsRepository {
  return {
    async insert(
      record: Omit<AgentMetricsRecord, "id" | "createdAt">,
    ): Promise<Result<AgentMetricsRecord, AppError>> {
      const id = randomUUID();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .schema("trancall_event")
        .from("agent_metrics")
        .insert({
          id,
          agent_job_id: record.agentJobId,
          room_id: record.roomId,
          latency_ms: record.latencyMs,
          memory_rss_bytes: record.memoryRssBytes,
          collected_at: record.collectedAt,
          created_at: now,
        })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const row = data as Record<string, unknown>;
      const parsed = AgentMetricsRecordSchema.safeParse({
        id: row["id"],
        agentJobId: row["agent_job_id"],
        roomId: row["room_id"],
        latencyMs: row["latency_ms"],
        memoryRssBytes: row["memory_rss_bytes"],
        collectedAt: row["collected_at"],
        createdAt: row["created_at"],
      });

      if (!parsed.success) {
        return err({ code: "INTERNAL_ERROR", message: "agent_metrics スキーマ不正", retryable: false });
      }
      return ok(parsed.data);
    },
  };
}
