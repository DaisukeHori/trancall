/**
 * 通知エンドポイントテスト
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

let app: FastifyInstance;

beforeAll(async () => {
  const container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/notifications/register", () => {
  it("iOS デバイストークンを登録できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/register",
      headers: AUTH_HEADER,
      payload: {
        platform: "ios",
        voipToken: "abc123voiptoken",
        bundleId: "com.trancall.app",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
    expect(body.data).toBe(true);
  });

  it("Android デバイストークンを登録できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/register",
      headers: AUTH_HEADER,
      payload: {
        platform: "android",
        fcmToken: "fcm-token-123",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
  });

  it("無効なプラットフォームで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/register",
      headers: AUTH_HEADER,
      payload: {
        platform: "windows",
        token: "some-token",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("iOS で voipToken なしで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/register",
      headers: AUTH_HEADER,
      payload: {
        platform: "ios",
        bundleId: "com.trancall.app",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/register",
      payload: {
        platform: "ios",
        voipToken: "abc123",
        bundleId: "com.trancall.app",
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
