/**
 * サポート問い合わせエンドポイントテスト (Sprint 3 T-10)
 *
 * POST /api/support/inquiry
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

const VALID_INQUIRY = {
  category: "bug",
  subject: "翻訳が途中で止まる",
  body: "通話中に翻訳が停止してしまいます。再現手順: 1. 通話開始 2. 3分後に翻訳が止まる",
  diagnosticData: {
    appVersion: "1.0.0",
    osVersion: "iOS 17.5",
    deviceModel: "iPhone 15 Pro",
    submittedAt: "2026-05-12T10:00:00.000Z",
    locale: "ja-JP",
    callHistoryLast7d: 5,
    subscriptionTier: "free",
  },
};

// 各テストで独立したアプリインスタンスを使うことで rate limit 汚染を防ぐ
async function createApp(): Promise<FastifyInstance> {
  const container = createMockContainer();
  return buildTestApp(container);
}

describe("POST /api/support/inquiry", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("有効なリクエストで 200 + ticketId を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: VALID_INQUIRY,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      ok: boolean;
      data: { ticketId: string; estimatedResponseHours: number };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.data.ticketId).toBe("string");
    expect(body.data.ticketId).toMatch(/^TC-\d{8}-[A-F0-9]{6}$/);
    expect(typeof body.data.estimatedResponseHours).toBe("number");
  });

  it("billing カテゴリは estimatedResponseHours=24 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: { ...VALID_INQUIRY, category: "billing" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { estimatedResponseHours: number } };
    expect(body.data.estimatedResponseHours).toBe(24);
  });

  it("feature_request カテゴリは estimatedResponseHours=120 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: { ...VALID_INQUIRY, category: "feature_request" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { estimatedResponseHours: number } };
    expect(body.data.estimatedResponseHours).toBe(120);
  });

  it("subject が省略でも 200 を返す", async () => {
    const { subject: _subject, ...inquiryWithoutSubject } = VALID_INQUIRY;
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: inquiryWithoutSubject,
    });

    expect(response.statusCode).toBe(200);
  });

  it("subscriptionTier が省略でも 200 を返す", async () => {
    const inquiry = {
      ...VALID_INQUIRY,
      diagnosticData: { ...VALID_INQUIRY.diagnosticData },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (inquiry.diagnosticData as any).subscriptionTier;
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: inquiry,
    });

    expect(response.statusCode).toBe(200);
  });

  it("category が無効な値で 422 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: { ...VALID_INQUIRY, category: "invalid_category" },
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SUPPORT_INVALID_BODY");
  });

  it("body が空文字で 422 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: { ...VALID_INQUIRY, body: "" },
    });

    expect(response.statusCode).toBe(422);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      payload: VALID_INQUIRY,
    });

    expect(response.statusCode).toBe(401);
  });
});
