/**
 * Sprint 4 T-2.12 アカウント退会 API テスト
 *
 * POST /api/account/delete  — soft delete + grace period
 * POST /api/account/restore — 30日以内なら復元 / 期限切れは 410
 *
 * Issue #72.1: account-routes.ts は AuthFacade.getProfileDeletionStatus /
 * setProfileDeletedAt 経由で trancall_auth.profiles.deleted_at を読み書きするように
 * 変更されたため、直接 supabase をモックするのではなく auth facade をモックする。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import { ok } from "@trancall/shared-kernel";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

// ---------------------------------------------------------------------------
// POST /api/account/delete
// ---------------------------------------------------------------------------

describe("POST /api/account/delete", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const container = createMockContainer();
    // 未退会 (deleted_at = null)
    container.auth.getProfileDeletionStatus = vi.fn().mockResolvedValue(ok({ deletedAt: null }));

    app = await buildTestApp(container);
  });

  afterAll(async () => { await app.close(); });

  it("正常系: 退会リクエストで 200 + gracePeriodEndsAt を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/delete",
      headers: AUTH_HEADER,
      payload: { reason: "not needed anymore" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; data: { gracePeriodEndsAt: string } }>();
    expect(body.ok).toBe(true);
    expect(typeof body.data.gracePeriodEndsAt).toBe("string");

    // grace period が 30 日後であること
    const endsAt = new Date(body.data.gracePeriodEndsAt).getTime();
    const now = Date.now();
    const diffDays = (endsAt - now) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  it("正常系: reason なしでも 200 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/delete",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/delete",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/account/restore
// ---------------------------------------------------------------------------

describe("POST /api/account/restore (grace period 内)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const container = createMockContainer();

    // deleted_at を5日前に設定 (grace period 内)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    container.auth.getProfileDeletionStatus = vi
      .fn()
      .mockResolvedValue(ok({ deletedAt: fiveDaysAgo }));

    app = await buildTestApp(container);
  });

  afterAll(async () => { await app.close(); });

  it("grace period 内なら 200 + restored=true を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/restore",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; data: { restored: boolean } }>();
    expect(body.ok).toBe(true);
    expect(body.data.restored).toBe(true);
  });
});

describe("POST /api/account/restore (grace period 超過)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const container = createMockContainer();

    // deleted_at を 31 日前に設定 (grace period 超過)
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    container.auth.getProfileDeletionStatus = vi
      .fn()
      .mockResolvedValue(ok({ deletedAt: thirtyOneDaysAgo }));

    app = await buildTestApp(container);
  });

  afterAll(async () => { await app.close(); });

  it("grace period 超過なら 410 GONE を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/restore",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(410);
    const body = response.json<{ ok: boolean; error: { code: string } }>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ACCOUNT_GRACE_PERIOD_EXPIRED");
  });
});

describe("POST /api/account/restore (退会リクエストなし)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const container = createMockContainer();

    // deleted_at = null (未退会)
    container.auth.getProfileDeletionStatus = vi.fn().mockResolvedValue(ok({ deletedAt: null }));

    app = await buildTestApp(container);
  });

  afterAll(async () => { await app.close(); });

  it("退会リクエストなしなら 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/account/restore",
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ ok: boolean; error: { code: string } }>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ACCOUNT_NOT_DELETED");
  });
});
