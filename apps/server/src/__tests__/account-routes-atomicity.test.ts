/**
 * アカウント退会・復元の原子性 + サブスク復元テスト (Issue #27 / #65)
 *
 * 1. 退会時、サブスクのキャンセルが失敗したら soft delete をロールバックすること
 *    (旧実装は「サブスク即時キャンセル (不可逆) → soft delete」の順で、
 *    soft delete 失敗時にサブスクだけ消える事故があった)。
 * 2. 退会は atPeriodEnd=true (期末キャンセル) を使い、plan_tier/channel/stripe ID を
 *    保持したままキャンセルすること (即時キャンセルだと grace period 中でも
 *    復元不能になっていた)。
 * 3. 復元時、billing.reactivateSubscription (#65: facade 経由、stripe_web /
 *    storekit_external は Stripe 側の cancel_at_period_end も取り消す) を呼び、
 *    サブスクの表示状態を復元すること (旧実装は profiles.deleted_at のクリアのみで
 *    サブスク復元なし、#27 で subscriptionRepo 直接操作に変更 → #65 で facade 経由に変更)。
 *
 * Issue #72.1: account-routes.ts は AuthFacade.getProfileDeletionStatus /
 * setProfileDeletedAt 経由で trancall_auth.profiles.deleted_at を読み書きするように
 * 変更されたため、直接 supabase をモックするのではなく auth facade をモックし、
 * setProfileDeletedAt への呼び出し回数・引数で原子性を検証する。
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { ok, err } from "@trancall/shared-kernel";
import type { AppContainer } from "../container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

async function buildAppWithOverrides(overrides: {
  initialDeletedAt: string | null;
  cancelSubscriptionImpl?: (...args: unknown[]) => unknown;
  reactivateSubscriptionImpl?: (...args: unknown[]) => unknown;
}): Promise<{
  app: FastifyInstance;
  setDeletedAtCalls: Array<{ userId: string; deletedAt: string | null }>;
  container: AppContainer;
}> {
  const container = createMockContainer();

  container.auth.getProfileDeletionStatus = vi
    .fn()
    .mockResolvedValue(ok({ deletedAt: overrides.initialDeletedAt }));

  const setDeletedAtCalls: Array<{ userId: string; deletedAt: string | null }> = [];
  container.auth.setProfileDeletedAt = vi.fn(async (userId: unknown, deletedAt: unknown) => {
    setDeletedAtCalls.push({ userId: String(userId), deletedAt: deletedAt as string | null });
    return ok(true as const);
  });

  if (overrides.cancelSubscriptionImpl) {
    (container.billing as unknown as Record<string, unknown>)["cancelSubscription"] = vi.fn(
      overrides.cancelSubscriptionImpl,
    );
  }
  if (overrides.reactivateSubscriptionImpl) {
    (container.billing as unknown as Record<string, unknown>)["reactivateSubscription"] = vi.fn(
      overrides.reactivateSubscriptionImpl,
    );
  }

  const app = await buildTestApp(container);
  return { app, setDeletedAtCalls, container };
}

describe("POST /api/account/delete — 原子性 (#27)", () => {
  it("サブスクキャンセルが失敗したら soft delete をロールバックし 500 を返す", async () => {
    const { app, setDeletedAtCalls } = await buildAppWithOverrides({
      initialDeletedAt: null,
      cancelSubscriptionImpl: () =>
        Promise.resolve(
          err({ code: "INTERNAL_ERROR", message: "Stripe API 障害", retryable: true }),
        ),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/delete",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(500);

      // 1 回目: soft delete (deletedAt = ISO 文字列), 2 回目: ロールバック (deletedAt = null)
      expect(setDeletedAtCalls).toHaveLength(2);
      expect(setDeletedAtCalls[0]?.deletedAt).not.toBeNull();
      expect(setDeletedAtCalls[1]?.deletedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("サブスクキャンセルは atPeriodEnd=true (期末キャンセル) で呼ばれる (plan_tier 等を保持するため)", async () => {
    const cancelSpy = vi.fn((_userId: unknown, _atPeriodEnd: unknown) =>
      Promise.resolve(
        ok({
          userId: "11111111-1111-4111-8111-111111111111",
          plan: { tier: "standard", includedMinutes: 120, overageRateYen: 10, monthlyPriceYen: 1980, transcriptRetentionDays: 30 },
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date().toISOString(),
          usedMinutes: 0,
          remainingMinutes: 120,
          cancelAtPeriodEnd: true,
          stripeCustomerId: "cus_test",
          stripeSubscriptionId: "sub_test",
          iapOriginalTransactionId: null,
          iapPlatform: null,
        }),
      ),
    );
    const { app } = await buildAppWithOverrides({
      initialDeletedAt: null,
      cancelSubscriptionImpl: cancelSpy,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/delete",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(cancelSpy).toHaveBeenCalledOnce();
      const [, atPeriodEnd] = cancelSpy.mock.calls[0] ?? [];
      expect(atPeriodEnd).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("正常系: soft delete が先に成功し、その後サブスクキャンセルが成功して 200 を返す (2 回 setProfileDeletedAt は呼ばれない)", async () => {
    const { app, setDeletedAtCalls } = await buildAppWithOverrides({ initialDeletedAt: null });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/delete",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(setDeletedAtCalls).toHaveLength(1);
      expect(setDeletedAtCalls[0]?.deletedAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/account/restore — サブスク復元 (#27 / #65)", () => {
  it("cancel_at_period_end=true のサブスクは restore 時に billing.reactivateSubscription 経由で復元される", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const reactivateSpy = vi.fn((_userId: unknown) =>
      Promise.resolve(
        ok({
          planTier: "standard",
          includedMinutes: 120,
          usedMinutes: 0,
          remainingMinutes: 120,
          subscriptionStatus: "active",
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date().toISOString(),
          cancelAtPeriodEnd: false,
        }),
      ),
    );

    const { app } = await buildAppWithOverrides({
      initialDeletedAt: fiveDaysAgo,
      reactivateSubscriptionImpl: reactivateSpy,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/restore",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ ok: boolean; data: { restored: boolean } }>();
      expect(body.data.restored).toBe(true);

      // #65: subscriptionRepo を直接叩くのではなく billing.reactivateSubscription
      // (facade 経由。内部で Stripe 側の cancel_at_period_end も取り消す) を呼ぶこと
      expect(reactivateSpy).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("billing.reactivateSubscription が失敗したら profiles の deleted_at は復元されず 500 を返す", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const { app, setDeletedAtCalls } = await buildAppWithOverrides({
      initialDeletedAt: fiveDaysAgo,
      reactivateSubscriptionImpl: () =>
        Promise.resolve(err({ code: "INTERNAL_ERROR", message: "DB 障害", retryable: true })),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/restore",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      // profiles.deleted_at の restore (setProfileDeletedAt) は呼ばれていないこと
      expect(setDeletedAtCalls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("billing.reactivateSubscription が NOT_FOUND を返した場合は無視して復元を続行する (subscriptions 一時障害で退会取消をブロックしない)", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const { app, setDeletedAtCalls } = await buildAppWithOverrides({
      initialDeletedAt: fiveDaysAgo,
      reactivateSubscriptionImpl: () =>
        Promise.resolve(err({ code: "NOT_FOUND", message: "サブスクリプションが見つかりません", retryable: false })),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/restore",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      // profiles.deleted_at の復元 (setProfileDeletedAt) は実行されること
      expect(setDeletedAtCalls).toHaveLength(1);
      expect(setDeletedAtCalls[0]?.deletedAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});
