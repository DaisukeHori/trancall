/**
 * GooglePlayAdapter テスト
 *
 * - parseWebhookPayload: Pub/Sub メッセージデコード
 * - isActive / shouldProcessNotification 判定
 */

import { describe, expect, it } from "vitest";
import { createGooglePlayAdapter } from "../src/adapters/google-play-adapter.js";

// --- ヘルパー ---

function buildPubSubMessage(notification: Record<string, unknown>) {
  const data = Buffer.from(JSON.stringify(notification)).toString("base64");
  return {
    message: {
      data,
      messageId: "msg_001",
      publishTime: "2026-05-10T10:00:00.000Z",
    },
    subscription: "projects/trancall/subscriptions/billing",
  };
}

const validNotification = {
  version: "1.0",
  packageName: "app.trancall",
  eventTimeMillis: "1715000000000",
  subscriptionNotification: {
    version: "1.0",
    notificationType: 4, // SUBSCRIPTION_PURCHASED
    purchaseToken: "purchase_token_abc123",
    subscriptionId: "trancall_standard_monthly",
  },
};

// --- テスト ---

describe("GooglePlayAdapter.parseWebhookPayload", () => {
  it("Pub/Sub メッセージを正常にパース", () => {
    const adapter = createGooglePlayAdapter();
    const payload = buildPubSubMessage(validNotification);

    const result = adapter.parseWebhookPayload(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tier).toBe("standard");
    expect(result.data.purchaseToken).toBe("purchase_token_abc123");
    expect(result.data.idempotencyKey).toBe("purchase_token_abc123");
    expect(result.data.notificationType).toBe(4);
  });

  it("直接通知形式も解析できる", () => {
    const adapter = createGooglePlayAdapter();
    const result = adapter.parseWebhookPayload(validNotification);
    expect(result.ok).toBe(true);
  });

  it("テスト通知は VALIDATION_ERROR を返す", () => {
    const adapter = createGooglePlayAdapter();
    const testNotification = {
      version: "1.0",
      packageName: "app.trancall",
      eventTimeMillis: "1715000000000",
      testNotification: { version: "1.0" },
    };

    const result = adapter.parseWebhookPayload(testNotification);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("未知の subscriptionId はエラー", () => {
    const adapter = createGooglePlayAdapter();
    const notification = {
      ...validNotification,
      subscriptionNotification: {
        ...validNotification.subscriptionNotification,
        subscriptionId: "unknown_product",
      },
    };

    const result = adapter.parseWebhookPayload(notification);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INVALID_RECEIPT");
  });
});

describe("GooglePlayAdapter.isActive", () => {
  it("notificationType=4 (SUBSCRIPTION_PURCHASED) はアクティブ", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.isActive(4)).toBe(true);
  });

  it("notificationType=2 (SUBSCRIPTION_RENEWED) はアクティブ", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.isActive(2)).toBe(true);
  });

  it("notificationType=3 (SUBSCRIPTION_CANCELED) は非アクティブ", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.isActive(3)).toBe(false);
  });

  it("notificationType=13 (SUBSCRIPTION_EXPIRED) は非アクティブ", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.isActive(13)).toBe(false);
  });
});

describe("GooglePlayAdapter.shouldProcessNotification", () => {
  it("SUBSCRIPTION_PURCHASED (4) は処理対象", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.shouldProcessNotification(4)).toBe(true);
  });

  it("SUBSCRIPTION_RENEWED (2) は処理対象", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.shouldProcessNotification(2)).toBe(true);
  });

  it("SUBSCRIPTION_ON_HOLD (5) は処理対象外", () => {
    const adapter = createGooglePlayAdapter();
    expect(adapter.shouldProcessNotification(5)).toBe(false);
  });
});
