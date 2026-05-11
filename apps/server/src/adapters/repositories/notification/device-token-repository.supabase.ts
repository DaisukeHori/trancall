/**
 * DeviceTokenRepository — Supabase 実装
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceTokenRepository } from "@trancall/notification";
import type { NotificationTarget } from "@trancall/notification";
import { type Result, type UserId, err, ok } from "@trancall/shared-kernel";
import type { AppError } from "@trancall/shared-kernel";

// packages/notification/src/schemas.ts に合わせた型
type DeviceTokenRow = {
  id: string;
  userId: UserId;
  platform: "ios" | "android";
  token: string;
  bundleId: string | null;
  isActive: boolean;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
};

function parseRow(row: Record<string, unknown>): DeviceTokenRow {
  return {
    id: row["id"] as string,
    userId: row["user_id"] as UserId,
    platform: row["platform"] as "ios" | "android",
    token: row["token"] as string,
    bundleId: (row["bundle_id"] as string | null) ?? null,
    isActive: row["is_active"] as boolean,
    lastSeenAt: (row["last_seen_at"] as string | undefined) ?? new Date().toISOString(),
    revokedAt: (row["revoked_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
  };
}

export function createDeviceTokenRepository(supabase: SupabaseClient): DeviceTokenRepository {
  return {
    async upsert(userId: UserId, target: NotificationTarget): Promise<Result<DeviceTokenRow, AppError>> {
      const now = new Date().toISOString();
      const baseRow = {
        id: randomUUID(),
        user_id: userId,
        is_active: true,
        last_seen_at: now,
        revoked_at: null,
        created_at: now,
      };

      let insertData: Record<string, unknown>;
      if (target.platform === "ios") {
        insertData = { ...baseRow, platform: "ios", token: target.voipToken, bundle_id: target.bundleId };
      } else {
        insertData = { ...baseRow, platform: "android", token: target.fcmToken, bundle_id: null };
      }

      const { data, error } = await supabase
        .schema("trancall_notification")
        .from("device_tokens")
        .upsert(insertData, { onConflict: "platform,token" })
        .select()
        .single();

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(parseRow(data as Record<string, unknown>));
    },

    async findActiveByUserId(
      userId: UserId,
      platform?: "ios" | "android",
    ): Promise<Result<DeviceTokenRow[], AppError>> {
      let query = supabase
        .schema("trancall_notification")
        .from("device_tokens")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (platform) {
        query = query.eq("platform", platform);
      }

      const { data, error } = await query;

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(((data ?? []) as Record<string, unknown>[]).map(parseRow));
    },

    async revoke(platform: "ios" | "android", token: string): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_notification")
        .from("device_tokens")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("platform", platform)
        .eq("token", token);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },

    async delete(userId: UserId, platform: "ios" | "android", token: string): Promise<Result<true, AppError>> {
      const { error } = await supabase
        .schema("trancall_notification")
        .from("device_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("platform", platform)
        .eq("token", token);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(true);
    },
  };
}
