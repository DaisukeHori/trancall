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

// Issue #78: レガシー `POST /api/auth/consent` (単数形) は
// - mobile ペイロード `{ revoke: true }` と ConsentSchema `{ consentVersion }` の不一致 (常時 400)
// - 書き込み先 `trancall_auth.consent_versions` のスキーマ不整合 (500)
// - レスポンス形状 (`{ok,data:true}`) と mobile 側 parse (`{success}`) の不一致
// という三重の契約不一致で到達不能だったため削除した。正規の同意フローは
// `POST/GET /api/auth/consents` + `DELETE /api/auth/consents/:scope`
// (apps/server/src/__tests__/auth-consents-routes.test.ts で検証) に一本化した。
// このテストはレガシー route が再導入されないことを保証する回帰テスト。
describe("POST /api/auth/consent (レガシー、削除済み)", () => {
  it("404 を返す (route が存在しない)", async () => {
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

    expect(response.statusCode).toBe(404);
  });
});
