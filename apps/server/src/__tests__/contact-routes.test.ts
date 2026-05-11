/**
 * 連絡先エンドポイントテスト
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

describe("GET /api/contacts", () => {
  it("連絡先一覧を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/contacts",
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
      url: "/api/contacts",
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/contacts", () => {
  it("有効な contactUserId で連絡先を追加できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contacts",
      headers: AUTH_HEADER,
      payload: {
        contactUserId: "11011011-0110-4110-8110-110110110110",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("無効な UUID で 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contacts",
      headers: AUTH_HEADER,
      payload: {
        contactUserId: "not-a-uuid",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("DELETE /api/contacts/:id", () => {
  it("連絡先を削除できる", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/contacts/10101010-1010-4010-8010-101010101010",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("GET /api/contacts/search", () => {
  it("検索クエリで結果を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/contacts/search?q=tanaka",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
  });

  it("q がないと 400 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/contacts/search",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/contacts/block", () => {
  it("ユーザーをブロックできる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contacts/block",
      headers: AUTH_HEADER,
      payload: {
        blockedUserId: "20202020-2020-4020-8020-202020202020",
      },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /api/contacts/report", () => {
  it("ユーザーを通報できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contacts/report",
      headers: AUTH_HEADER,
      payload: {
        reportedUserId: "20202020-2020-4020-8020-202020202020",
        reason: "spam",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("reason なしで 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/contacts/report",
      headers: AUTH_HEADER,
      payload: {
        reportedUserId: "20202020-2020-4020-8020-202020202020",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
