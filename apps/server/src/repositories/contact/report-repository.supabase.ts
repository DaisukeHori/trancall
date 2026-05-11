/**
 * ReportRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportRepository } from "@trancall/contact";
import type { ReportUserCommand } from "@trancall/contact";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

export function createReportRepository(supabase: SupabaseClient): ReportRepository {
  return {
    async create(cmd: ReportUserCommand): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_contact")
        .from("report_events")
        .insert({
          id: randomUUID(),
          reporter_id: cmd.userId,
          reported_id: cmd.reportedUserId,
          reason: cmd.reason,
          details: cmd.details ?? null,
          created_at: new Date().toISOString(),
        });

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async exists(reporterId: UserId, reportedId: UserId): Promise<boolean> {
      const { count } = await supabase
        .schema("trancall_contact")
        .from("report_events")
        .select("id", { count: "exact", head: true })
        .eq("reporter_id", reporterId)
        .eq("reported_id", reportedId);

      return (count ?? 0) > 0;
    },
  };
}
