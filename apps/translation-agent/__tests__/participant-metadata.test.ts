/**
 * parseParticipantMetadata 単体テスト
 *
 * カバー項目:
 * - undefined 入力 → Result error
 * - 空文字 → Result error
 * - 不正 JSON 文字列 → Result error
 * - 不正 lang 値（Zod enum 不一致）→ Result error
 * - nativeLanguage フィールド欠損 → Result error
 * - 正常ケース（"ja"）→ Result ok with nativeLanguage: "ja"
 */

import { describe, it, expect } from "vitest";

import { parseParticipantMetadata } from "../src/participant-metadata.js";

describe("parseParticipantMetadata: エラーケース", () => {
  it("undefined 入力 → ok: false", () => {
    const result = parseParticipantMetadata(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it("空文字 → ok: false", () => {
    const result = parseParticipantMetadata("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it("不正 JSON 文字列 → ok: false", () => {
    const result = parseParticipantMetadata("{not json}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON");
  });

  it("不正 lang 値（Zod enum 不一致）→ ok: false", () => {
    const result = parseParticipantMetadata('{"nativeLanguage":"xx"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it("nativeLanguage フィールド欠損 → ok: false", () => {
    const result = parseParticipantMetadata("{}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });
});

describe("parseParticipantMetadata: 正常ケース", () => {
  it('"ja" → ok: true with nativeLanguage: "ja"', () => {
    const result = parseParticipantMetadata('{"nativeLanguage":"ja"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nativeLanguage).toBe("ja");
  });
});
