/**
 * M-11: __e2e_pushSubtitleDelta 注入口のユニットテスト
 *
 * docs/e2e-test-design.md §11 の未解決事項 1 に対応する実装
 * (apps/mobile/src/lib/e2e/subtitle-injection.ts) の検証。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth-store.js imports expo-secure-store, which (unmocked) transitively pulls in
// the real react-native package and breaks under vitest's SSR transform (Flow
// syntax). Mock it before importing anything, matching auth-store.test.ts.
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn().mockResolvedValue(null),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

import { useSubtitleStore } from "../src/stores/subtitle-store.js";
import { useAuthStore } from "../src/stores/auth-store.js";
import {
  pushSubtitleDelta,
  registerE2ESubtitleInjection,
} from "../src/lib/e2e/subtitle-injection.js";

function setNativeLanguage(lang: "ja" | "en" | "zh"): void {
  useAuthStore.setState({
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "e2e_user_a@trancall.dev",
      display_name: "E2E User",
      native_language: lang,
      avatar_url: null,
      created_at: new Date().toISOString(),
    },
  });
}

beforeEach(() => {
  useSubtitleStore.getState().reset();
  useAuthStore.setState({ profile: null, session: null });
});

afterEach(() => {
  delete globalThis.__e2e_pushSubtitleDelta;
  vi.unstubAllEnvs();
});

describe("pushSubtitleDelta", () => {
  it("valid payload (peer side) updates useSubtitleStore.partial via the same parseSubtitleDelta path as production", () => {
    setNativeLanguage("ja");
    pushSubtitleDelta({
      sourceLang: "en",
      targetLang: "ja",
      text: "こんにちは",
      isFinal: false,
    });

    const { partial } = useSubtitleStore.getState();
    expect(partial?.text).toBe("こんにちは");
    expect(partial?.side).toBe("peer");
    expect(partial?.isFinal).toBe(false);
  });

  it("valid payload (me side, isFinal=true) commits a final segment", () => {
    setNativeLanguage("ja");
    pushSubtitleDelta({
      sourceLang: "ja",
      targetLang: "en",
      text: "Hello there",
      isFinal: true,
    });

    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(1);
    expect(finals[0]?.side).toBe("me");
    expect(finals[0]?.translated).toBe("Hello there");
  });

  it("falls back to 'ja' native language when no profile is hydrated yet", () => {
    // profile === null (未 hydrate) — in-call-screen.tsx と同じ ?? 'ja' フォールバック
    pushSubtitleDelta({
      sourceLang: "en",
      targetLang: "ja",
      text: "フォールバック",
      isFinal: false,
    });

    expect(useSubtitleStore.getState().partial?.text).toBe("フォールバック");
  });

  it("drops delta silently (no store mutation) when neither lang matches my native language", () => {
    setNativeLanguage("ja");
    pushSubtitleDelta({
      sourceLang: "en",
      targetLang: "zh",
      text: "irrelevant",
      isFinal: false,
    });

    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(0);
  });

  it("rejects an invalid payload (missing required text) without throwing or mutating the store", () => {
    setNativeLanguage("ja");
    expect(() =>
      pushSubtitleDelta({ sourceLang: "en", targetLang: "ja", isFinal: false }),
    ).not.toThrow();
    expect(useSubtitleStore.getState().partial).toBeNull();
  });

  it("rejects an unsupported language code without throwing", () => {
    setNativeLanguage("ja");
    expect(() =>
      pushSubtitleDelta({
        sourceLang: "not-a-lang",
        targetLang: "ja",
        text: "x",
        isFinal: false,
      }),
    ).not.toThrow();
    expect(useSubtitleStore.getState().partial).toBeNull();
  });

  it("generates a fresh sessionId per call when omitted (segmentId differs across calls)", () => {
    setNativeLanguage("ja");
    pushSubtitleDelta({ sourceLang: "en", targetLang: "ja", text: "first", isFinal: true });
    const firstId = useSubtitleStore.getState().finals[0]?.id;

    pushSubtitleDelta({ sourceLang: "en", targetLang: "ja", text: "second", isFinal: true });
    const secondId = useSubtitleStore.getState().finals[1]?.id;

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
  });

  it("honors an explicit sessionId when provided", () => {
    setNativeLanguage("ja");
    const sessionId = "12345678-1234-4234-a234-123456789abc";
    pushSubtitleDelta({
      sourceLang: "en",
      targetLang: "ja",
      text: "with session",
      isFinal: true,
      sessionId,
    });
    expect(useSubtitleStore.getState().finals[0]?.id).toContain(sessionId);
  });
});

describe("registerE2ESubtitleInjection — 本番ビルドガード", () => {
  it("does not register globalThis.__e2e_pushSubtitleDelta when EXPO_PUBLIC_E2E_TEST_MODE is not 'true'", () => {
    vi.stubEnv("EXPO_PUBLIC_E2E_TEST_MODE", "false");
    registerE2ESubtitleInjection();
    expect(globalThis.__e2e_pushSubtitleDelta).toBeUndefined();
  });

  it("does not register when EXPO_PUBLIC_E2E_TEST_MODE is unset", () => {
    vi.stubEnv("EXPO_PUBLIC_E2E_TEST_MODE", "");
    registerE2ESubtitleInjection();
    expect(globalThis.__e2e_pushSubtitleDelta).toBeUndefined();
  });

  it("registers globalThis.__e2e_pushSubtitleDelta only when EXPO_PUBLIC_E2E_TEST_MODE==='true'", () => {
    setNativeLanguage("ja");
    vi.stubEnv("EXPO_PUBLIC_E2E_TEST_MODE", "true");
    registerE2ESubtitleInjection();
    expect(typeof globalThis.__e2e_pushSubtitleDelta).toBe("function");

    globalThis.__e2e_pushSubtitleDelta?.({
      sourceLang: "en",
      targetLang: "ja",
      text: "via global",
      isFinal: false,
    });
    expect(useSubtitleStore.getState().partial?.text).toBe("via global");
  });
});
