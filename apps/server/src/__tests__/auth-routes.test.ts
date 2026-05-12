/**
 * 認証エンドポイントテスト
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

let app: FastifyInstance;

beforeAll(async () => {
  const container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/auth/signup", () => {
  it("有効な入力でサインアップが成功する", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: {
        email: "test@example.com",
        password: "secureP@ss123",
        displayName: "田中太郎",
        nativeLanguage: "ja",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("無効なメールアドレスで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: {
        email: "not-an-email",
        password: "secureP@ss123",
        displayName: "田中太郎",
        nativeLanguage: "ja",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("パスワードが短すぎると 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: {
        email: "test@example.com",
        password: "short",
        displayName: "Test",
        nativeLanguage: "ja",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/auth/signin", () => {
  it("有効な資格情報でサインインが成功する", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: {
        email: "test@example.com",
        password: "secureP@ss123",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("無効なメールアドレスで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: {
        email: "invalid",
        password: "password",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/auth/profile", () => {
  it("有効なトークンでプロフィールを返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/profile",
      headers: {
        authorization: "Bearer mock-valid-token",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("トークンなしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/profile",
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("PATCH /api/auth/profile", () => {
  it("プロフィールを更新できる", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: {
        authorization: "Bearer mock-valid-token",
      },
      payload: {
        displayName: "新しい名前",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/auth/consent", () => {
  it("同意バージョンを記録できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consent",
      headers: {
        authorization: "Bearer mock-valid-token",
      },
      payload: {
        consentVersion: "v1.0",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
    expect(body.data).toBe(true);
  });

  it("consentVersion なしで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/consent",
      headers: {
        authorization: "Bearer mock-valid-token",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
