/**
 * 同意管理エンドポイントテスト (Sprint 3 T-10)
 *
 * POST /api/auth/consents
 * GET  /api/auth/consents
 * DELETE /api/auth/consents/:scope
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

describe("POST /api/auth/consents", () => {
  it("有効なリクエストで 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consents",
      headers: AUTH_HEADER,
      payload: {
        scope: "legal_terms",
        version: "2026-05-12",
        source: "onboarding",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
    expect(body.data).toBe(true);
  });

  it("voice_to_openai scope で 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consents",
      headers: AUTH_HEADER,
      payload: {
        scope: "voice_to_openai",
        version: "2026-05-12",
        source: "incoming_call_first_time",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("scope が無効な値で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consents",
      headers: AUTH_HEADER,
      payload: {
        scope: "invalid_scope",
        version: "2026-05-12",
        source: "onboarding",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("version が不正な形式で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consents",
      headers: AUTH_HEADER,
      payload: {
        scope: "legal_terms",
        version: "invalid-version",
        source: "onboarding",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consents",
      payload: {
        scope: "legal_terms",
        version: "2026-05-12",
        source: "onboarding",
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/auth/consents", () => {
  it("同意状態一覧を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/consents",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/consents",
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /api/auth/consents/:scope", () => {
  it("有効な scope で 200 を返す", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/auth/consents/push_notification",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
    expect(body.data).toBe(true);
  });

  it("無効な scope で 400 を返す", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/auth/consents/invalid_scope",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/auth/consents/legal_terms",
    });

    expect(response.statusCode).toBe(401);
  });
});
