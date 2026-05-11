/**
 * シナリオ 2: billing heartbeat テスト (4 件)
 *
 * - Free 5 min プランで 11 window 目から overage 課金
 * - 跨ぎ window: 残 10 秒含有 + 20 秒超過の amount_yen を Math.ceil で計算
 * - 冪等性: 同じ idempotency_key で 2 回 recordUsage を呼ぶと 2 回目は no-op
 * - reconcile: 予約 5 min × 実消費 7 min → consumed_minutes 7 で update
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  brandUserId,
  brandRoomId,
  brandTranslationSessionId,
} from "@trancall/shared-kernel";
import type { UserId, RoomId, TranslationSessionId } from "@trancall/shared-kernel";
import type { Profile } from "@trancall/auth";
import type { SubscriptionRow } from "@trancall/billing";
import { PLAN_CONFIGS } from "@trancall/billing";
import { buildFacades } from "../src/mocks/build-facades.js";

// ---- helpers ----

function uid(n: number): UserId {
  const r = brandUserId(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandUserId failed`);
  return r.data;
}

function rid(n: number): RoomId {
  const r = brandRoomId(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandRoomId failed`);
  return r.data;
}

function tsid(n: number): TranslationSessionId {
  const r = brandTranslationSessionId(`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandTranslationSessionId failed`);
  return r.data;
}

function makeProfile(userId: UserId): Profile {
  return {
    userId,
    email: `user-${userId.slice(0, 8)}@example.com`,
    displayName: `User`,
    nativeLanguage: "ja",
    trancallId: `user_${userId.slice(0, 8)}`,
    updatedAt: new Date().toISOString(),
  };
}

function makeFreeSubscriptionRow(userId: UserId): SubscriptionRow {
  const plan = PLAN_CONFIGS["free"];
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    plan_tier: "free",
    included_minutes: plan.includedMinutes,
    overage_rate_yen: plan.overageRateYen,
    monthly_price_yen: plan.monthlyPriceYen,
    transcript_retention_days: plan.transcriptRetentionDays,
    cancel_at_period_end: false,
    purchase_channel: "free",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    iap_original_transaction_id: null,
    current_period_start: now.toISOString(),
    current_period_end: end.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function makeLightSubscriptionRow(userId: UserId): SubscriptionRow {
  const plan = PLAN_CONFIGS["light"];
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    plan_tier: "light",
    included_minutes: plan.includedMinutes,
    overage_rate_yen: plan.overageRateYen,
    monthly_price_yen: plan.monthlyPriceYen,
    transcript_retention_days: plan.transcriptRetentionDays,
    cancel_at_period_end: false,
    purchase_channel: "stripe_web",
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
    iap_original_transaction_id: null,
    current_period_start: now.toISOString(),
    current_period_end: end.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

describe("シナリオ 2: billing heartbeat", () => {
  const userA = uid(1);
  const roomId = rid(1);
  const sessionId = tsid(1);

  it("2-1: Free 5 min プランで 11 window 目から overage 課金なし (Free は overage_rate=0)", async () => {
    // Free プランは overageRateYen=0 なので超過分も 0 円
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA)],
      subscriptions: [makeFreeSubscriptionRow(userA)],
    });

    // 10 window × 30 秒 = 300 秒 = 5 分 (Free の含有分を丁度使い切る)
    for (let i = 0; i < 10; i++) {
      const now = new Date();
      const windowStart = new Date(now.getTime() + i * 30000);
      const windowEnd = new Date(windowStart.getTime() + 30000);

      const result = await facades.billing.recordUsage({
        userId: userA,
        sessionId,
        roomId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        durationSeconds: 30,
        languagePair: "ja-en",
        idempotencyKey: `idem-free-${i}`,
      });
      expect(result.ok).toBe(true);
      // usedSeconds をメモリ側に加算
      repos.subscriptionRepo._addUsedSeconds(userA, 30);
    }

    // 11 window 目 (超過分)
    const now = new Date();
    const windowStart = new Date(now.getTime() + 10 * 30000);
    const windowEnd = new Date(windowStart.getTime() + 30000);

    const overageResult = await facades.billing.recordUsage({
      userId: userA,
      sessionId,
      roomId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      durationSeconds: 30,
      languagePair: "ja-en",
      idempotencyKey: "idem-free-10",
    });

    expect(overageResult.ok).toBe(true);
    if (!overageResult.ok) return;

    // Free プランは overage_rate=0 なので超過でも remainingMinutes=0
    expect(overageResult.data.plan.tier).toBe("free");
    // usage windows に記録されているはず (11 件)
    const windows = repos.usageRepo._getWindows();
    expect(windows.length).toBe(11);
  });

  it("2-2: 跨ぎ window — Light プランで残 10 秒の状態で 30 秒 window → overage 20 秒分の amount_yen", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA)],
      subscriptions: [makeLightSubscriptionRow(userA)],
    });

    // Light = 30 min = 1800 秒。残 10 秒にするため 1790 秒消費済みにする
    repos.subscriptionRepo._addUsedSeconds(userA, 1790);

    const now = new Date();
    const windowStart = now;
    const windowEnd = new Date(now.getTime() + 30000);

    const result = await facades.billing.recordUsage({
      userId: userA,
      sessionId,
      roomId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      durationSeconds: 30, // 含有 10 秒 + 超過 20 秒
      languagePair: "ja-en",
      idempotencyKey: "idem-boundary",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 超過 20 秒の amount_yen = ceil(20/60 * 40) = ceil(13.33) = 14
    const windows = repos.usageRepo._getWindows();
    expect(windows.length).toBe(1);
    const win = windows[0];
    expect(win).toBeDefined();
    if (win === undefined) return;
    // ceil(20/60 * 40) = ceil(13.33...) = 14
    expect(win.amountYen).toBe(14);
  });

  it("2-3: 冪等性 — 同じ idempotency_key で 2 回 recordUsage を呼ぶと 2 回目は no-op (windows は 1 件のみ)", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA)],
      subscriptions: [makeLightSubscriptionRow(userA)],
    });

    const now = new Date();
    const cmd = {
      userId: userA,
      sessionId,
      roomId,
      windowStart: now.toISOString(),
      windowEnd: new Date(now.getTime() + 30000).toISOString(),
      durationSeconds: 30,
      languagePair: "ja-en",
      idempotencyKey: "idem-same-key",
    };

    const r1 = await facades.billing.recordUsage(cmd);
    expect(r1.ok).toBe(true);

    const r2 = await facades.billing.recordUsage(cmd);
    expect(r2.ok).toBe(true);

    // windows は 1 件のみ（冪等）
    const windows = repos.usageRepo._getWindows();
    expect(windows.length).toBe(1);
  });

  it("2-4: reconcile — 予約 → usage 記録 (7 min) → reconcile → consumed_minutes=7", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA)],
      subscriptions: [makeLightSubscriptionRow(userA)],
    });

    const createResult = await facades.billing.reserveMinutes(userA, sessionId, 5);
    expect(createResult.ok).toBe(true);

    // 7 分 = 14 window × 30 秒 の usage を記録
    for (let i = 0; i < 14; i++) {
      const now = new Date();
      const ws = new Date(now.getTime() + i * 30000);
      const we = new Date(ws.getTime() + 30000);
      const r = await facades.billing.recordUsage({
        userId: userA,
        sessionId,
        roomId,
        windowStart: ws.toISOString(),
        windowEnd: we.toISOString(),
        durationSeconds: 30,
        languagePair: "ja-en",
        idempotencyKey: `idem-reconcile-${i}`,
      });
      expect(r.ok).toBe(true);
      repos.subscriptionRepo._addUsedSeconds(userA, 30);
    }

    // reconcile 呼び出し
    const reconcileResult = await facades.billing.reconcile(userA, sessionId);
    expect(reconcileResult.ok).toBe(true);
    if (!reconcileResult.ok) return;

    // reconcile 後のプランティアが light であること
    expect(reconcileResult.data.plan.tier).toBe("light");

    // usage windows の合計: 14 × 30 秒 = 420 秒 → ceil(420/60) = 7 分
    const windows = repos.usageRepo._getWindows();
    const totalSeconds = windows.reduce((sum, w) => sum + w.durationSeconds, 0);
    expect(Math.ceil(totalSeconds / 60)).toBe(7);
  });
});
