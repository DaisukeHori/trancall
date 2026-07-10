/**
 * アカウント退会・復元の原子性 + サブスク復元テスト (Issue #27)
 *
 * 1. 退会時、サブスクのキャンセルが失敗したら soft delete をロールバックすること
 *    (旧実装は「サブスク即時キャンセル (不可逆) → soft delete」の順で、
 *    soft delete 失敗時にサブスクだけ消える事故があった)。
 * 2. 退会は atPeriodEnd=true (期末キャンセル) を使い、plan_tier/channel/stripe ID を
 *    保持したままキャンセルすること (即時キャンセルだと grace period 中でも
 *    復元不能になっていた)。
 * 3. 復元時、cancel_at_period_end フラグを false に戻し、サブスクの表示状態を
 *    復元すること (旧実装は profiles.deleted_at のクリアのみでサブスク復元なし)。
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { ok, err } from "@trancall/shared-kernel";
import type { AppContainer } from "../container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

function makeProfilesMockChain(initialDeletedAt: string | null) {
  const updateCalls: Array<{ deleted_at: string | null }> = [];

  const mockQueryChain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn((arg: { deleted_at: string | null }) => {
      updateCalls.push(arg);
      return mockQueryChain;
    }),
    delete: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    lt: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { deleted_at: initialDeletedAt }, error: null }),
  };
  for (const key of Object.keys(mockQueryChain)) {
    if (!["single", "maybeSingle"].includes(key)) {
      const chain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
      if (typeof chain[key]?.mockReturnValue === "function" && key !== "update") {
        chain[key]?.mockReturnValue(mockQueryChain);
      }
    }
  }

  const mockFrom = vi.fn().mockReturnValue(mockQueryChain);
  const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });

  return { mockQueryChain, mockSchema, updateCalls };
}

async function buildAppWithOverrides(overrides: {
  initialDeletedAt: string | null;
  cancelSubscriptionImpl?: (...args: unknown[]) => unknown;
  subscriptionRepoOverrides?: Partial<AppContainer["subscriptionRepo"]>;
}): Promise<{ app: FastifyInstance; updateCalls: Array<{ deleted_at: string | null }>; container: AppContainer }> {
  const container = createMockContainer();
  const { mockSchema, updateCalls } = makeProfilesMockChain(overrides.initialDeletedAt);

  const anyContainer = container as unknown as Record<string, unknown>;
  const supabase = anyContainer["supabase"] as Record<string, unknown>;
  supabase["schema"] = mockSchema;

  if (overrides.cancelSubscriptionImpl) {
    (container.billing as unknown as Record<string, unknown>)["cancelSubscription"] = vi.fn(
      overrides.cancelSubscriptionImpl,
    );
  }
  if (overrides.subscriptionRepoOverrides) {
    Object.assign(container.subscriptionRepo, overrides.subscriptionRepoOverrides);
  }

  const app = await buildTestApp(container);
  return { app, updateCalls, container };
}

describe("POST /api/account/delete — 原子性 (#27)", () => {
  it("サブスクキャンセルが失敗したら soft delete をロールバックし 500 を返す", async () => {
    const { app, updateCalls } = await buildAppWithOverrides({
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

      // 1 回目: soft delete (deleted_at = ISO 文字列), 2 回目: ロールバック (deleted_at = null)
      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0]?.deleted_at).not.toBeNull();
      expect(updateCalls[1]?.deleted_at).toBeNull();
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

  it("正常系: soft delete が先に成功し、その後サブスクキャンセルが成功して 200 を返す (2 回 update は呼ばれない)", async () => {
    const { app, updateCalls } = await buildAppWithOverrides({ initialDeletedAt: null });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/delete",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]?.deleted_at).not.toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/account/restore — サブスク復元 (#27)", () => {
  it("cancel_at_period_end=true のサブスクは restore 時に false へ戻される (plan_tier 等は保持)", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const updatePlanSpy = vi.fn().mockResolvedValue(
      ok({
        id: "66666666-6666-4666-8666-666666666666",
        user_id: "11111111-1111-4111-8111-111111111111",
        plan_tier: "standard",
        included_minutes: 120,
        overage_rate_yen: 10,
        monthly_price_yen: 1980,
        transcript_retention_days: 30,
        cancel_at_period_end: false,
        purchase_channel: "stripe_web",
        stripe_customer_id: "cus_test123",
        stripe_subscription_id: "sub_test123",
        iap_original_transaction_id: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    );

    const { app } = await buildAppWithOverrides({
      initialDeletedAt: fiveDaysAgo,
      subscriptionRepoOverrides: {
        findByUserId: vi.fn().mockResolvedValue(
          ok({
            id: "66666666-6666-4666-8666-666666666666",
            user_id: "11111111-1111-4111-8111-111111111111",
            plan_tier: "standard",
            included_minutes: 120,
            overage_rate_yen: 10,
            monthly_price_yen: 1980,
            transcript_retention_days: 30,
            cancel_at_period_end: true,
            purchase_channel: "stripe_web",
            stripe_customer_id: "cus_test123",
            stripe_subscription_id: "sub_test123",
            iap_original_transaction_id: null,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        ),
        updatePlan: updatePlanSpy,
      },
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

      expect(updatePlanSpy).toHaveBeenCalledOnce();
      const [, params] = updatePlanSpy.mock.calls[0] ?? [];
      expect(params).toMatchObject({
        planTier: "standard",
        purchaseChannel: "stripe_web",
        stripeSubscriptionId: "sub_test123",
        cancelAtPeriodEnd: false,
      });
    } finally {
      await app.close();
    }
  });

  it("サブスク復元 (updatePlan) が失敗したら profiles の deleted_at は復元されず 500 を返す", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const { app, updateCalls } = await buildAppWithOverrides({
      initialDeletedAt: fiveDaysAgo,
      subscriptionRepoOverrides: {
        findByUserId: vi.fn().mockResolvedValue(
          ok({
            id: "66666666-6666-4666-8666-666666666666",
            user_id: "11111111-1111-4111-8111-111111111111",
            plan_tier: "standard",
            included_minutes: 120,
            overage_rate_yen: 10,
            monthly_price_yen: 1980,
            transcript_retention_days: 30,
            cancel_at_period_end: true,
            purchase_channel: "stripe_web",
            stripe_customer_id: "cus_test123",
            stripe_subscription_id: "sub_test123",
            iap_original_transaction_id: null,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        ),
        updatePlan: vi.fn().mockResolvedValue(
          err({ code: "INTERNAL_ERROR", message: "DB 障害", retryable: true }),
        ),
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/account/restore",
        headers: AUTH_HEADER,
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      // profiles.deleted_at の update (restore) は呼ばれていないこと
      expect(updateCalls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
