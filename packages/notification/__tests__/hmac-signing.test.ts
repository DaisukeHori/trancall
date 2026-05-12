/**
 * HMAC 署名テスト (T-8)
 *
 * docs/notification-detail.md §3.2 §3.3 の仕様を検証する:
 * - canonical string 組み立て順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
 * - HMAC-SHA256 は deterministic（同一入力で同一出力）
 * - test vector（既知の input/output ペア）
 * - 秘密鍵が変われば署名も変わる
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import {
  signCallPayload,
  buildCanonicalString,
  buildCallTimestamps,
} from "../src/signing/hmac.js";
import type { CallPayloadSignable } from "../src/signing/hmac.js";

// テスト用固定値
const TEST_SECRET = "test-hmac-secret-key-at-least-32-chars!";
const OTHER_SECRET = "other-hmac-secret-key-at-least-32-!!";

const testPayload: CallPayloadSignable = {
  type: "incoming_call",
  uuid: "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
  roomId: "550e8400-e29b-41d4-a716-446655440000",
  callerId: "u_abc123",
  callerTrancallId: "@johnwang_sf",
  issuedAt: "2026-05-11T10:00:00.000Z",
  expiresAt: "2026-05-11T10:00:30.000Z",
};

// test vector: 手計算した期待値
// canonical = "incoming_call|fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77|550e8400-e29b-41d4-a716-446655440000|u_abc123|@johnwang_sf|2026-05-11T10:00:00.000Z|2026-05-11T10:00:30.000Z"
const EXPECTED_CANONICAL =
  "incoming_call|fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77|550e8400-e29b-41d4-a716-446655440000|u_abc123|@johnwang_sf|2026-05-11T10:00:00.000Z|2026-05-11T10:00:30.000Z";

// Node crypto で直接計算した期待 signature（test vector）
const EXPECTED_SIGNATURE = createHmac("sha256", TEST_SECRET)
  .update(EXPECTED_CANONICAL, "utf8")
  .digest("hex");

// ---------------------------------------------------------------------------

describe("buildCanonicalString", () => {
  it("フィールドを | 区切りで正しい順序に結合する（docs/notification-detail.md §3.2）", () => {
    const canonical = buildCanonicalString(testPayload);
    expect(canonical).toBe(EXPECTED_CANONICAL);
  });

  it("順序が固定されている: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt", () => {
    const canonical = buildCanonicalString(testPayload);
    const parts = canonical.split("|");
    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe("incoming_call");
    expect(parts[1]).toBe("fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77");
    expect(parts[2]).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parts[3]).toBe("u_abc123");
    expect(parts[4]).toBe("@johnwang_sf");
    expect(parts[5]).toBe("2026-05-11T10:00:00.000Z");
    expect(parts[6]).toBe("2026-05-11T10:00:30.000Z");
  });

  it("callerName / roomType 等の表示用フィールドを含まない（署名対象外）", () => {
    const canonical = buildCanonicalString(testPayload);
    // callerName は canonical に含まれない
    expect(canonical).not.toContain("John Wang");
    // roomType は canonical に含まれない
    expect(canonical).not.toContain("audio");
  });
});

describe("signCallPayload", () => {
  it("既知 input/output ペア（test vector）が一致する", () => {
    const sig = signCallPayload(testPayload, TEST_SECRET);
    expect(sig).toBe(EXPECTED_SIGNATURE);
  });

  it("小文字 hex 64 文字を返す（HMAC-SHA256 仕様）", () => {
    const sig = signCallPayload(testPayload, TEST_SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ入力で同じ署名が生成される（deterministic）", () => {
    const sig1 = signCallPayload(testPayload, TEST_SECRET);
    const sig2 = signCallPayload(testPayload, TEST_SECRET);
    expect(sig1).toBe(sig2);
  });

  it("秘密鍵が変われば署名も変わる", () => {
    const sig1 = signCallPayload(testPayload, TEST_SECRET);
    const sig2 = signCallPayload(testPayload, OTHER_SECRET);
    expect(sig1).not.toBe(sig2);
  });

  it("フィールド値が 1 文字でも変わると署名が変わる（改ざん検知）", () => {
    const sigOriginal = signCallPayload(testPayload, TEST_SECRET);

    // callerId を変更
    const sigModified = signCallPayload(
      { ...testPayload, callerId: "u_malicious" },
      TEST_SECRET,
    );
    expect(sigOriginal).not.toBe(sigModified);
  });

  it("uuid が変わると署名が変わる（CallKit UUID 改ざん検知）", () => {
    const sig1 = signCallPayload(testPayload, TEST_SECRET);
    const sig2 = signCallPayload(
      { ...testPayload, uuid: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
      TEST_SECRET,
    );
    expect(sig1).not.toBe(sig2);
  });

  it("expiresAt が変わると署名が変わる（TTL 改ざん検知）", () => {
    const sig1 = signCallPayload(testPayload, TEST_SECRET);
    // expiresAt を 1 分延長しようとした改ざん
    const sig2 = signCallPayload(
      { ...testPayload, expiresAt: "2026-05-11T10:01:00.000Z" },
      TEST_SECRET,
    );
    expect(sig1).not.toBe(sig2);
  });
});

describe("buildCallTimestamps", () => {
  it("issuedAt と expiresAt を ISO8601 .000Z 形式で返す", () => {
    const now = new Date("2026-05-11T10:00:00.000Z");
    const { issuedAt, expiresAt } = buildCallTimestamps(now);
    expect(issuedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(expiresAt).toBe("2026-05-11T10:00:30.000Z");
  });

  it("expiresAt は issuedAt の 30 秒後（docs/notification-detail.md §1 TTL 仕様）", () => {
    const now = new Date("2026-05-11T12:34:56.789Z");
    const { issuedAt, expiresAt } = buildCallTimestamps(now);

    const issuedAtMs = new Date(issuedAt).getTime();
    const expiresAtMs = new Date(expiresAt).getTime();
    expect(expiresAtMs - issuedAtMs).toBe(30_000);
  });

  it("now 省略時に現在時刻を使う（エラーにならない）", () => {
    const { issuedAt, expiresAt } = buildCallTimestamps();
    expect(issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // issuedAt < expiresAt
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(new Date(issuedAt).getTime());
  });
});
