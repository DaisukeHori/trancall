/**
 * トランスクリプトエンドポイントテスト
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { MOCK_ROOM_ID } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

let app: FastifyInstance;

beforeAll(async () => {
  const container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/transcripts/:roomId", () => {
  it("トランスクリプトを返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("無効な roomId で 400 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/transcripts/invalid-id",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}`,
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /api/transcripts/:roomId", () => {
  it("アクセスを削除できる", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/transcripts/${MOCK_ROOM_ID}`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: boolean };
    expect(body.ok).toBe(true);
    expect(body.data).toBe(true);
  });
});

describe("POST /api/transcripts/:roomId/export", () => {
  it("エクスポートが未実装で 501 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export`,
      headers: AUTH_HEADER,
      payload: { format: "txt" },
    });

    expect(response.statusCode).toBe(501);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("TRANSCRIPT_EXPORT_NOT_IMPLEMENTED");
  });
});
