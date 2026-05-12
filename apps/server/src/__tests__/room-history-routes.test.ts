/**
 * 通話履歴エンドポイントテスト (Sprint 3 T-10)
 *
 * GET /api/rooms/history
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

describe("GET /api/rooms/history", () => {
  it("通話履歴を返す (デフォルト)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/history",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      ok: boolean;
      data: { rooms: unknown[]; nextCursor: string | null };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.rooms)).toBe(true);
    expect(body.data.nextCursor === null || typeof body.data.nextCursor === "string").toBe(true);
  });

  it("limit パラメータを受け入れる", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/history?limit=10",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("before パラメータを受け入れる", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/history?before=2026-05-11T00:00:00Z",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
  });

  it("limit と before を同時に受け入れる", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/history?limit=5&before=2026-05-11T00:00:00Z",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/history",
    });

    expect(response.statusCode).toBe(401);
  });
});
