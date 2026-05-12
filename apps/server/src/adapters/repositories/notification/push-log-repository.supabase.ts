/**
 * PushLogRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushLogRepository } from "@trancall/notification";
import { type Result, err, ok } from "@trancall/shared-kernel";

type PushLogWrite = {
  userId: string;
  notificationType: "incoming_call" | "missed_call";
  roomId: string | null;
  delivered: boolean | null;
  errorMessage: string | null;
};

export function createPushLogRepository(supabase: SupabaseClient): PushLogRepository {
  return {
    async write(log: PushLogWrite): Promise<Result<true>> {
      const { error } = await supabase
        .schema("trancall_notification")
        .from("push_logs")
        .insert({
          id: randomUUID(),
          user_id: log.userId,
          notification_type: log.notificationType,
          room_id: log.roomId,
          delivered: log.delivered,
          error_message: log.errorMessage,
          logged_at: new Date().toISOString(),
        });

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
