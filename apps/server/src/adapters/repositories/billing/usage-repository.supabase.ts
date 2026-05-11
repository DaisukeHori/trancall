/**
 * UsageRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageRepository } from "@trancall/billing";
import { UsageWindow } from "@trancall/billing";
import type { UsageWindowType, RecordUsageCommandType } from "@trancall/billing";
import { type Result, type UserId, type TranslationSessionId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

export function createUsageRepository(
  supabase: SupabaseClient,
): UsageRepository {
  return {
    async insertWindowIdempotent(
      cmd: RecordUsageCommandType,
      amountYen: number,
    ): Promise<Result<UsageWindowType, AppError>> {
      // ON CONFLICT (idempotency_key) DO NOTHING
      const { error } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .insert({
          id: randomUUID(),
          user_id: cmd.userId,
          session_id: cmd.sessionId,
          room_id: cmd.roomId,
          window_start: cmd.windowStart,
          window_end: cmd.windowEnd,
          duration_seconds: cmd.durationSeconds,
          language_pair: cmd.languagePair,
          amount_yen: amountYen,
          idempotency_key: cmd.idempotencyKey,
          recorded_at: new Date().toISOString(),
        });

      if (error && error.code !== "23505") {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      // 冪等: 既存行も取得して返す
      const { data: existing, error: fetchError } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .select("*")
        .eq("idempotency_key", cmd.idempotencyKey)
        .single();

      if (fetchError) {
        return err({ code: "INTERNAL_ERROR", message: fetchError.message, retryable: true });
      }

      const parsed = UsageWindow.safeParse({
        id: existing["id"],
        userId: existing["user_id"],
        sessionId: existing["session_id"],
        roomId: existing["room_id"],
        windowStart: existing["window_start"],
        windowEnd: existing["window_end"],
        durationSeconds: existing["duration_seconds"],
        languagePair: existing["language_pair"],
        amountYen: existing["amount_yen"],
        idempotencyKey: existing["idempotency_key"],
        recordedAt: existing["recorded_at"],
      });

      if (!parsed.success) {
        return err({ code: "INTERNAL_ERROR", message: "usage_windows スキーマ不正", retryable: false });
      }
      return ok(parsed.data);
    },

    async findBySessionId(
      sessionId: TranslationSessionId,
    ): Promise<Result<UsageWindowType[], AppError>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .select("*")
        .eq("session_id", sessionId);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const rows: UsageWindowType[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const parsed = UsageWindow.safeParse({
          id: row["id"],
          userId: row["user_id"],
          sessionId: row["session_id"],
          roomId: row["room_id"],
          windowStart: row["window_start"],
          windowEnd: row["window_end"],
          durationSeconds: row["duration_seconds"],
          languagePair: row["language_pair"],
          amountYen: row["amount_yen"],
          idempotencyKey: row["idempotency_key"],
          recordedAt: row["recorded_at"],
        });
        if (!parsed.success) continue;
        rows.push(parsed.data);
      }
      return ok(rows);
    },

    async sumDurationSecondsInPeriod(
      userId: UserId,
      periodStart: string,
      periodEnd: string,
    ): Promise<Result<number, AppError>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_windows")
        .select("duration_seconds")
        .eq("user_id", userId)
        .gte("window_start", periodStart)
        .lte("window_end", periodEnd);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      const total = (data as Array<{ duration_seconds: number }>).reduce(
        (sum, row) => sum + (row["duration_seconds"] ?? 0),
        0,
      );
      return ok(total);
    },
  };
}
