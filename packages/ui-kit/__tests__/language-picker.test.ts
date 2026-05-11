import { describe, it, expect } from "vitest";
import { LANGUAGE_LIST, getLanguageInfo } from "../src/components/LanguagePicker.js";

const OUTPUT_LANGUAGE_CODES = [
  "en", "es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it",
] as const;

describe("LanguagePicker/language list", () => {
  it("has exactly 13 languages", () => {
    expect(LANGUAGE_LIST).toHaveLength(13);
  });

  it("contains all 13 OutputLanguage codes", () => {
    const codes = LANGUAGE_LIST.map((l) => l.code);
    for (const code of OUTPUT_LANGUAGE_CODES) {
      expect(codes).toContain(code);
    }
  });

  it("every language has a non-empty flag emoji", () => {
    for (const lang of LANGUAGE_LIST) {
      expect(lang.flag.length).toBeGreaterThan(0);
    }
  });

  it("every language has a non-empty nativeName", () => {
    for (const lang of LANGUAGE_LIST) {
      expect(lang.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("every language has a non-empty englishName", () => {
    for (const lang of LANGUAGE_LIST) {
      expect(lang.englishName.length).toBeGreaterThan(0);
    }
  });

  it("getLanguageInfo returns correct info for 'ja'", () => {
    const info = getLanguageInfo("ja");
    expect(info).toBeDefined();
    expect(info?.flag).toBe("🇯🇵");
    expect(info?.nativeName).toBe("日本語");
  });

  it("getLanguageInfo returns correct info for 'en'", () => {
    const info = getLanguageInfo("en");
    expect(info).toBeDefined();
    expect(info?.nativeName).toBe("English");
  });

  it("all language codes are unique", () => {
    const codes = LANGUAGE_LIST.map((l) => l.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(LANGUAGE_LIST.length);
  });
});
