/**
 * ReservationRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReservationRepository } from "@trancall/billing";
import { UsageReservation } from "@trancall/billing";
import type { UsageReservationType } from "@trancall/billing";
import { type Result, type UserId, type TranslationSessionId, err, ok } from "@trancall/shared-kernel";

function parseRow(row: Record<string, unknown>): Result<UsageReservationType> {
  const parsed = UsageReservation.safeParse({
    id: row["id"],
    userId: row["user_id"],
    sessionId: row["session_id"],
    reservedMinutes: row["reserved_minutes"],
    consumedMinutes: row["consumed_minutes"],
    status: row["status"],
    createdAt: row["created_at"],
    reconciledAt: row["reconciled_at"] ?? null,
  });
  if (!parsed.success) {
    return err({ code: "INTERNAL_ERROR", message: "usage_reservations スキーマ不正", retryable: false });
  }
  return ok(parsed.data);
}

export function createReservationRepository(
  supabase: SupabaseClient,
): ReservationRepository {
  return {
    async create(
      userId: UserId,
      sessionId: TranslationSessionId,
      reservedMinutes: number,
    ): Promise<Result<UsageReservationType>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_reservations")
        .insert({
          id: randomUUID(),
          user_id: userId,
          session_id: sessionId,
          reserved_minutes: reservedMinutes,
          consumed_minutes: 0,
          status: "active",
          created_at: new Date().toISOString(),
          reconciled_at: null,
        })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async findActiveBySessionId(
      sessionId: TranslationSessionId,
    ): Promise<Result<UsageReservationType | null>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_reservations")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) return ok(null);
      return parseRow(data as Record<string, unknown>);
    },

    async reconcile(
      sessionId: TranslationSessionId,
      consumedMinutes: number,
    ): Promise<Result<UsageReservationType>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_reservations")
        .update({
          consumed_minutes: consumedMinutes,
          status: "reconciled",
          reconciled_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
        .eq("status", "active")
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return parseRow(data as Record<string, unknown>);
    },

    async expire(
      sessionId: TranslationSessionId,
    ): Promise<Result<UsageReservationType | null>> {
      const { data, error } = await supabase
        .schema("trancall_billing")
        .from("usage_reservations")
        .update({ status: "expired" })
        .eq("session_id", sessionId)
        .eq("status", "active")
        .select()
        .maybeSingle();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      if (!data) return ok(null);
      return parseRow(data as Record<string, unknown>);
    },
  };
}
