import { describe, it, expect, vi } from "vitest";

// Mock react-native modules (not available in node test env)
vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));

// Mock @trancall/ui-kit
vi.mock("@trancall/ui-kit", () => ({
  useTheme: () => ({
    colors: {
      bgPrimary: "#FFFFFF",
      bgSecondary: "#F2F2F7",
      textPrimary: "#000000",
      textSecondary: "#3C3C43",
      textTertiary: "#C7C7CC",
      border: "#C6C6C8",
    },
    spacing: {
      16: 16,
    },
    radii: {
      12: 12,
    },
  }),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  i18n: {
    language: "ja",
  },
}));

// Mock navigation
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
  }),
}));

// Mock i18n
vi.mock("../src/i18n/index.js", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  i18n: {
    language: "ja",
  },
}));

// Mock auth-store
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: vi.fn(() => ({
    profile: null,
    session: null,
    logout: vi.fn(),
  })),
}));

// Mock auth-api
vi.mock("../src/api/auth-api.js", () => ({
  deleteAccount: vi.fn(),
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import { FAQ_ENTRIES, FAQ_CATEGORIES } from "../src/data/faq.js";
import type { FaqCategory } from "../src/data/faq.js";

// ── FAQ data tests ──────────────────────────────────────────────────────────

describe("FAQ data (faq.ts)", () => {
  it("FAQ_ENTRIES has at least 1 entry per category", () => {
    for (const category of FAQ_CATEGORIES) {
      const entries = FAQ_ENTRIES.filter((e) => e.category === category);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("each entry has 5 categories covered", () => {
    const categories = new Set(FAQ_ENTRIES.map((e) => e.category));
    expect(categories.size).toBe(5);
    const expectedCategories: FaqCategory[] = [
      "account",
      "call",
      "translation",
      "billing",
      "privacy",
    ];
    for (const cat of expectedCategories) {
      expect(categories.has(cat)).toBe(true);
    }
  });

  it("each FAQ entry has ja/en/zh question texts", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.question.ja.length).toBeGreaterThan(0);
      expect(entry.question.en.length).toBeGreaterThan(0);
      expect(entry.question.zh.length).toBeGreaterThan(0);
    }
  });

  it("each FAQ entry has ja/en/zh answer texts", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.answer.ja.length).toBeGreaterThan(0);
      expect(entry.answer.en.length).toBeGreaterThan(0);
      expect(entry.answer.zh.length).toBeGreaterThan(0);
    }
  });

  it("each FAQ entry id is unique", () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("total FAQ entries count is at least 15 (5 categories x 3 minimum)", () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(15);
  });

  it("account category has 4 entries", () => {
    const entries = FAQ_ENTRIES.filter((e) => e.category === "account");
    expect(entries.length).toBe(4);
  });

  it("call category has 4 entries", () => {
    const entries = FAQ_ENTRIES.filter((e) => e.category === "call");
    expect(entries.length).toBe(4);
  });

  it("translation category has 3 entries", () => {
    const entries = FAQ_ENTRIES.filter((e) => e.category === "translation");
    expect(entries.length).toBe(3);
  });

  it("billing category has 4 entries", () => {
    const entries = FAQ_ENTRIES.filter((e) => e.category === "billing");
    expect(entries.length).toBe(4);
  });

  it("privacy category has 4 entries", () => {
    const entries = FAQ_ENTRIES.filter((e) => e.category === "privacy");
    expect(entries.length).toBe(4);
  });
});

// ── i18n locale switch ──────────────────────────────────────────────────────

describe("FAQ locale text switching", () => {
  it("returns different text per locale for a given entry", () => {
    const entry = FAQ_ENTRIES[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    // Each locale should be different from each other (at minimum ja vs en)
    expect(entry.question.ja).not.toBe(entry.question.en);
    expect(entry.question.ja).not.toBe(entry.question.zh);
    expect(entry.question.en).not.toBe(entry.question.zh);
  });

  it("all three locales are non-empty strings for all entries", () => {
    const locales = ["ja", "en", "zh"] as const;
    for (const entry of FAQ_ENTRIES) {
      for (const locale of locales) {
        expect(typeof entry.question[locale]).toBe("string");
        expect(entry.question[locale].length).toBeGreaterThan(0);
        expect(typeof entry.answer[locale]).toBe("string");
        expect(entry.answer[locale].length).toBeGreaterThan(0);
      }
    }
  });
});

// ── FAQ_CATEGORIES order ────────────────────────────────────────────────────

describe("FAQ_CATEGORIES", () => {
  it("contains exactly 5 categories in the expected order", () => {
    expect(FAQ_CATEGORIES).toEqual([
      "account",
      "call",
      "translation",
      "billing",
      "privacy",
    ]);
  });
});
