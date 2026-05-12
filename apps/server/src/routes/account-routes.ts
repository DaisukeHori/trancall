/**
 * アカウント管理エンドポイント (Sprint 4 T-2.12)
 *
 * POST /api/account/delete  — 退会リクエスト (soft delete + grace period 30日)
 * POST /api/account/restore — 退会キャンセル (30日以内なら復元)
 *
 * 設計参照: docs/account-deletion.md / docs/legal-and-consent.md §11
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingFacade } from "@trancall/billing";
import { brandUserId } from "@trancall/shared-kernel";
import type { EventBus } from "../adapters/event-bus.js";

// ---------------------------------------------------------------------------
// Zod スキーマ
// ---------------------------------------------------------------------------

const DeleteAccountBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 退会猶予期間 (日数) */
const GRACE_PERIOD_DAYS = 30;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function gracePeriodEndsAt(from: Date): Date {
  return new Date(from.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Route 登録
// ---------------------------------------------------------------------------

export function registerAccountRoutes(
  fastify: FastifyInstance,
  deps: {
    supabase: SupabaseClient;
    billing: BillingFacade;
    eventBus: EventBus;
  },
): void {
  const { supabase, billing, eventBus } = deps;

  // -------------------------------------------------------------------------
  // POST /api/account/delete
  // -------------------------------------------------------------------------
  fastify.post("/api/account/delete", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = DeleteAccountBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const userId = request.userId;

    // ── 1. すでに退会処理済みか確認 ──────────────────────────────────────────
    const { data: existingProfile, error: fetchError } = await supabase
      .schema("trancall_auth")
      .from("profiles")
      .select("deleted_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: fetchError.message, retryable: true },
      });
    }

    if (existingProfile?.deleted_at != null) {
      // 既に退会リクエスト済み (冪等: OK)
      const gracePeriodEnd = gracePeriodEndsAt(new Date(existingProfile.deleted_at as string));
      return reply.status(200).send({
        ok: true,
        data: {
          gracePeriodEndsAt: gracePeriodEnd.toISOString(),
          message: "退会リクエストは既に受け付けられています。",
        },
      });
    }

    const requestedAt = new Date();
    const gracePeriodEnd = gracePeriodEndsAt(requestedAt);

    // ── 2. サブスクリプション即時キャンセル ──────────────────────────────────
    const userIdBranded = brandUserId(userId);
    if (!userIdBranded.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "userId が無効です", retryable: false },
      });
    }

    const cancelResult = await billing.cancelSubscription(userIdBranded.data, false);
    if (!cancelResult.ok) {
      // IAP チャネルの場合は即時キャンセル不可 — 続行して soft delete のみ実施
      // BILLING_INVALID_PLAN_CHANGE = IAP チャネル
      if (cancelResult.error.code !== "BILLING_INVALID_PLAN_CHANGE") {
        return reply.status(500).send({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: cancelResult.error.message, retryable: true },
        });
      }
      // IAP チャネルの場合はユーザーに案内メッセージを追加 (処理は続行)
    }

    // ── 3. profiles.deleted_at を soft delete ────────────────────────────────
    const { error: updateError } = await supabase
      .schema("trancall_auth")
      .from("profiles")
      .update({ deleted_at: requestedAt.toISOString() })
      .eq("user_id", userId);

    if (updateError) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: updateError.message, retryable: true },
      });
    }

    // ── 4. DomainEvent 発行 ──────────────────────────────────────────────────
    await eventBus.publish({
      type: "auth.account_deletion_requested",
      payload: {
        userId,
        requestedAt: requestedAt.toISOString(),
        gracePeriodEndsAt: gracePeriodEnd.toISOString(),
      },
    });

    const iapWarning =
      cancelResult.ok === false && cancelResult.error.code === "BILLING_INVALID_PLAN_CHANGE"
        ? "App Store / Google Play のサブスクリプションは、iOS/Android の設定アプリから別途キャンセルしてください。"
        : undefined;

    return reply.status(200).send({
      ok: true,
      data: {
        gracePeriodEndsAt: gracePeriodEnd.toISOString(),
        ...(iapWarning != null ? { iapWarning } : {}),
      },
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/account/restore
  // -------------------------------------------------------------------------
  fastify.post("/api/account/restore", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId;

    // ── 1. 退会リクエスト済みか確認 ──────────────────────────────────────────
    const { data: profile, error: fetchError } = await supabase
      .schema("trancall_auth")
      .from("profiles")
      .select("deleted_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: fetchError.message, retryable: true },
      });
    }

    if (profile == null || profile.deleted_at == null) {
      // 退会リクエストなし
      return reply.status(400).send({
        ok: false,
        error: {
          code: "ACCOUNT_NOT_DELETED",
          message: "退会リクエストが見つかりません。",
          retryable: false,
        },
      });
    }

    // ── 2. 猶予期間内かチェック ───────────────────────────────────────────────
    const deletedAt = new Date(profile.deleted_at as string);
    const gracePeriodEnd = gracePeriodEndsAt(deletedAt);
    const now = new Date();

    if (now > gracePeriodEnd) {
      // 猶予期間を超過 → 410 GONE
      return reply.status(410).send({
        ok: false,
        error: {
          code: "ACCOUNT_GRACE_PERIOD_EXPIRED",
          message: "退会猶予期間（30日）を超過したため、アカウントを復元できません。",
          retryable: false,
        },
      });
    }

    // ── 3. soft delete を解除 ──────────────────────────────────────────────
    const { error: restoreError } = await supabase
      .schema("trancall_auth")
      .from("profiles")
      .update({ deleted_at: null })
      .eq("user_id", userId);

    if (restoreError) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: restoreError.message, retryable: true },
      });
    }

    return reply.status(200).send({
      ok: true,
      data: { restored: true },
    });
  });
}
