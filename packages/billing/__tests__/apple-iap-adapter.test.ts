/**
 * AppleIapAdapter テスト
 *
 * - parseWebhookPayload: JWS ペイロードデコード
 * - shouldProcessNotification / isActive 判定
 * - M-8: apple-iap-adapter.ts / iap-adapter.ts の productId マッピングが
 *   canonical (APPLE_IAP_PRODUCT_ID_MAP) に一本化されていることの回帰テスト
 */

import { describe, expect, it } from "vitest";
import { createAppleIapAdapter } from "../src/adapters/apple-iap-adapter.js";
import { createIapAdapter, APPLE_IAP_PRODUCT_ID_MAP } from "../src/adapters/iap-adapter.js";

// --- JWS テスト用ヘルパー ---

function buildJws(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

function buildNotificationPayload(
  notificationType: string,
  transactionPayload: Record<string, unknown>,
) {
  const signedTransactionInfo = buildJws(transactionPayload);
  return {
    notificationType,
    notificationUUID: "00000000-0000-4000-8000-000000000001",
    data: {
      bundleId: "app.trancall",
      environment: "Sandbox",
      signedTransactionInfo,
    },
    version: "2.0",
    signedDate: Date.now(),
  };
}

// canonical productId 形式 (docs/billing-ui-flow.md §7.2)
const validTransaction = {
  transactionId: "tx_001",
  originalTransactionId: "orig_001",
  bundleId: "app.trancall",
  productId: "com.trancall.subscription.standard.monthly",
  purchaseDate: Date.now(),
  originalPurchaseDate: Date.now(),
  expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  type: "Auto-Renewable Subscription",
  environment: "Sandbox",
};

// --- テスト ---

describe("AppleIapAdapter.parseWebhookPayload", () => {
  it("SUBSCRIBED 通知を正常にパース", () => {
    const adapter = createAppleIapAdapter();
    const payload = buildNotificationPayload("SUBSCRIBED", validTransaction);

    const result = adapter.parseWebhookPayload(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tier).toBe("standard");
    expect(result.data.notificationType).toBe("SUBSCRIBED");
    expect(result.data.originalTransactionId).toBe("orig_001");
  });

  it("未知の productId はエラー", () => {
    const adapter = createAppleIapAdapter();
    const payload = buildNotificationPayload("SUBSCRIBED", {
      ...validTransaction,
      productId: "unknown_product",
    });

    const result = adapter.parseWebhookPayload(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_RECEIPT");
  });

  it("不正なペイロード形式はエラー", () => {
    const adapter = createAppleIapAdapter();
    const result = adapter.parseWebhookPayload({ invalid: "payload" });
    expect(result.ok).toBe(false);
  });

  it("不正な JWS 形式はエラー", () => {
    const adapter = createAppleIapAdapter();
    const payload = {
      notificationType: "SUBSCRIBED",
      notificationUUID: "00000000-0000-4000-8000-000000000001",
      data: {
        bundleId: "app.trancall",
        environment: "Sandbox",
        signedTransactionInfo: "invalid.jws", // パート数が足りない
      },
      version: "2.0",
      signedDate: Date.now(),
    };
    const result = adapter.parseWebhookPayload(payload);
    expect(result.ok).toBe(false);
  });
});

describe("AppleIapAdapter.shouldProcessNotification", () => {
  it("SUBSCRIBED は処理対象", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.shouldProcessNotification("SUBSCRIBED")).toBe(true);
  });

  it("DID_RENEW は処理対象", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.shouldProcessNotification("DID_RENEW")).toBe(true);
  });

  it("EXPIRED は処理対象", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.shouldProcessNotification("EXPIRED")).toBe(true);
  });

  it("未知のタイプは処理対象外", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.shouldProcessNotification("UNKNOWN_TYPE")).toBe(false);
  });
});

describe("AppleIapAdapter.isActive", () => {
  it("SUBSCRIBED はアクティブ", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.isActive("SUBSCRIBED")).toBe(true);
  });

  it("EXPIRED は非アクティブ", () => {
    const adapter = createAppleIapAdapter();
    expect(adapter.isActive("EXPIRED")).toBe(false);
  });
});

// =============================================================================
// M-8: apple-iap-adapter.ts (Webhook 解析) と iap-adapter.ts (Client Transaction 検証) の
// productId → PlanTier マッピングが単一の canonical ソース (APPLE_IAP_PRODUCT_ID_MAP) に
// 一本化されていることを検証する (旧 sprint3-known-issues.md §2.2 の「二重実装」課題の回帰テスト)。
// =============================================================================
describe("AppleIapAdapter / IapAdapter — productId マッピングの canonical 一本化 (M-8)", () => {
  it("APPLE_IAP_PRODUCT_ID_MAP の全 productId で Webhook 解析 (apple-iap-adapter) の tier 解決が一致する", () => {
    const adapter = createAppleIapAdapter();

    for (const [productId, expectedTier] of Object.entries(APPLE_IAP_PRODUCT_ID_MAP)) {
      const payload = buildNotificationPayload("SUBSCRIBED", {
        ...validTransaction,
        productId,
      });
      const result = adapter.parseWebhookPayload(payload);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.data.tier).toBe(expectedTier);
    }
  });

  it("APPLE_IAP_PRODUCT_ID_MAP の全 productId で Client Transaction 検証 (iap-adapter) の resolveTier と一致する", () => {
    const iapAdapter = createIapAdapter();

    for (const [productId, expectedTier] of Object.entries(APPLE_IAP_PRODUCT_ID_MAP)) {
      expect(iapAdapter.resolveTier(productId)).toBe(expectedTier);
    }
  });
});
