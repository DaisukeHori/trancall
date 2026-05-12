/**
 * Sprint 3 T-10 追加課金エンドポイントテスト
 *
 * POST /api/billing/iap/transaction
 * POST /api/billing/external-purchase/start
 * POST /api/billing/external-purchase/complete
 * POST /api/billing/restore
 * GET  /api/billing/plan-comparison
 * POST /api/billing/preview-upgrade
 * POST /api/billing/cancel
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

// IAP トランザクションのサンプル
const MOCK_IAP_TRANSACTION = {
  originalTransactionId: "original-txn-001",
  productId: "com.trancall.subscription.standard.monthly",
  purchaseDate: "2026-05-12T10:00:00.000Z",
  expirationDate: "2026-06-12T10:00:00.000Z",
  signedJws: "mock.jws.signature",
  isUpgrade: false,
};

// 各 describe で独立したアプリインスタンスを使うことで rate limit 汚染を防ぐ
async function createApp(): Promise<FastifyInstance> {
  const container = createMockContainer();
  const app = await buildTestApp(container);
  return app;
}

describe("POST /api/billing/iap/transaction", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("有効なトランザクションで 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/iap/transaction",
      headers: AUTH_HEADER,
      payload: { transaction: MOCK_IAP_TRANSACTION },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("transaction フィールドが欠けていたら 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/iap/transaction",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/iap/transaction",
      payload: { transaction: MOCK_IAP_TRANSACTION },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/billing/external-purchase/start", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("有効な targetTier で 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/external-purchase/start",
      headers: AUTH_HEADER,
      payload: { targetTier: "standard" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { redirectUrl: string } };
    expect(body.ok).toBe(true);
    expect(body.data.redirectUrl).toBeDefined();
  });

  it("無効な targetTier で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/external-purchase/start",
      headers: AUTH_HEADER,
      payload: { targetTier: "invalid-tier" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/external-purchase/start",
      payload: { targetTier: "standard" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/billing/external-purchase/complete", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("有効な redirect で 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/external-purchase/complete",
      headers: AUTH_HEADER,
      payload: {
        redirect: {
          redirectToken: "redirect-token-abc",
          stripeSubscriptionId: "sub_test123",
          completedAt: "2026-05-12T10:00:00.000Z",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("redirect フィールドが欠けていたら 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/external-purchase/complete",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/billing/restore", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("有効な transactions で 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/restore",
      headers: AUTH_HEADER,
      payload: { transactions: [MOCK_IAP_TRANSACTION] },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { restoredCount: number; subscription: null } };
    expect(body.ok).toBe(true);
    expect(typeof body.data.restoredCount).toBe("number");
  });

  it("transactions が空配列で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/restore",
      headers: AUTH_HEADER,
      payload: { transactions: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/restore",
      payload: { transactions: [MOCK_IAP_TRANSACTION] },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/billing/plan-comparison", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("プラン比較データを返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/billing/plan-comparison",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { currentTier: string; plans: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.currentTier).toBeDefined();
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/billing/plan-comparison",
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/billing/preview-upgrade", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("有効な targetTier で 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/preview-upgrade",
      headers: AUTH_HEADER,
      payload: { targetTier: "standard" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { proratedAmountYen: number } };
    expect(body.ok).toBe(true);
    expect(typeof body.data.proratedAmountYen).toBe("number");
  });

  it("無効な targetTier で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/preview-upgrade",
      headers: AUTH_HEADER,
      payload: { targetTier: "super-tier" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/preview-upgrade",
      payload: { targetTier: "standard" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/billing/cancel", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });

  it("atPeriodEnd=true でキャンセルできる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/cancel",
      headers: AUTH_HEADER,
      payload: { atPeriodEnd: true },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { cancelAtPeriodEnd: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.cancelAtPeriodEnd).toBe(true);
  });

  it("body 省略時はデフォルト atPeriodEnd=true でキャンセルできる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/cancel",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/cancel",
    });

    expect(response.statusCode).toBe(401);
  });
});
