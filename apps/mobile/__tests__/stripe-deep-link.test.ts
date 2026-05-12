/**
 * stripe-deep-link.test.ts
 *
 * T-42: Stripe Web Checkout deep link ハンドラーのユニットテスト
 * docs/billing-ui-flow.md §6.3 Step 5 / §8.3 Step 5-6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mock @trancall/billing
// ============================================================================
vi.mock("@trancall/billing", () => {
  const z = require("zod").z ?? require("zod");
  return {
    StoreKitExternalRedirectResultSchema: z.object({
      redirectToken: z.string(),
      stripeSubscriptionId: z.string(),
      completedAt: z.string(),
    }),
  };
});

import { handleStripeDeepLink } from "../src/lib/billing/stripe-deep-link.js";
import type { StripeDeepLinkHandlers } from "../src/lib/billing/stripe-deep-link.js";

// ============================================================================
// Test fixtures
// ============================================================================

interface TestHandlers {
  onStripeSuccess: ReturnType<typeof vi.fn>;
  onStripeCanceled: ReturnType<typeof vi.fn>;
  onExternalPurchaseSuccess: ReturnType<typeof vi.fn>;
}

function makeHandlers(overrides: Partial<StripeDeepLinkHandlers> = {}): TestHandlers {
  const handlers: TestHandlers = {
    onStripeSuccess: vi.fn().mockResolvedValue(undefined),
    onStripeCanceled: vi.fn(),
    onExternalPurchaseSuccess: vi.fn().mockResolvedValue(undefined),
  };
  // Apply overrides (spread is not used for type safety; use Object.assign)
  if (overrides.onStripeSuccess != null) {
    handlers.onStripeSuccess = vi.fn().mockImplementation(overrides.onStripeSuccess);
  }
  if (overrides.onStripeCanceled != null) {
    handlers.onStripeCanceled = vi.fn().mockImplementation(overrides.onStripeCanceled);
  }
  if (overrides.onExternalPurchaseSuccess != null) {
    handlers.onExternalPurchaseSuccess = vi.fn().mockImplementation(overrides.onExternalPurchaseSuccess);
  }
  return handlers;
}

// ============================================================================
// Tests
// ============================================================================

describe("handleStripeDeepLink", () => {
  // ==========================================================================
  // Stripe Success deep link
  // ==========================================================================

  describe("trancall://billing/stripe-success", () => {
    it("session_id があれば onStripeSuccess を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/stripe-success?session_id=cs_test_abc123",
        handlers,
      );
      expect(handlers.onStripeSuccess).toHaveBeenCalledWith("cs_test_abc123");
      expect(handlers.onStripeCanceled).not.toHaveBeenCalled();
    });

    it("session_id がない場合は onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/stripe-success",
        handlers,
      );
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).toHaveBeenCalled();
    });

    it("session_id が空文字の場合は onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/stripe-success?session_id=",
        handlers,
      );
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).toHaveBeenCalled();
    });

    it("URL エンコードされた session_id を正しくデコードする", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/stripe-success?session_id=cs_test_abc%20123",
        handlers,
      );
      expect(handlers.onStripeSuccess).toHaveBeenCalledWith("cs_test_abc 123");
    });
  });

  // ==========================================================================
  // Stripe Cancel deep link
  // ==========================================================================

  describe("trancall://billing/stripe-cancel", () => {
    it("onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink("trancall://billing/stripe-cancel", handlers);
      expect(handlers.onStripeCanceled).toHaveBeenCalledOnce();
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
    });

    it("クエリパラメータがあっても onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/stripe-cancel?reason=user_canceled",
        handlers,
      );
      expect(handlers.onStripeCanceled).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // External Purchase Success deep link
  // ==========================================================================

  describe("trancall://billing/external-success", () => {
    it("token・stripe_subscription_id・completed_at 揃いで onExternalPurchaseSuccess を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/external-success?token=redirect-token-xyz&stripe_subscription_id=sub_abc&completed_at=2026-05-12T00%3A00%3A00.000Z",
        handlers,
      );
      expect(handlers.onExternalPurchaseSuccess).toHaveBeenCalledWith({
        redirectToken: "redirect-token-xyz",
        stripeSubscriptionId: "sub_abc",
        completedAt: "2026-05-12T00:00:00.000Z",
      });
    });

    it("token のみで onExternalPurchaseSuccess を呼び出す (optional フィールドのデフォルト動作)", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/external-success?token=redirect-token-xyz",
        handlers,
      );
      expect(handlers.onExternalPurchaseSuccess).toHaveBeenCalledOnce();
      // redirectToken が正しく渡っているか
      expect(handlers.onExternalPurchaseSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ redirectToken: "redirect-token-xyz" }),
      );
    });

    it("token がない場合は onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/external-success?stripe_subscription_id=sub_abc",
        handlers,
      );
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).toHaveBeenCalled();
    });

    it("クエリパラメータなしで onStripeCanceled を呼び出す", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink(
        "trancall://billing/external-success",
        handlers,
      );
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // billing 以外の deep link は無視
  // ==========================================================================

  describe("billing 以外の deep link", () => {
    it("trancall://call/xxx は全ハンドラーを呼ばない", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink("trancall://call/incoming?id=123", handlers);
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).not.toHaveBeenCalled();
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
    });

    it("https:// URL は全ハンドラーを呼ばない", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink("https://example.com/billing", handlers);
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).not.toHaveBeenCalled();
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
    });

    it("空文字は全ハンドラーを呼ばない", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink("", handlers);
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).not.toHaveBeenCalled();
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
    });

    it("未知の billing パスは全ハンドラーを呼ばない", async () => {
      const handlers = makeHandlers();
      await handleStripeDeepLink("trancall://billing/unknown-path", handlers);
      expect(handlers.onStripeSuccess).not.toHaveBeenCalled();
      expect(handlers.onStripeCanceled).not.toHaveBeenCalled();
      expect(handlers.onExternalPurchaseSuccess).not.toHaveBeenCalled();
    });
  });
});
