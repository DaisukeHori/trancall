/**
 * アカウント管理エンドポイント (Sprint 4 T-2.12)
 *
 * POST /api/account/delete  — 退会リクエスト (soft delete + grace period 30日)
 * POST /api/account/restore — 退会キャンセル (30日以内なら復元)
 *
 * 設計参照: docs/account-deletion.md / docs/legal-and-consent.md §11
 *
 * Issue #27 (2 点):
 * 1. 非原子性: 旧実装は「サブスク即時キャンセル (不可逆) → profiles soft delete」の順で、
 *    キャンセル成功後に soft delete が失敗するとサブスクだけ消えて退会状態にならない
 *    (静かなデータ損失) 事故が起きうる。本実装は「soft delete 成功を確認してから
 *    サブスクの状態変更を行う」順に入れ替え、サブスク側の変更が失敗した場合は
 *    soft delete をロールバックする。
 * 2. restore がサブスクを復元しない: 旧実装は
 *    `billing.cancelSubscription(userId, atPeriodEnd=false)` (即時キャンセル) を呼んでおり、
 *    これは purchase_channel/plan_tier/stripe_subscription_id 等を即座に "free" へ
 *    書き換えてしまう (grace period 中でも復元不能)。本実装は `atPeriodEnd=true`
 *    (期末キャンセル) を使い、DB 上は cancel_at_period_end フラグのみを立てて
 *    plan_tier/channel/stripe ID 等は保持する。restore 時にこのフラグを false に
 *    戻すことで、grace period 内であればサブスクの表示状態を復元できる。
 *    【#65 で解消】 Stripe 連携チャネル (stripe_web / storekit_external) は
 *    `stripeAdapter.cancelSubscription(id, true)` で Stripe 側にも
 *    cancel_at_period_end=true を実際に送っているため、restore 側でローカル DB の
 *    フラグを false に戻すだけでは Stripe 側の設定までは戻らない (期末に Stripe が
 *    実際に解約してしまう) 問題があった。packages/billing に
 *    `BillingFacade.reactivateSubscription` (内部で stripeAdapter.reactivateSubscription
 *    → `stripe.subscriptions.update(id, { cancel_at_period_end: false })`) を追加し、
 *    restore はこれを facade 経由で呼ぶことで Stripe 側も含めて完全に復元する
 *    (直接 Stripe クライアントや subscriptionRepo を触らない)。
 *    IAP チャネルは元々どちらの分岐でも Apple/Google には通知していないため、
 *    このローカル DB フラグの復元だけで実質的に完全に復元される。
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuthFacade } from "@trancall/auth";
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
    auth: AuthFacade;
    billing: BillingFacade;
    eventBus: EventBus;
  },
): void {
  const { auth, billing, eventBus } = deps;

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
    // Issue #72.1: facade バイパス是正 — AuthFacade.getProfileDeletionStatus 経由で取得
    const statusResult = await auth.getProfileDeletionStatus(userId);
    if (!statusResult.ok) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: statusResult.error.message, retryable: true },
      });
    }

    if (statusResult.data != null && statusResult.data.deletedAt != null) {
      // 既に退会リクエスト済み (冪等: OK)
      const gracePeriodEnd = gracePeriodEndsAt(new Date(statusResult.data.deletedAt));
      return reply.status(200).send({
        ok: true,
        data: {
          gracePeriodEndsAt: gracePeriodEnd.toISOString(),
          message: "退会リクエストは既に受け付けられています。",
        },
      });
    }

    const userIdBranded = brandUserId(userId);
    if (!userIdBranded.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "userId が無効です", retryable: false },
      });
    }

    const requestedAt = new Date();
    const gracePeriodEnd = gracePeriodEndsAt(requestedAt);

    // ── 2. profiles.deleted_at を soft delete (先に確定させる) ──────────────
    // #27: サブスクの不可逆な状態変更より先に、可逆な soft delete を確定させることで
    // 「サブスクだけ消えて退会状態にならない」事故を防ぐ。
    // Issue #72.1: facade バイパス是正 — AuthFacade.setProfileDeletedAt 経由で書き込む
    const setDeletedResult = await auth.setProfileDeletedAt(userId, requestedAt.toISOString());
    if (!setDeletedResult.ok) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: setDeletedResult.error.message, retryable: true },
      });
    }

    // ── 3. サブスクリプションを期末キャンセル (atPeriodEnd=true) ────────────
    // #27: atPeriodEnd=true は plan_tier/purchase_channel/stripe ID 等を書き換えず
    // cancel_at_period_end フラグのみを立てるため、grace period 中は restore で
    // 復元可能な状態を維持できる (IAP チャネルも atPeriodEnd=true では
    // BILLING_INVALID_PLAN_CHANGE を返さないため、チャネルによる分岐は不要)。
    const cancelResult = await billing.cancelSubscription(userIdBranded.data, true);
    if (!cancelResult.ok) {
      // #27: サブスク側の変更が失敗した場合は soft delete をロールバックし、
      // クライアントには失敗を伝えて安全にリトライできる状態に戻す。
      const rollbackResult = await auth.setProfileDeletedAt(userId, null);

      if (!rollbackResult.ok) {
        // ロールバック自体が失敗した場合は不整合 (soft delete 済みだがサブスクは未キャンセル) を
        // 明示するため、通常の INTERNAL_ERROR と区別できるようログに残す。
        request.log.error(
          { userId, cancelError: cancelResult.error, rollbackError: rollbackResult.error },
          "[account-routes] delete: サブスクキャンセル失敗後の soft delete ロールバックにも失敗しました",
        );
      }

      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: cancelResult.error.message, retryable: true },
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

    // IAP チャネルは atPeriodEnd=true でも Apple/Google には通知されないため
    // (Store 側の解約は必ずユーザー自身が設定アプリから行う必要がある)、案内を表示する。
    const iapWarning =
      cancelResult.data.iapPlatform === "apple" || cancelResult.data.iapPlatform === "google"
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
    // Issue #72.1: facade バイパス是正 — AuthFacade.getProfileDeletionStatus 経由で取得
    const statusResult = await auth.getProfileDeletionStatus(userId);
    if (!statusResult.ok) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: statusResult.error.message, retryable: true },
      });
    }

    if (statusResult.data == null || statusResult.data.deletedAt == null) {
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
    const deletedAt = new Date(statusResult.data.deletedAt);
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

    const userIdBranded = brandUserId(userId);
    if (!userIdBranded.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "userId が無効です", retryable: false },
      });
    }

    // ── 3. サブスクリプションの cancel_at_period_end フラグを復元 ────────────
    // #27: 退会時に atPeriodEnd=true でキャンセルしているため plan_tier/channel/
    // stripe ID 等は保持されている。ここでは cancel_at_period_end のみを false に
    // 戻し、退会前の状態を再現する。
    // #65: billing.reactivateSubscription 経由で行うことで、stripe_web /
    // storekit_external チャネルは Stripe 側の cancel_at_period_end も取り消される
    // (直接 subscriptionRepo / Stripe クライアントを触らない、facade/adapter 経由)。
    // profiles/subscriptions は user_id UNIQUE 制約かつ自動 provisioning トリガー
    // (migration 00016) により全ユーザーに必ず 1 行存在するはずだが、万一
    // NOT_FOUND の場合は「復元すべきサブスクがない」として無視し、profile の
    // 復元を優先する (subscriptions 側の一時的な障害で退会取消自体をブロックしない)。
    const reactivateResult = await billing.reactivateSubscription(userIdBranded.data);
    if (!reactivateResult.ok && reactivateResult.error.code !== "NOT_FOUND") {
      // サブスク復元が失敗した場合は profiles の復元も行わず、丸ごとリトライ可能な
      // 状態のまま 500 を返す (#27: まとめてロールバック方針との整合)。
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: reactivateResult.error.message, retryable: true },
      });
    }

    // ── 4. soft delete を解除 ──────────────────────────────────────────────
    // Issue #72.1: facade バイパス是正 — AuthFacade.setProfileDeletedAt 経由で書き込む
    const restoreResult = await auth.setProfileDeletedAt(userId, null);

    if (!restoreResult.ok) {
      return reply.status(500).send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: restoreResult.error.message, retryable: true },
      });
    }

    return reply.status(200).send({
      ok: true,
      data: { restored: true },
    });
  });
}
