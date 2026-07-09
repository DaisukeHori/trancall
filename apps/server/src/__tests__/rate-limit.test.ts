/**
 * 共通レート制限ユーティリティテスト (Issue #34)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInMemoryRateLimitStore, createRateLimiter } from "../lib/rate-limit.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("上限内のリクエストは許可される", () => {
    const limiter = createRateLimiter(createInMemoryRateLimitStore(), 3, 60_000);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(true);
  });

  it("上限を超えたリクエストは拒否される", () => {
    const limiter = createRateLimiter(createInMemoryRateLimitStore(), 3, 60_000);
    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");
    expect(limiter.check("user-1")).toBe(false);
  });

  it("異なる key は独立してカウントされる", () => {
    const limiter = createRateLimiter(createInMemoryRateLimitStore(), 1, 60_000);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-2")).toBe(true);
    expect(limiter.check("user-1")).toBe(false);
    expect(limiter.check("user-2")).toBe(false);
  });

  it("ウィンドウが経過するとカウンターがリセットされる", () => {
    const limiter = createRateLimiter(createInMemoryRateLimitStore(), 1, 60_000);
    expect(limiter.check("user-1")).toBe(true);
    expect(limiter.check("user-1")).toBe(false);

    vi.advanceTimersByTime(61_000);

    expect(limiter.check("user-1")).toBe(true);
  });
});
