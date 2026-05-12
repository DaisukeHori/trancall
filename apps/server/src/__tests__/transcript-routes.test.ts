/**
 * トランスクリプトエンドポイントテスト
 *
 * T-9 Round 2 指摘対応: exportTranscript mock を ok() に更新し 200 検証テストを追加
 * T-10: GET /api/transcripts/:roomId/export エンドポイントのテストを追加
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

describe("GET /api/transcripts/:roomId/export (T-10: Sprint 3 新規)", () => {
  it("txt フォーマットで 200 + ok を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export?format=txt`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { contentBase64: string; mime: string; filename: string } };
    expect(body.ok).toBe(true);
    expect(body.data.contentBase64).toBeDefined();
    expect(body.data.mime).toBeDefined();
    expect(body.data.filename).toBeDefined();
  });

  it("pdf フォーマットで 200 + ok を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export?format=pdf`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });

  it("format 省略時はデフォルト txt で 200 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
  });

  it("無効な roomId で 400 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/transcripts/invalid-id/export?format=txt",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export`,
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /api/transcripts/:roomId/export (後方互換)", () => {
  it("POST でも 200 + ok を返す (mock 更新後)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/transcripts/${MOCK_ROOM_ID}/export`,
      headers: AUTH_HEADER,
      payload: { format: "txt" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: unknown };
    expect(body.ok).toBe(true);
  });
});
