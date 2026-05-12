/**
 * anonymize.ts のユニットテスト
 *
 * 検証項目:
 * - 決定論性: 同一 userId + salt で常に同一の UUID が生成される
 * - 一意性: 異なる userId は異なる UUID になる
 * - UUID v4 形式: RFC 4122 準拠の形式であること
 * - salt が変わると結果が変わること
 */

import { describe, it, expect } from "vitest";
import { brandUserId } from "@trancall/shared-kernel";
import { deriveAnonymizedUserId } from "../lib/anonymize.js";

const SALT = "test-anonymize-salt-minimum-32chars!";

function makeUserId(raw: string) {
  const result = brandUserId(raw);
  if (!result.success) throw new Error(`Invalid UUID: ${raw}`);
  return result.data;
}

const USER_ID_A = makeUserId("11111111-1111-4111-8111-111111111111");
const USER_ID_B = makeUserId("22222222-2222-4222-8222-222222222222");

describe("deriveAnonymizedUserId", () => {
  it("同一 userId + salt で常に同じ UUID を返す (決定論性)", () => {
    const result1 = deriveAnonymizedUserId(USER_ID_A, SALT);
    const result2 = deriveAnonymizedUserId(USER_ID_A, SALT);
    expect(result1).toBe(result2);
  });

  it("異なる userId は異なる UUID を生成する (衝突なし)", () => {
    const resultA = deriveAnonymizedUserId(USER_ID_A, SALT);
    const resultB = deriveAnonymizedUserId(USER_ID_B, SALT);
    expect(resultA).not.toBe(resultB);
  });

  it("UUID v4 形式 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx) に準拠する", () => {
    const result = deriveAnonymizedUserId(USER_ID_A, SALT);
    // UUID v4: version ニブル = 4, variant ニブル = 8, 9, a, b
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("同じ userId でも salt が変わると異なる UUID を生成する", () => {
    const result1 = deriveAnonymizedUserId(USER_ID_A, SALT);
    const result2 = deriveAnonymizedUserId(USER_ID_A, "different-salt-minimum-32chars!!!!");
    expect(result1).not.toBe(result2);
  });

  it("元の userId とは異なる UUID を生成する", () => {
    const result = deriveAnonymizedUserId(USER_ID_A, SALT);
    expect(result).not.toBe(USER_ID_A);
  });
});
