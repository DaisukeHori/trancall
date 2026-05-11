/**
 * 通話エンドポイントテスト
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

describe("POST /api/rooms", () => {
  it("通話を作成できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { ok: boolean; data: { roomId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.roomId).toBeDefined();
  });

  it("inviteeIds が空だと 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: [],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("無効な UUID を inviteeIds に含むと 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["not-a-uuid"],
        translationEnabled: false,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/rooms/:id", () => {
  it("Room 状態を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/rooms/${MOCK_ROOM_ID}`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { roomId: string } };
    expect(body.ok).toBe(true);
  });

  it("無効な UUID で 400 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/invalid-id",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/rooms/:id/join", () => {
  it("通話に参加できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/join`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { status: string } };
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/rooms/:id/leave", () => {
  it("通話を終了できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/leave`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { status: string } };
    expect(body.ok).toBe(true);
  });
});
