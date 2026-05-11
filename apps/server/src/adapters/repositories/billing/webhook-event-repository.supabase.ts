/**
 * WebhookEventRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebhookEventRepository } from "@trancall/billing";
import { WebhookEvent, WebhookProvider } from "@trancall/billing";
import type { WebhookEventType, WebhookProviderType } from "@trancall/billing";
import { type Result, err, ok } from "@trancall/shared-kernel";

function parseRow(row: Record<string, unknown>): Result<WebhookEventType> {
  const parsed = WebhookEvent.safeParse({
    id: row["id"],
    provider: row["provider"],
    externalEventId: row["external_event_id"],
    eventType: row["event_type"],
    payload: row["payload"],
    processedAt: row["processed_at"] ?? null,
    processingError: row["processing_error"] ?? null,
    receivedAt: row["received_at"],
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "webhook_events スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createWebhookEventRepository(
  supabase: SupabaseClient,
): WebhookEventRepository {
  return {
    async insertIdempotent(params: {
      provider: WebhookProviderType;
      externalEventId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }): Promise<Result<{ event: WebhookEventType; isNew: boolean }>> {
      const id = randomUUID();
      const now = new Date().toISOString();

      const { error } = await supabase
        .schema("trancall_billing")
        .from("webhook_events")
        .insert({
          id,
          provider: params.provider,
          external_event_id: params.externalEventId,
          event_type: params.eventType,
          payload: params.payload,
          processed_at: null,
          processing_error: null,
          received_at: now,
        });

      const isNew = !error || error.code !== "23505";

      if (error && error.code !== "23505") {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const { data, error: fetchError } = await supabase
        .schema("trancall_billing")
        .from("webhook_events")
        .select("*")
        .eq("provider", params.provider)
        .eq("external_event_id", params.externalEventId)
        .single();

      if (fetchError) {
        return err({ code: "INTERNAL_ERROR", message: fetchError.message, retryable: true });
      }

      const eventResult = parseRow(data as Record<string, unknown>);
      if (!eventResult.ok) return eventResult;

      return ok({ event: eventResult.data, isNew });
    },

    async markProcessed(id: string): Promise<Result<void>> {
      const { error } = await supabase
        .schema("trancall_billing")
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(undefined);
    },

    async markFailed(id: string, errorMsg: string): Promise<Result<void>> {
      const { error } = await supabase
        .schema("trancall_billing")
        .from("webhook_events")
        .update({ processing_error: errorMsg })
        .eq("id", id);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(undefined);
    },
  };
}

// Re-export WebhookProvider for use
export { WebhookProvider };
