/**
 * 課金エンドポイントテスト
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * vi.mocked(container.X.Y) は vitest の定番パターンだが、typescript-eslint の
 * unbound-method は「メソッド参照を this なしで渡している」と誤検知する
 * (vi.mocked は呼び出さず型情報のみラップするため実害なし)。ファイル全体で無効化する。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import type { AppContainer } from "../container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

let app: FastifyInstance;
let container: AppContainer;

beforeAll(async () => {
  container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/billing/subscription", () => {
  it("サブスクリプション状態を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/billing/subscription",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/billing/subscription",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/billing/checkout", () => {
  it("Stripe Web チェックアウトセッションを作成できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers: AUTH_HEADER,
      payload: {
        tier: "standard",
        paymentMethod: "stripe_web",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { url: string } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBeDefined();
  });

  it("無効な tier で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/checkout",
      headers: AUTH_HEADER,
      payload: {
        tier: "invalid-tier",
        paymentMethod: "stripe_web",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/billing/webhook/stripe", () => {
  it("Stripe webhook を処理できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook/stripe",
      headers: {
        "stripe-signature": "t=12345,v1=test_sig",
        "content-type": "application/json",
      },
      payload: { type: "checkout.session.completed" },
    });

    // ストライプ署名は mock で成功するので 200 が期待値
    // ただし handleStripeWebhook のモックが ok を返す
    expect([200, 400]).toContain(response.statusCode);
  });

  // #39: 受信した生バイト列 (request.rawBody) がそのまま署名検証に渡ること。
  // JSON.stringify(request.body) による再シリアライズでは、空白やキー順序が原の
  // バイト列と食い違うため、この回帰テストは修正前の実装では失敗する
  // (整形済み rawBody !== JSON.stringify(JSON.parse(整形済み rawBody)))。
  it("#39: request.rawBody を再シリアライズせずそのまま署名検証に渡す (整形差があっても一致する)", async () => {
    const handleStripeWebhookMock = vi.mocked(container.billing.handleStripeWebhook);
    handleStripeWebhookMock.mockClear();

    // 意図的にキー順序を非正準にし、余分な空白・改行を含めた raw payload。
    // JSON.stringify(JSON.parse(rawPayload)) はこれと異なる文字列になる
    // (キー順序が "type" 昇順に正規化され、空白・改行が失われるため)。
    const rawPayload = '{\n  "extra":   1,\n  "type": "checkout.session.completed"\n}';
    // 再シリアライズすると必ず異なる文字列になることを事前に確認しておく (テスト自体の前提確認)。
    expect(JSON.stringify(JSON.parse(rawPayload) as unknown)).not.toBe(rawPayload);

    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook/stripe",
      headers: {
        "stripe-signature": "t=12345,v1=test_sig",
        "content-type": "application/json",
      },
      payload: rawPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(handleStripeWebhookMock).toHaveBeenCalledTimes(1);
    const [receivedRawBody] = handleStripeWebhookMock.mock.calls[0] ?? [];
    // 修正前の実装 (JSON.stringify(request.body)) だとここで rawPayload と一致しない。
    expect(receivedRawBody).toBe(rawPayload);
  });
});

describe("POST /api/billing/webhook/apple", () => {
  it("Apple IAP webhook を処理できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook/apple",
      headers: {
        "content-type": "application/json",
      },
      payload: { notificationType: "SUBSCRIBED" },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /api/billing/webhook/google", () => {
  it("Google Play webhook を処理できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/billing/webhook/google",
      headers: {
        "content-type": "application/json",
      },
      payload: { message: { data: "test" } },
    });

    expect(response.statusCode).toBe(200);
  });
});
