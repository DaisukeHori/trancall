import { describe, it, expect } from "vitest";
import en from "../src/i18n/locales/en.json" with { type: "json" };
import ja from "../src/i18n/locales/ja.json" with { type: "json" };
import zh from "../src/i18n/locales/zh.json" with { type: "json" };

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result.push(
        ...flattenKeys(value as Record<string, unknown>, fullKey),
      );
    } else {
      result.push(fullKey);
    }
  }
  return result;
}

describe("i18n/locale keys", () => {
  const enKeys = flattenKeys(en as Record<string, unknown>).sort();
  const jaKeys = flattenKeys(ja as Record<string, unknown>).sort();
  const zhKeys = flattenKeys(zh as Record<string, unknown>).sort();

  it("ja has the same keys as en", () => {
    expect(jaKeys).toEqual(enKeys);
  });

  it("zh has the same keys as en", () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it("all three locales have the same key count", () => {
    expect(jaKeys.length).toBe(enKeys.length);
    expect(zhKeys.length).toBe(enKeys.length);
  });

  it("en has errors section", () => {
    const errKeys = enKeys.filter((k) => k.startsWith("errors."));
    expect(errKeys.length).toBeGreaterThan(0);
  });

  it("en has language section with 13 entries", () => {
    const langKeys = enKeys.filter((k) => k.startsWith("language."));
    expect(langKeys.length).toBe(13);
  });

  it("common.ok is present in all locales", () => {
    expect((en as Record<string, Record<string, string>>)["common"]?.["ok"]).toBe("OK");
    expect((ja as Record<string, Record<string, string>>)["common"]?.["ok"]).toBe("OK");
    expect((zh as Record<string, Record<string, string>>)["common"]?.["ok"]).toBe("确定");
  });

  it("errors.NETWORK_ERROR is present in all locales", () => {
    const e = (en as Record<string, Record<string, string>>)["errors"];
    const j = (ja as Record<string, Record<string, string>>)["errors"];
    const c = (zh as Record<string, Record<string, string>>)["errors"];
    expect(e?.["NETWORK_ERROR"]).toBeDefined();
    expect(j?.["NETWORK_ERROR"]).toBeDefined();
    expect(c?.["NETWORK_ERROR"]).toBeDefined();
  });

  it("all locale values are non-empty strings", () => {
    for (const key of enKeys) {
      const parts = key.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let val: any = en;
      for (const part of parts) {
        val = val[part];
      }
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
