/**
 * language.test.ts — OutputLanguage / InputLanguage スキーマの単体テスト
 *
 * OutputLanguage: 13 言語 enum の全値 safeParse + 非対応・大文字 fail
 * InputLanguage: "auto" リテラル + BCP-47 形式 + 不正形式
 */

import { describe, expect, it } from "vitest";

import {
  OutputLanguage,
  InputLanguage,
} from "../src/schemas/language.js";

// --- OutputLanguage ---

describe("OutputLanguage", () => {
  const SUPPORTED: string[] = [
    "en", "es", "pt", "fr", "ja", "ru", "zh",
    "de", "ko", "hi", "id", "vi", "it",
  ];

  it("13 言語すべてが safeParse で success になる", () => {
    for (const lang of SUPPORTED) {
      const result = OutputLanguage.safeParse(lang);
      expect(result.success, `"${lang}" は success であるべき`).toBe(true);
    }
  });

  it('"en" が success になる', () => {
    expect(OutputLanguage.safeParse("en").success).toBe(true);
  });

  it('"ja" が success になる', () => {
    expect(OutputLanguage.safeParse("ja").success).toBe(true);
  });

  it('"zh" が success になる', () => {
    expect(OutputLanguage.safeParse("zh").success).toBe(true);
  });

  it('"vi" が success になる', () => {
    expect(OutputLanguage.safeParse("vi").success).toBe(true);
  });

  it("未対応言語 klingon は fail になる", () => {
    expect(OutputLanguage.safeParse("klingon").success).toBe(false);
  });

  it("未対応言語 tlh は fail になる", () => {
    expect(OutputLanguage.safeParse("tlh").success).toBe(false);
  });

  it("空文字は fail になる", () => {
    expect(OutputLanguage.safeParse("").success).toBe(false);
  });

  it("大文字 JA は fail になる (case-sensitive)", () => {
    expect(OutputLanguage.safeParse("JA").success).toBe(false);
  });

  it("大文字 EN は fail になる (case-sensitive)", () => {
    expect(OutputLanguage.safeParse("EN").success).toBe(false);
  });

  it("未対応の数字文字列は fail になる", () => {
    expect(OutputLanguage.safeParse("123").success).toBe(false);
  });
});

// --- InputLanguage ---

describe("InputLanguage", () => {
  describe("success ケース", () => {
    it('"auto" リテラルが success になる', () => {
      expect(InputLanguage.safeParse("auto").success).toBe(true);
    });

    it('"en-US" (BCP-47) が success になる', () => {
      expect(InputLanguage.safeParse("en-US").success).toBe(true);
    });

    it('"ja" (2文字 BCP-47) が success になる', () => {
      expect(InputLanguage.safeParse("ja").success).toBe(true);
    });

    it('"zh-CN" が success になる', () => {
      expect(InputLanguage.safeParse("zh-CN").success).toBe(true);
    });

    it('"pt-BR" が success になる', () => {
      expect(InputLanguage.safeParse("pt-BR").success).toBe(true);
    });

    it('"ko" (2文字小文字) が success になる', () => {
      expect(InputLanguage.safeParse("ko").success).toBe(true);
    });

    it('"eng" (3文字小文字) が success になる', () => {
      expect(InputLanguage.safeParse("eng").success).toBe(true);
    });
  });

  describe("fail ケース", () => {
    it('"En-us" (先頭大文字) は fail になる', () => {
      expect(InputLanguage.safeParse("En-us").success).toBe(false);
    });

    it('"JA" (全大文字) は fail になる', () => {
      expect(InputLanguage.safeParse("JA").success).toBe(false);
    });

    it('"a" (1文字) は fail になる (min 2文字)', () => {
      expect(InputLanguage.safeParse("a").success).toBe(false);
    });

    it("空文字は fail になる", () => {
      expect(InputLanguage.safeParse("").success).toBe(false);
    });

    it('"en-us" (サブタグが小文字のみ) は fail になる (サブタグ先頭は大文字が必要)', () => {
      // 正規表現: -[A-Z][a-zA-Z]{1,7} なのでサブタグ先頭は大文字必須
      expect(InputLanguage.safeParse("en-us").success).toBe(false);
    });
  });
});
