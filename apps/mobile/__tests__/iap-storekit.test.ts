/**
 * iap-storekit.test.ts
 *
 * T-43: iOS App Store IAP (StoreKit 2) adapter のユニットテスト
 * docs/billing-ui-flow.md §7 / §14.2 準拠
 *
 * react-native-iap は native module を必要とするため、
 * テスト環境では全てモックする。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// react-native のモック
// =============================================================================

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

// =============================================================================
// react-native-iap のモック
// =============================================================================

const mockInitConnection = vi.fn().mockResolvedValue(true);
const mockGetSubscriptions = vi.fn();
const mockRequestSubscription = vi.fn();
const mockFinishTransaction = vi.fn().mockResolvedValue("ok");
const mockGetAvailablePurchases = vi.fn();

vi.mock("react-native-iap", () => ({
  initConnection: mockInitConnection,
  getSubscriptions: mockGetSubscriptions,
  requestSubscription: mockRequestSubscription,
  finishTransaction: mockFinishTransaction,
  getAvailablePurchases: mockGetAvailablePurchases,
  purchaseUpdatedListener: vi.fn(() => ({ remove: vi.fn() })),
  purchaseErrorListener: vi.fn(() => ({ remove: vi.fn() })),
  endConnection: vi.fn().mockResolvedValue(undefined),
}));

// =============================================================================
// テスト対象
// =============================================================================

import {
  IAP_PRODUCT_IDS,
  resolveProductTier,
  getIapProducts,
  purchasePlan,
  finishIapTransaction,
  getRestoredTransactions,
} from "../src/lib/billing/iap-storekit.js";

// =============================================================================
// テストフィクスチャ
// =============================================================================

const MOCK_LIGHT_PRODUCT_ID = IAP_PRODUCT_IDS.light;
const MOCK_STANDARD_PRODUCT_ID = IAP_PRODUCT_IDS.standard;
const MOCK_BUSINESS_PRODUCT_ID = IAP_PRODUCT_IDS.business;

const mockIapSubscription = (productId: string) => ({
  productId,
  localizedPrice: "¥980",
  currency: "JPY",
  title: "TranCall Light",
  description: "30 分/月プラン",
});

const mockPurchase = {
  productId: MOCK_LIGHT_PRODUCT_ID,
  transactionId: "txn-001",
  originalTransactionIdentifierIOS: "original-txn-001",
  transactionDate: 1715000000000,
  jwsRepresentation: "signed.jws.token.for.light",
};

const mockPurchaseWithReceipt = {
  productId: MOCK_STANDARD_PRODUCT_ID,
  transactionId: "txn-002",
  originalTransactionIdentifierIOS: "original-txn-002",
  transactionDate: 1715000000000,
  transactionReceipt: "legacy.receipt.token",
  // jwsRepresentation なし → transactionReceipt にフォールバック
};

// =============================================================================
// テスト
// =============================================================================

describe("IAP_PRODUCT_IDS", () => {
  it("3 つの productId が定義されている", () => {
    expect(IAP_PRODUCT_IDS.light).toBe("com.trancall.subscription.light.monthly");
    expect(IAP_PRODUCT_IDS.standard).toBe("com.trancall.subscription.standard.monthly");
    expect(IAP_PRODUCT_IDS.business).toBe("com.trancall.subscription.business.monthly");
  });
});

describe("resolveProductTier", () => {
  it("既知の productId から tier を返す", () => {
    expect(resolveProductTier(MOCK_LIGHT_PRODUCT_ID)).toBe("light");
    expect(resolveProductTier(MOCK_STANDARD_PRODUCT_ID)).toBe("standard");
    expect(resolveProductTier(MOCK_BUSINESS_PRODUCT_ID)).toBe("business");
  });

  it("未知の productId に対して null を返す", () => {
    expect(resolveProductTier("com.unknown.product")).toBeNull();
    expect(resolveProductTier("")).toBeNull();
  });
});

describe("getIapProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("App Store から IAP 商品情報を取得して IapProductInfo の配列を返す", async () => {
    mockGetSubscriptions.mockResolvedValue([
      mockIapSubscription(MOCK_LIGHT_PRODUCT_ID),
      mockIapSubscription(MOCK_STANDARD_PRODUCT_ID),
      mockIapSubscription(MOCK_BUSINESS_PRODUCT_ID),
    ]);

    const result = await getIapProducts();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(3);
    expect(result.data[0]?.tier).toBe("light");
    expect(result.data[0]?.localizedPrice).toBe("¥980");
    expect(result.data[0]?.productId).toBe(MOCK_LIGHT_PRODUCT_ID);
  });

  it("未知の productId を含む場合は除外する", async () => {
    mockGetSubscriptions.mockResolvedValue([
      mockIapSubscription(MOCK_LIGHT_PRODUCT_ID),
      { productId: "com.unknown.product", localizedPrice: "¥0" },
    ]);

    const result = await getIapProducts();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.tier).toBe("light");
  });

  it("getSubscriptions が失敗した場合に BILLING_CHANNEL_NOT_AVAILABLE エラーを返す", async () => {
    mockGetSubscriptions.mockRejectedValue(new Error("Network unavailable"));

    const result = await getIapProducts();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_CHANNEL_NOT_AVAILABLE");
    expect(result.error.retryable).toBe(true);
  });
});

describe("purchasePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: requestSubscription 成功後に IapTransactionResult を返す", async () => {
    mockRequestSubscription.mockResolvedValue(mockPurchase);

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.transaction.originalTransactionId).toBe("original-txn-001");
    expect(result.data.transaction.productId).toBe(MOCK_LIGHT_PRODUCT_ID);
    expect(result.data.transaction.signedJws).toBe("signed.jws.token.for.light");
    expect(result.data.tier).toBe("light");
  });

  it("jwsRepresentation がない場合 transactionReceipt を signedJws として使用する", async () => {
    mockRequestSubscription.mockResolvedValue(mockPurchaseWithReceipt);

    const result = await purchasePlan(MOCK_STANDARD_PRODUCT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transaction.signedJws).toBe("legacy.receipt.token");
    expect(result.data.tier).toBe("standard");
  });

  it("requestSubscription が配列を返した場合に先頭要素を使用する", async () => {
    mockRequestSubscription.mockResolvedValue([mockPurchase]);

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transaction.productId).toBe(MOCK_LIGHT_PRODUCT_ID);
  });

  it("無効な productId の場合に BILLING_CHANNEL_NOT_AVAILABLE を返す", async () => {
    const result = await purchasePlan("com.invalid.product");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_CHANNEL_NOT_AVAILABLE");
    expect(result.error.retryable).toBe(false);
  });

  it("ユーザーがキャンセルした場合に E_USER_CANCELLED エラーを返す", async () => {
    mockRequestSubscription.mockRejectedValue({
      code: "E_USER_CANCELLED",
      message: "User cancelled",
    });

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("E_USER_CANCELLED");
    expect(result.error.retryable).toBe(false);
  });

  it("支払い失敗 (E_PURCHASE_ERROR) の場合に BILLING_PAYMENT_FAILED を返す", async () => {
    mockRequestSubscription.mockRejectedValue({
      code: "E_PURCHASE_ERROR",
      message: "Payment failed",
    });

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect(result.error.retryable).toBe(true);
  });

  it("requestSubscription が null を返した場合に BILLING_PAYMENT_FAILED を返す", async () => {
    mockRequestSubscription.mockResolvedValue(null);

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("signedJws が空の場合に BILLING_IAP_RECEIPT_INVALID を返す", async () => {
    mockRequestSubscription.mockResolvedValue({
      ...mockPurchase,
      jwsRepresentation: undefined,
      transactionReceipt: undefined,
    });

    const result = await purchasePlan(MOCK_LIGHT_PRODUCT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    expect(result.error.retryable).toBe(false);
  });
});

describe("finishIapTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finishTransaction を呼び出す (非致命的操作)", async () => {
    await finishIapTransaction("original-txn-001", MOCK_LIGHT_PRODUCT_ID);

    expect(mockFinishTransaction).toHaveBeenCalledWith({
      purchase: {
        productId: MOCK_LIGHT_PRODUCT_ID,
        originalTransactionIdentifierIOS: "original-txn-001",
        transactionId: "original-txn-001",
      },
      isConsumable: false,
    });
  });

  it("finishTransaction が失敗しても例外を throw しない", async () => {
    mockFinishTransaction.mockRejectedValue(new Error("Already finished"));

    await expect(
      finishIapTransaction("original-txn-001", MOCK_LIGHT_PRODUCT_ID),
    ).resolves.toBeUndefined();
  });
});

describe("getRestoredTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("利用可能な purchases を IapTransactionResult の配列に変換して返す", async () => {
    mockGetAvailablePurchases.mockResolvedValue([
      mockPurchase,
      mockPurchaseWithReceipt,
    ]);

    const result = await getRestoredTransactions();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.signedJws).toBe("signed.jws.token.for.light");
    expect(result.data[1]?.signedJws).toBe("legacy.receipt.token");
  });

  it("signedJws がない purchase は除外する", async () => {
    mockGetAvailablePurchases.mockResolvedValue([
      mockPurchase,
      {
        productId: MOCK_BUSINESS_PRODUCT_ID,
        transactionId: "txn-003",
        // JWS なし
      },
    ]);

    const result = await getRestoredTransactions();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
  });

  it("getAvailablePurchases が失敗した場合に BILLING_IAP_RECEIPT_INVALID を返す", async () => {
    mockGetAvailablePurchases.mockRejectedValue(new Error("Connection error"));

    const result = await getRestoredTransactions();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    expect(result.error.retryable).toBe(false);
  });
});
