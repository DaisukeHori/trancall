/**
 * Sprint 4 T-2.12 アカウント退会 API テスト
 *
 * POST /api/account/delete  — soft delete + grace period
 * POST /api/account/restore — 30日以内なら復元 / 期限切れは 410
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

// ---------------------------------------------------------------------------
// POST /api/account/delete
// ---------------------------------------------------------------------------

describe("POST /api/account/delete", () => {
  let app: FastifyInstance;
  let mockSchema: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const container = createMockContainer();

    // maybeSingle で deleted_at = null を返す (未退会)
    const mockQueryChain = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn(),
      upsert: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { deleted_at: null }, error: null }),
    };
    for (const key of Object.keys(mockQueryChain)) {
      if (!["single", "maybeSingle"].includes(key)) {
        const chain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
        if (typeof chain[key]?.mockReturnValue === "function") {
          chain[key]?.mockReturnValue(mockQueryChain);
        }
      }
    }
    mockFrom = vi.fn().mockReturnValue(mockQueryChain);
    mockSchema = vi.fn().mockReturnValue({ from: mockFrom });

    // supabase を上書き
    const anyContainer = container as Record<string, unknown>;
    const supabase = anyContainer["supabase"] as Record<string, unknown>;
    supabase["schema"] = mockSchema;

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
    const mockQueryChain = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn(),
      upsert: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { deleted_at: fiveDaysAgo },
        error: null,
      }),
    };
    for (const key of Object.keys(mockQueryChain)) {
      if (!["single", "maybeSingle"].includes(key)) {
        const chain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
        if (typeof chain[key]?.mockReturnValue === "function") {
          chain[key]?.mockReturnValue(mockQueryChain);
        }
      }
    }
    const mockFrom = vi.fn().mockReturnValue(mockQueryChain);
    const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });
    const anyContainer = container as Record<string, unknown>;
    const supabase = anyContainer["supabase"] as Record<string, unknown>;
    supabase["schema"] = mockSchema;

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
    const mockQueryChain = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn(),
      upsert: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { deleted_at: thirtyOneDaysAgo },
        error: null,
      }),
    };
    for (const key of Object.keys(mockQueryChain)) {
      if (!["single", "maybeSingle"].includes(key)) {
        const chain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
        if (typeof chain[key]?.mockReturnValue === "function") {
          chain[key]?.mockReturnValue(mockQueryChain);
        }
      }
    }
    const mockFrom = vi.fn().mockReturnValue(mockQueryChain);
    const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });
    const anyContainer = container as Record<string, unknown>;
    const supabase = anyContainer["supabase"] as Record<string, unknown>;
    supabase["schema"] = mockSchema;

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
    const mockQueryChain = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn(),
      upsert: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { deleted_at: null }, error: null }),
    };
    for (const key of Object.keys(mockQueryChain)) {
      if (!["single", "maybeSingle"].includes(key)) {
        const chain = mockQueryChain as Record<string, ReturnType<typeof vi.fn>>;
        if (typeof chain[key]?.mockReturnValue === "function") {
          chain[key]?.mockReturnValue(mockQueryChain);
        }
      }
    }
    const mockFrom = vi.fn().mockReturnValue(mockQueryChain);
    const mockSchema = vi.fn().mockReturnValue({ from: mockFrom });
    const anyContainer = container as Record<string, unknown>;
    const supabase = anyContainer["supabase"] as Record<string, unknown>;
    supabase["schema"] = mockSchema;

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
