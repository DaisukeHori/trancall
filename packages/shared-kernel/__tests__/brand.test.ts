/**
 * brand.test.ts — Branded ID ファクトリヘルパーの単体テスト
 *
 * 各 brand 関数が valid/invalid 入力に対して safeParse の成功・失敗を
 * 正しく返すことを検証する。
 */

import { describe, expect, it } from "vitest";

import {
  brandUserId,
  brandRoomId,
  brandParticipantId,
  brandTrackId,
  brandTranslationSessionId,
  brandLiveKitTrackSid,
  brandOpenAISessionId,
} from "../src/schemas/brand.js";

const VALID_UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_V4_2 = "10000000-0000-4000-8000-000000000001";
// UUID v1 形式: z.string().uuid() は RFC 4122 UUID を幅広く受け入れる
const VALID_UUID_V1 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const INVALID_UUID = "not-a-uuid";
const EMPTY_STRING = "";

describe("brandUserId", () => {
  it("有効な UUID v4 で success が true になる", () => {
    const result = brandUserId(VALID_UUID_V4);
    expect(result.success).toBe(true);
  });

  it("有効な UUID v4 (別値) で success が true になる", () => {
    const result = brandUserId(VALID_UUID_V4_2);
    expect(result.success).toBe(true);
  });

  it("UUID v1 形式でも success が true になる (.uuid() は v4 限定ではない)", () => {
    const result = brandUserId(VALID_UUID_V1);
    expect(result.success).toBe(true);
  });

  it("不正文字列で success が false になる", () => {
    const result = brandUserId(INVALID_UUID);
    expect(result.success).toBe(false);
  });

  it("空文字で success が false になる", () => {
    const result = brandUserId(EMPTY_STRING);
    expect(result.success).toBe(false);
  });
});

describe("brandRoomId", () => {
  it("有効な UUID で success が true になる", () => {
    const result = brandRoomId(VALID_UUID_V4);
    expect(result.success).toBe(true);
  });

  it("不正文字列で success が false になる", () => {
    const result = brandRoomId(INVALID_UUID);
    expect(result.success).toBe(false);
  });
});

describe("brandParticipantId", () => {
  it("有効な UUID で success が true になる", () => {
    const result = brandParticipantId(VALID_UUID_V4);
    expect(result.success).toBe(true);
  });

  it("不正文字列で success が false になる", () => {
    const result = brandParticipantId(INVALID_UUID);
    expect(result.success).toBe(false);
  });
});

describe("brandTrackId", () => {
  it("有効な UUID で success が true になる", () => {
    const result = brandTrackId(VALID_UUID_V4);
    expect(result.success).toBe(true);
  });

  it("不正文字列で success が false になる", () => {
    const result = brandTrackId(INVALID_UUID);
    expect(result.success).toBe(false);
  });
});

describe("brandTranslationSessionId", () => {
  it("有効な UUID で success が true になる", () => {
    const result = brandTranslationSessionId(VALID_UUID_V4);
    expect(result.success).toBe(true);
  });

  it("不正文字列で success が false になる", () => {
    const result = brandTranslationSessionId(INVALID_UUID);
    expect(result.success).toBe(false);
  });
});

describe("brandLiveKitTrackSid", () => {
  it("空でない任意文字列で success が true になる (min(1))", () => {
    const result = brandLiveKitTrackSid("TR_abc123");
    expect(result.success).toBe(true);
  });

  it("単一文字でも success が true になる", () => {
    const result = brandLiveKitTrackSid("x");
    expect(result.success).toBe(true);
  });

  it("空文字で success が false になる (min(1) 違反)", () => {
    const result = brandLiveKitTrackSid(EMPTY_STRING);
    expect(result.success).toBe(false);
  });
});

describe("brandOpenAISessionId", () => {
  it("空でない任意文字列で success が true になる (min(1))", () => {
    const result = brandOpenAISessionId("sess_abc123xyz");
    expect(result.success).toBe(true);
  });

  it("空文字で success が false になる (min(1) 違反)", () => {
    const result = brandOpenAISessionId(EMPTY_STRING);
    expect(result.success).toBe(false);
  });
});
