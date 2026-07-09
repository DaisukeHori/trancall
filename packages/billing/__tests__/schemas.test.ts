/**
 * @trancall/billing schemas テスト
 *
 * nullable 追従 (00019 migration): subscriptions.user_id は退会ユーザーの物理削除後に
 * NULL 化されうる (行自体は課金監査のため保持される)。SubscriptionRow.safeParse が
 * これをパースエラーにしないことを確認する。
 */

import { describe, it, expect } from "vitest";
import { SubscriptionRow } from "../src/schemas.js";

function makeValidRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: "00000000-0000-4000-8000-000000000001",
    plan_tier: "standard",
    included_minutes: 120,
    overage_rate_yen: 30,
    monthly_price_yen: 2980,
    transcript_retention_days: 90,
    cancel_at_period_end: false,
    purchase_channel: "stripe_web",
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
    iap_original_transaction_id: null,
    current_period_start: "2026-05-01T00:00:00.000Z",
    current_period_end: "2026-06-01T00:00:00.000Z",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SubscriptionRow — nullable 追従 (00019 migration)", () => {
  it("user_id が非 null なら従来通りパースされる", () => {
    const result = SubscriptionRow.safeParse(makeValidRow());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.user_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("user_id が null (退会済みユーザー物理削除) でもパースエラーにならない", () => {
    const result = SubscriptionRow.safeParse(makeValidRow({ user_id: null }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.user_id).toBeNull();
  });
});
