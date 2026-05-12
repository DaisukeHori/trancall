/**
 * IapAdapter テスト
 *
 * - verifyIapTransaction: 正常系・異常系 (signedJws 検証)
 * - resolveTier: 正常系・未知 productId
 * - selectLatestTransaction: 最新選択
 */

import { describe, expect, it } from "vitest";
import { createIapAdapter, APPLE_IAP_PRODUCT_ID_MAP } from "../src/adapters/iap-adapter.js";
import type { IapTransactionResult } from "../src/view-models/index.js";

// =============================================================================
// ヘルパー: JWS 生成
// =============================================================================

function makeJws(payload: Record<string, unknown>): string {
  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFUzI1NiJ9.${base64}.fakesig`;
}

const FUTURE_DATE = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 日後

function makeValidJwsPayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: "tx_001",
    originalTransactionId: "orig_tx_001",
    bundleId: "com.trancall.app",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: Date.now(),
    originalPurchaseDate: Date.now(),
    expiresDate: FUTURE_DATE,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<IapTransactionResult> = {}): IapTransactionResult {
  const payload = makeValidJwsPayload();
  return {
    originalTransactionId: "orig_tx_001",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: new Date(payload.purchaseDate as number).toISOString(),
    expirationDate: new Date(FUTURE_DATE).toISOString(),
    signedJws: makeJws(payload),
    isUpgrade: false,
    ...overrides,
  };
}

// =============================================================================
// テスト
// =============================================================================

describe("APPLE_IAP_PRODUCT_ID_MAP", () => {
  it("docs/billing-ui-flow.md §7.2 の productId 命名規則に準拠している", () => {
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.light.monthly"]).toBe("light");
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.standard.monthly"]).toBe("standard");
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.business.monthly"]).toBe("business");
  });
});

describe("IapAdapter.verifyIapTransaction", () => {
  const adapter = createIapAdapter();

  it("正常系: 有効な JWS で VerifiedIapTransaction が返る", async () => {
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tier).toBe("light");
    expect(result.data.originalTransactionId).toBe("orig_tx_001");
    expect(result.data.isValid).toBe(true);
  });

  it("異常系: 不正な JWS 形式 (3 パート未満) で BILLING_IAP_RECEIPT_INVALID", async () => {
    const transaction = makeTransaction({ signedJws: "only.two" });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: Base64URL デコード失敗 で BILLING_IAP_RECEIPT_INVALID", async () => {
    const transaction = makeTransaction({ signedJws: "header.!!!invalid!!!.sig" });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: 未知の productId で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({
      productId: "com.unknown.product",
    });
    const transaction = makeTransaction({
      signedJws: makeJws(payload),
      productId: "com.unknown.product",
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: originalTransactionId 不一致 で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({ originalTransactionId: "orig_tx_DIFFERENT" });
    const transaction = makeTransaction({
      signedJws: makeJws(payload),
      originalTransactionId: "orig_tx_001", // JWS の値と不一致
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: 有効期限切れ transaction で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({
      expiresDate: Date.now() - 1000, // 過去
    });
    const transaction = makeTransaction({
      signedJws: makeJws(payload),
      expirationDate: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });
});

describe("IapAdapter.resolveTier", () => {
  const adapter = createIapAdapter();

  it("既知の productId を PlanTier に解決できる", () => {
    expect(adapter.resolveTier("com.trancall.subscription.light.monthly")).toBe("light");
    expect(adapter.resolveTier("com.trancall.subscription.standard.monthly")).toBe("standard");
    expect(adapter.resolveTier("com.trancall.subscription.business.monthly")).toBe("business");
  });

  it("未知の productId は null を返す", () => {
    expect(adapter.resolveTier("com.unknown.product")).toBeNull();
  });
});

describe("IapAdapter.selectLatestTransaction", () => {
  const adapter = createIapAdapter();

  it("空配列は null を返す", () => {
    expect(adapter.selectLatestTransaction([])).toBeNull();
  });

  it("1 件はそのまま返す", () => {
    const tx = {
      originalTransactionId: "tx_001",
      productId: "com.trancall.subscription.light.monthly",
      tier: "light" as const,
      purchaseDate: "2026-05-01T00:00:00.000Z",
      expirationDate: "2026-06-01T00:00:00.000Z",
      isValid: true,
    };
    expect(adapter.selectLatestTransaction([tx])).toEqual(tx);
  });

  it("複数件から purchaseDate が最新のものを返す", () => {
    const older = {
      originalTransactionId: "tx_001",
      productId: "com.trancall.subscription.light.monthly",
      tier: "light" as const,
      purchaseDate: "2026-04-01T00:00:00.000Z",
      expirationDate: "2026-05-01T00:00:00.000Z",
      isValid: true,
    };
    const newer = {
      originalTransactionId: "tx_002",
      productId: "com.trancall.subscription.standard.monthly",
      tier: "standard" as const,
      purchaseDate: "2026-05-01T00:00:00.000Z",
      expirationDate: "2026-06-01T00:00:00.000Z",
      isValid: true,
    };
    expect(adapter.selectLatestTransaction([older, newer])).toEqual(newer);
    expect(adapter.selectLatestTransaction([newer, older])).toEqual(newer);
  });
});
