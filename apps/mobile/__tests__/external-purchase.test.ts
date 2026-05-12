/**
 * external-purchase.test.ts
 *
 * T-44: StoreKit External Purchase adapter のユニットテスト
 * docs/billing-ui-flow.md §8 / §14.2 準拠
 *
 * - deep link パース
 * - 対象国判定
 * - completeExternalPurchase 呼出
 * - フォールバック動作
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// モック: react-native
// vi.hoisted を使い vi.fn() をホイスト前に定義する
// =============================================================================

const {
  mockCanOpenURL,
  mockOpenURL,
  mockLinkingAddEventListener,
  mockGetInitialURL,
} = vi.hoisted(() => ({
  mockCanOpenURL: vi.fn().mockResolvedValue(true),
  mockOpenURL: vi.fn().mockResolvedValue(undefined),
  mockLinkingAddEventListener: vi.fn(() => ({ remove: vi.fn() })),
  mockGetInitialURL: vi.fn().mockResolvedValue(null),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
  Linking: {
    canOpenURL: mockCanOpenURL,
    openURL: mockOpenURL,
    addEventListener: mockLinkingAddEventListener,
    getInitialURL: mockGetInitialURL,
  },
}));

// =============================================================================
// モック: expo-localization
// vi.hoisted を使い vi.fn() をホイスト前に定義する
// =============================================================================

const { mockGetLocales } = vi.hoisted(() => ({
  mockGetLocales: vi.fn(),
}));

vi.mock("expo-localization", () => ({
  getLocales: mockGetLocales,
}));

// =============================================================================
// モック: react-native-iap (ExternalPurchaseLink なし→フォールバック動作)
// =============================================================================

vi.mock("react-native-iap", () => ({
  // ExternalPurchaseLink は定義しない → Linking.openURL フォールバックのテスト
}));

// =============================================================================
// テスト対象
// =============================================================================

import {
  isExternalPurchaseEligible,
  EXTERNAL_PURCHASE_ELIGIBLE_REGIONS,
  parseExternalSuccessLink,
  startExternalCheckout,
  openExternalPurchaseUrl,
} from "../src/lib/billing/external-purchase.js";

import {
  handleDeepLink,
  registerDeepLinkHandler,
} from "../src/lib/linking-config.js";

// =============================================================================
// テスト
// =============================================================================

describe("EXTERNAL_PURCHASE_ELIGIBLE_REGIONS", () => {
  it("対象国を含む", () => {
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("JP")).toBe(true);
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("DE")).toBe(true);
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("KR")).toBe(true);
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("IN")).toBe(true);
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("AU")).toBe(true);
  });

  it("非対象国を含まない", () => {
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("US")).toBe(false);
    expect(EXTERNAL_PURCHASE_ELIGIBLE_REGIONS.has("CN")).toBe(false);
  });
});

describe("isExternalPurchaseEligible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("JP ロケールの場合 true を返す", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "JP" }]);
    expect(isExternalPurchaseEligible()).toBe(true);
  });

  it("EU 加盟国 (DE) の場合 true を返す", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "DE" }]);
    expect(isExternalPurchaseEligible()).toBe(true);
  });

  it("非対象国 (US) の場合 false を返す", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "US" }]);
    expect(isExternalPurchaseEligible()).toBe(false);
  });

  it("regionCode が null の場合 false を返す", () => {
    mockGetLocales.mockReturnValue([{ regionCode: null }]);
    expect(isExternalPurchaseEligible()).toBe(false);
  });

  it("locales が空配列の場合 false を返す", () => {
    mockGetLocales.mockReturnValue([]);
    expect(isExternalPurchaseEligible()).toBe(false);
  });

  it("小文字の regionCode ('jp') でも true を返す", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "jp" }]);
    expect(isExternalPurchaseEligible()).toBe(true);
  });
});

describe("parseExternalSuccessLink", () => {
  it("正常系: token のみを含む deep link をパースする", () => {
    const url = "trancall://billing/external-success?token=redirect-token-abc";
    const result = parseExternalSuccessLink(url);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redirectToken).toBe("redirect-token-abc");
    expect(result.data.stripeSubscriptionId).toBe(""); // sub パラメータなし
    expect(result.data.completedAt).toBeTruthy(); // ISO 日時が入る
  });

  it("正常系: token + sub + at を含む deep link をパースする", () => {
    const completedAt = "2026-05-12T10:00:00.000Z";
    const url = `trancall://billing/external-success?token=tkn123&sub=sub_stripe456&at=${encodeURIComponent(completedAt)}`;
    const result = parseExternalSuccessLink(url);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redirectToken).toBe("tkn123");
    expect(result.data.stripeSubscriptionId).toBe("sub_stripe456");
    expect(result.data.completedAt).toBe(completedAt);
  });

  it("token が欠如している場合に BILLING_PAYMENT_FAILED を返す", () => {
    const url = "trancall://billing/external-success?sub=sub_stripe456";
    const result = parseExternalSuccessLink(url);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect(result.error.retryable).toBe(false);
  });

  it("不正な URL の場合に BILLING_PAYMENT_FAILED を返す", () => {
    const result = parseExternalSuccessLink("not-a-valid-url");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("パスが external-success 以外の場合に BILLING_PAYMENT_FAILED を返す", () => {
    const url = "trancall://billing/stripe-success?token=abc";
    const result = parseExternalSuccessLink(url);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

describe("openExternalPurchaseUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanOpenURL.mockResolvedValue(true);
    mockOpenURL.mockResolvedValue(undefined);
  });

  it("フォールバック: Linking.openURL で URL を開く", async () => {
    const url = "https://checkout.stripe.com/pay/cs_test_abc";
    const result = await openExternalPurchaseUrl(url);

    expect(result.ok).toBe(true);
    expect(mockOpenURL).toHaveBeenCalledWith(url);
  });

  it("canOpenURL が false の場合に BILLING_CHANNEL_NOT_AVAILABLE を返す", async () => {
    mockCanOpenURL.mockResolvedValue(false);

    const result = await openExternalPurchaseUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_CHANNEL_NOT_AVAILABLE");
  });

  it("openURL が例外を throw した場合に BILLING_PAYMENT_FAILED を返す", async () => {
    mockOpenURL.mockRejectedValue(new Error("Cannot open URL"));

    const result = await openExternalPurchaseUrl("https://example.com");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect(result.error.retryable).toBe(true);
  });
});

describe("startExternalCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanOpenURL.mockResolvedValue(true);
    mockOpenURL.mockResolvedValue(undefined);
    mockGetLocales.mockReturnValue([{ regionCode: "JP" }]);
  });

  it("対象国 (JP) で正常に checkout を開始する", async () => {
    const mockFetchRedirectUrl = vi.fn().mockResolvedValue({
      ok: true,
      data: { redirectUrl: "https://checkout.stripe.com/pay/cs_abc" },
    });

    const result = await startExternalCheckout({
      targetTier: "standard",
      fetchRedirectUrl: mockFetchRedirectUrl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redirectUrl).toBe("https://checkout.stripe.com/pay/cs_abc");
    expect(mockFetchRedirectUrl).toHaveBeenCalledWith("standard");
    expect(mockOpenURL).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/cs_abc",
    );
  });

  it("非対象国 (US) の場合に BILLING_CHANNEL_NOT_AVAILABLE を返し onFallbackToStripe を呼ぶ", async () => {
    mockGetLocales.mockReturnValue([{ regionCode: "US" }]);
    const mockFallback = vi.fn();

    const result = await startExternalCheckout({
      targetTier: "standard",
      fetchRedirectUrl: vi.fn(),
      onFallbackToStripe: mockFallback,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_CHANNEL_NOT_AVAILABLE");
    expect(mockFallback).toHaveBeenCalledWith("standard");
  });

  it("fetchRedirectUrl が失敗した場合にエラーを伝播する", async () => {
    const mockFetchRedirectUrl = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "BILLING_PAYMENT_FAILED", message: "server error", retryable: true },
    });

    const result = await startExternalCheckout({
      targetTier: "standard",
      fetchRedirectUrl: mockFetchRedirectUrl,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

describe("handleDeepLink (linking-config)", () => {
  it("external-success deep link で onExternalSuccess を呼び出す", () => {
    const onExternalSuccess = vi.fn();

    handleDeepLink(
      "trancall://billing/external-success?token=test-token-xyz",
      { onExternalSuccess },
    );

    expect(onExternalSuccess).toHaveBeenCalledWith({
      redirectToken: "test-token-xyz",
      stripeSubscriptionId: "",
      completedAt: expect.any(String),
    });
  });

  it("stripe-success deep link で onStripeSuccess を呼び出す", () => {
    const onStripeSuccess = vi.fn();

    handleDeepLink(
      "trancall://billing/stripe-success?session_id=cs_test_abc",
      { onStripeSuccess },
    );

    expect(onStripeSuccess).toHaveBeenCalledWith("cs_test_abc");
  });

  it("stripe-cancel deep link で onStripeCancel を呼び出す", () => {
    const onStripeCancel = vi.fn();

    handleDeepLink("trancall://billing/stripe-cancel", { onStripeCancel });

    expect(onStripeCancel).toHaveBeenCalled();
  });

  it("不正な URL は無視する (例外を throw しない)", () => {
    const onStripeSuccess = vi.fn();

    expect(() => {
      handleDeepLink("not-a-valid-url", { onStripeSuccess });
    }).not.toThrow();

    expect(onStripeSuccess).not.toHaveBeenCalled();
  });

  it("別スキームの URL は無視する", () => {
    const onExternalSuccess = vi.fn();

    handleDeepLink(
      "https://example.com/billing/external-success?token=abc",
      { onExternalSuccess },
    );

    expect(onExternalSuccess).not.toHaveBeenCalled();
  });

  it("token が欠如した external-success deep link は onExternalSuccess を呼ばない", () => {
    const onExternalSuccess = vi.fn();

    handleDeepLink(
      "trancall://billing/external-success?sub=sub_stripe",
      { onExternalSuccess },
    );

    // パースエラーのため onExternalSuccess は呼ばれない
    expect(onExternalSuccess).not.toHaveBeenCalled();
  });
});

describe("registerDeepLinkHandler (linking-config)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInitialURL.mockResolvedValue(null);
  });

  it("Linking.addEventListener を登録して cleanup 関数を返す", () => {
    const mockRemove = vi.fn();
    mockLinkingAddEventListener.mockReturnValue({ remove: mockRemove });

    const cleanup = registerDeepLinkHandler({
      onStripeSuccess: vi.fn(),
    });

    expect(mockLinkingAddEventListener).toHaveBeenCalledWith(
      "url",
      expect.any(Function),
    );

    cleanup();
    expect(mockRemove).toHaveBeenCalled();
  });

  it("アプリ起動時の初期 URL (external-success) を処理する", async () => {
    const onExternalSuccess = vi.fn();
    mockGetInitialURL.mockResolvedValue(
      "trancall://billing/external-success?token=initial-token",
    );
    mockLinkingAddEventListener.mockReturnValue({ remove: vi.fn() });

    registerDeepLinkHandler({ onExternalSuccess });

    // getInitialURL は async なので次のマイクロタスクで処理される
    await Promise.resolve();

    expect(onExternalSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ redirectToken: "initial-token" }),
    );
  });
});
