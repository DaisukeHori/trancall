/**
 * TranslationEventOutboxRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationEventOutboxRepository, OutboxRecord } from "@trancall/translation";
import { type Result, err, ok } from "@trancall/shared-kernel";

function parseRow(row: Record<string, unknown>): OutboxRecord {
  return {
    id: row["id"] as string,
    aggregateId: row["aggregate_id"] as string,
    eventType: row["event_type"] as string,
    payload: row["payload"] as Record<string, unknown>,
    createdAt: row["created_at"] as string,
    processedAt: (row["processed_at"] as string | null) ?? null,
  };
}

export function createTranslationEventOutboxRepository(
  supabase: SupabaseClient,
): TranslationEventOutboxRepository {
  return {
    async insert(
      record: Omit<OutboxRecord, "id" | "createdAt" | "processedAt">,
    ): Promise<Result<OutboxRecord>> {
      const id = randomUUID();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .schema("trancall_event")
        .from("translation_events")
        .insert({
          id,
          aggregate_id: record.aggregateId,
          event_type: record.eventType,
          payload: record.payload,
          created_at: now,
          processed_at: null,
        })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(parseRow(data as Record<string, unknown>));
    },

    async findUnprocessed(limit: number): Promise<Result<OutboxRecord[]>> {
      const { data, error } = await supabase
        .schema("trancall_event")
        .from("translation_events")
        .select("*")
        .is("processed_at", null)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok((data as Record<string, unknown>[]).map(parseRow));
    },

    async markProcessed(id: string): Promise<Result<void>> {
      const { error } = await supabase
        .schema("trancall_event")
        .from("translation_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(undefined);
    },
  };
}
