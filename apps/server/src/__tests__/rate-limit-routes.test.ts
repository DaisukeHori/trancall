/**
 * ルートへのレート制限適用テスト (Issue #34)
 *
 * - POST /api/auth/signup / signin: 無制限だった (credential stuffing 可) → 10 req/min/IP
 * - GET /api/contacts/search: 10 req/min/user
 * - POST /api/contacts/invite-link: 10 req/hour/user
 *
 * 各 describe ブロックで新規の app インスタンスを作ることで、in-memory レート制限
 * カウンターが他のテストファイル・他のテストケースを汚染しないようにする
 * (support-routes.test.ts の既存パターンと同じ方針)。
 */

import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

async function createApp(): Promise<FastifyInstance> {
  const container = createMockContainer();
  return buildTestApp(container);
}

describe("POST /api/auth/signup — rate limit (10 req/min/IP)", () => {
  it("11 回目のリクエストで 429 (RATE_LIMITED) を返す", async () => {
    const app = await createApp();
    try {
      const payload = {
        email: "test@example.com",
        password: "secureP@ss123",
        displayName: "田中太郎",
        nativeLanguage: "ja",
      };

      let lastResponse;
      for (let i = 0; i < 11; i++) {
        lastResponse = await app.inject({ method: "POST", url: "/api/auth/signup", payload });
      }

      expect(lastResponse?.statusCode).toBe(429);
      const body = JSON.parse(lastResponse?.body ?? "{}") as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/auth/signin — rate limit (10 req/min/IP)", () => {
  it("11 回目のリクエストで 429 (RATE_LIMITED) を返す", async () => {
    const app = await createApp();
    try {
      const payload = { email: "test@example.com", password: "secureP@ss123" };

      let lastResponse;
      for (let i = 0; i < 11; i++) {
        lastResponse = await app.inject({ method: "POST", url: "/api/auth/signin", payload });
      }

      expect(lastResponse?.statusCode).toBe(429);
      const body = JSON.parse(lastResponse?.body ?? "{}") as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
    } finally {
      await app.close();
    }
  });

  it("signup の上限消費は signin に影響しない (別バケット)", async () => {
    const app = await createApp();
    try {
      const signupPayload = {
        email: "test@example.com",
        password: "secureP@ss123",
        displayName: "田中太郎",
        nativeLanguage: "ja",
      };
      for (let i = 0; i < 10; i++) {
        await app.inject({ method: "POST", url: "/api/auth/signup", payload: signupPayload });
      }

      const signinResponse = await app.inject({
        method: "POST",
        url: "/api/auth/signin",
        payload: { email: "test@example.com", password: "secureP@ss123" },
      });

      expect(signinResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/contacts/search — rate limit (10 req/min/user)", () => {
  it("11 回目のリクエストで 429 (RATE_LIMITED) を返す", async () => {
    const app = await createApp();
    try {
      let lastResponse;
      for (let i = 0; i < 11; i++) {
        lastResponse = await app.inject({
          method: "GET",
          url: "/api/contacts/search?q=tanaka",
          headers: AUTH_HEADER,
        });
      }

      expect(lastResponse?.statusCode).toBe(429);
      const body = JSON.parse(lastResponse?.body ?? "{}") as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/contacts/invite-link — rate limit (10 req/hour/user)", () => {
  it("11 回目のリクエストで 429 (RATE_LIMITED) を返す", async () => {
    const app = await createApp();
    try {
      let lastResponse;
      for (let i = 0; i < 11; i++) {
        lastResponse = await app.inject({
          method: "POST",
          url: "/api/contacts/invite-link",
          headers: AUTH_HEADER,
        });
      }

      expect(lastResponse?.statusCode).toBe(429);
      const body = JSON.parse(lastResponse?.body ?? "{}") as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
    } finally {
      await app.close();
    }
  });
});
