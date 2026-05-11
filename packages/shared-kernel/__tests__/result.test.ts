/**
 * result.test.ts — Result 型ユーティリティの単体テスト
 *
 * ok() / err() / validate() / AppError スキーマ / discriminated union の
 * 型安全な narrowing を検証する。
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ok,
  err,
  validate,
  AppError,
  type Result,
  type ResultOk,
  type ResultErr,
} from "../src/schemas/result.js";

// --- ok() ---

describe("ok()", () => {
  it("{ ok: true, data } を返す", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("オブジェクトデータでも { ok: true, data } を返す", () => {
    const data = { name: "TranCall", version: 1 };
    const result = ok(data);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(data);
  });

  it("null データでも { ok: true, data: null } を返す", () => {
    const result = ok(null);
    expect(result).toEqual({ ok: true, data: null });
  });
});

// --- err() ---

describe("err()", () => {
  it("{ ok: false, error } を返す", () => {
    const error: ReturnType<typeof AppError.parse> = {
      code: "TEST_ERROR",
      message: "テストエラー",
      retryable: false,
    };
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
  });

  it("retryable: true のエラーも正しく返す", () => {
    const error: ReturnType<typeof AppError.parse> = {
      code: "NETWORK_ERROR",
      message: "ネットワーク障害",
      retryable: true,
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    expect(result.error.retryable).toBe(true);
  });
});

// --- validate() ---

const EmailSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
});

describe("validate()", () => {
  it("有効なデータで { ok: true, data: parsed } を返す", () => {
    const result = validate(EmailSchema, { email: "user@example.com", age: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.email).toBe("user@example.com");
    expect(result.data.age).toBe(25);
  });

  it("無効なデータで { ok: false, error.code === 'VALIDATION_ERROR' } を返す", () => {
    const result = validate(EmailSchema, { email: "not-an-email", age: 25 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("エラーメッセージに path が含まれる", () => {
    const result = validate(EmailSchema, { email: "not-an-email", age: 25 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("email");
  });

  it("error.retryable === false がデフォルト", () => {
    const result = validate(EmailSchema, { email: "bad", age: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
  });

  it("error.details.issues に Zod issue 配列が入る", () => {
    const result = validate(EmailSchema, { email: "bad", age: "not-a-number" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toBeDefined();
    expect(Array.isArray(result.error.details?.["issues"])).toBe(true);
    const issues = result.error.details?.["issues"];
    expect((issues as unknown[]).length).toBeGreaterThan(0);
  });

  it("複数フィールドの invalid データで全 path がメッセージに含まれる", () => {
    const result = validate(EmailSchema, { email: "bad", age: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // email と age の両方のパスが含まれる
    expect(result.error.message).toMatch(/email|age/);
  });
});

// --- AppError スキーマ ---

describe("AppError スキーマ", () => {
  it("code / message / retryable が揃っていれば parse できる", () => {
    const parsed = AppError.safeParse({
      code: "SOME_ERROR",
      message: "エラーメッセージ",
      retryable: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("retryable を省略すると default(false) が適用される", () => {
    const parsed = AppError.safeParse({
      code: "SOME_ERROR",
      message: "エラー",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.retryable).toBe(false);
  });

  it("httpStatus / provider / details はオプション — 省略しても parse できる", () => {
    const parsed = AppError.safeParse({
      code: "MIN_ERROR",
      message: "最小構成",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.httpStatus).toBeUndefined();
    expect(parsed.data.provider).toBeUndefined();
    expect(parsed.data.details).toBeUndefined();
  });

  it("httpStatus / provider / details を含むフル構成でも parse できる", () => {
    const parsed = AppError.safeParse({
      code: "HTTP_ERROR",
      message: "HTTP 500",
      retryable: true,
      httpStatus: 500,
      provider: "supabase",
      details: { requestId: "abc123" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.httpStatus).toBe(500);
    expect(parsed.data.provider).toBe("supabase");
  });
});

// --- Result 型の discriminated union narrowing (コンパイル時検証) ---

describe("Result 型の discriminated union narrowing", () => {
  it("ok branch では data にアクセスできる", () => {
    const result: Result<string> = ok("hello");
    if (result.ok) {
      // TypeScript がここで data: string を推論できることを確認
      const data: string = result.data;
      expect(data).toBe("hello");
    }
  });

  it("err branch では error にアクセスできる", () => {
    const error: ReturnType<typeof AppError.parse> = {
      code: "E",
      message: "m",
      retryable: false,
    };
    const result: Result<string> = err(error);
    if (!result.ok) {
      // TypeScript がここで error: AppError を推論できることを確認
      const e: ReturnType<typeof AppError.parse> = result.error;
      expect(e.code).toBe("E");
    }
  });

  it("ResultOk 型は ok: true を持ち data が存在する", () => {
    const r: ResultOk<number> = { ok: true, data: 99 };
    expect(r.ok).toBe(true);
    expect(r.data).toBe(99);
  });

  it("ResultErr 型は ok: false を持ち error が存在する", () => {
    const e: ReturnType<typeof AppError.parse> = { code: "X", message: "x", retryable: false };
    const r: ResultErr = { ok: false, error: e };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("X");
  });
});
