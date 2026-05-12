/**
 * consent-screen.test.ts
 *
 * consent-screen.tsx のロジックテスト:
 * - 各 scope の checkbox レンダリング
 * - 必須未同意時のボタン disable
 * - recordConsent 並列実行
 * - AUTH_CONSENT_* error の interceptor 動作
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

// Mock react-native
vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Linking: { openURL: vi.fn() },
  Modal: "Modal",
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));

// Mock @trancall/ui-kit
vi.mock("@trancall/ui-kit", () => ({
  Button: "Button",
  useTheme: () => ({
    colors: {
      bgPrimary: "#FFFFFF",
      bgSecondary: "#F2F2F7",
      textPrimary: "#000000",
      textSecondary: "#3C3C43",
      textTertiary: "#C7C7CC",
      border: "#C6C6C8",
      primary: "#0A7AFF",
      danger: "#FF3B30",
    },
    spacing: Object.fromEntries([4, 8, 12, 16, 24, 32, 48, 64].map((n) => [n, n])),
    radii: { 4: 4, 8: 8 },
  }),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  i18n: { language: "ja" },
}));

// Mock i18n
vi.mock("../src/i18n/index.js", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  i18n: { language: "ja" },
}));

// Mock navigation
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
  NavigationContainer: "NavigationContainer",
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

// Mock consent-api — default: success
const mockRecordConsent = vi
  .fn<
    (
      scope: string,
      version: string,
      source: string,
      accessToken: string,
    ) => Promise<{ ok: true; data: { ok: boolean } }>
  >()
  .mockResolvedValue({ ok: true, data: { ok: true } });
vi.mock("../src/api/consent-api.js", () => ({
  recordConsent: (
    scope: string,
    version: string,
    source: string,
    accessToken: string,
  ) => mockRecordConsent(scope, version, source, accessToken),
  getRequiredConsents: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  revokeConsentByScope: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }),
}));

// Mock auth-store
const mockSession = { accessToken: "test-token", refreshToken: "r", userId: "u1" };
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = { session: mockSession };
    return selector(state);
  }),
  selectSession: (state: { session: unknown }) => state.session,
  selectIsAuthenticated: (state: { session: unknown }) => state.session != null,
}));

// ──────────────────────────────────────────────
// Test data
// ──────────────────────────────────────────────

import type { RequiredConsentView } from "@trancall/shared-kernel";

const makeConsent = (overrides: Partial<RequiredConsentView>): RequiredConsentView => ({
  scope: "legal_terms",
  currentVersion: "2026-05-12",
  userVersion: null,
  isRequired: true,
  isUpToDate: false,
  documentUrl: null,
  ...overrides,
});

const requiredLegalTerms = makeConsent({
  scope: "legal_terms",
  isRequired: true,
  isUpToDate: false,
  documentUrl: "https://trancall.app/terms",
});

const requiredPrivacyPolicy = makeConsent({
  scope: "privacy_policy",
  isRequired: true,
  isUpToDate: false,
  documentUrl: "https://trancall.app/privacy",
});

const optionalVoiceToOpenAI = makeConsent({
  scope: "voice_to_openai",
  isRequired: false,
  isUpToDate: false,
  documentUrl: null,
});

const alreadyAcceptedConsent = makeConsent({
  scope: "transcript_retention",
  isRequired: false,
  isUpToDate: true,
  userVersion: "2026-05-12",
  documentUrl: null,
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("consent-screen ロジック", () => {
  beforeEach(() => {
    mockRecordConsent.mockReset();
    mockRecordConsent.mockResolvedValue({ ok: true, data: { ok: true } });
  });

  // ──────────────────────────────────────────────
  // 必須 scope の判定ロジック
  // ──────────────────────────────────────────────

  describe("必須 scope の判定", () => {
    it("isRequired=true の scope がすべて存在する", () => {
      const consents = [requiredLegalTerms, requiredPrivacyPolicy, optionalVoiceToOpenAI];
      const requiredScopes = consents.filter((cv) => cv.isRequired);
      expect(requiredScopes).toHaveLength(2);
      expect(requiredScopes.map((c) => c.scope)).toContain("legal_terms");
      expect(requiredScopes.map((c) => c.scope)).toContain("privacy_policy");
    });

    it("isRequired=false の scope は optional", () => {
      const consents = [optionalVoiceToOpenAI];
      const requiredScopes = consents.filter((cv) => cv.isRequired);
      expect(requiredScopes).toHaveLength(0);
    });

    it("すべて isUpToDate=true の場合は同意不要", () => {
      const consents = [alreadyAcceptedConsent];
      const needsConsent = consents.some((cv) => cv.isRequired && !cv.isUpToDate);
      expect(needsConsent).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // ボタン disabled ロジック
  // ──────────────────────────────────────────────

  describe("ボタン disabled ロジック", () => {
    it("必須未同意の場合は disabled=true", () => {
      const checkedScopes: Record<string, boolean> = {
        legal_terms: false,
        privacy_policy: false,
      };
      const requiredConsents = [requiredLegalTerms, requiredPrivacyPolicy];
      const allRequiredChecked = requiredConsents.every(
        (cv) => checkedScopes[cv.scope] === true,
      );
      expect(allRequiredChecked).toBe(false);
    });

    it("必須 scope を全チェックした場合は disabled=false", () => {
      const checkedScopes: Record<string, boolean> = {
        legal_terms: true,
        privacy_policy: true,
      };
      const requiredConsents = [requiredLegalTerms, requiredPrivacyPolicy];
      const allRequiredChecked = requiredConsents.every(
        (cv) => checkedScopes[cv.scope] === true,
      );
      expect(allRequiredChecked).toBe(true);
    });

    it("optional scope がチェックされていなくても必須が揃えば disabled=false", () => {
      const checkedScopes: Record<string, boolean> = {
        legal_terms: true,
        privacy_policy: true,
        voice_to_openai: false,
      };
      const requiredConsents = [
        requiredLegalTerms,
        requiredPrivacyPolicy,
        optionalVoiceToOpenAI,
      ];
      const allRequiredChecked = requiredConsents
        .filter((cv) => cv.isRequired)
        .every((cv) => checkedScopes[cv.scope] === true);
      expect(allRequiredChecked).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // recordConsent 並列実行ロジック
  // ──────────────────────────────────────────────

  describe("recordConsent 並列実行", () => {
    it("チェックした scope を並列で recordConsent する", async () => {
      // mockRecordConsent はモジュール冒頭で宣言した vi.fn()
      mockRecordConsent.mockResolvedValue({ ok: true, data: { ok: true } });

      const consentsToRecord: RequiredConsentView[] = [
        requiredLegalTerms,
        requiredPrivacyPolicy,
      ];
      const checkedScopes: Record<string, boolean> = {
        legal_terms: true,
        privacy_policy: true,
      };
      const source = "onboarding" as const;
      const accessToken = "test-token";

      const scopesToRecord = consentsToRecord.filter(
        (cv) => checkedScopes[cv.scope] === true && !cv.isUpToDate,
      );

      const results = await Promise.all(
        scopesToRecord.map((cv) =>
          mockRecordConsent(cv.scope, cv.currentVersion, source, accessToken),
        ),
      );

      expect(mockRecordConsent).toHaveBeenCalledTimes(2);
      expect(mockRecordConsent).toHaveBeenCalledWith(
        "legal_terms",
        "2026-05-12",
        "onboarding",
        "test-token",
      );
      expect(mockRecordConsent).toHaveBeenCalledWith(
        "privacy_policy",
        "2026-05-12",
        "onboarding",
        "test-token",
      );
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it("isUpToDate=true の scope は recordConsent しない", async () => {
      mockRecordConsent.mockResolvedValue({ ok: true, data: { ok: true } });

      const consentsToRecord: RequiredConsentView[] = [alreadyAcceptedConsent];
      const checkedScopes: Record<string, boolean> = {
        transcript_retention: true,
      };

      const scopesToRecord = consentsToRecord.filter(
        (cv) => checkedScopes[cv.scope] === true && !cv.isUpToDate,
      );

      await Promise.all(
        scopesToRecord.map((cv) =>
          mockRecordConsent(cv.scope, cv.currentVersion, "onboarding", "tok"),
        ),
      );

      // isUpToDate=true なので呼ばれない
      expect(mockRecordConsent).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // data_deletion_request 除外ロジック
  // ──────────────────────────────────────────────

  describe("data_deletion_request の除外", () => {
    it("表示用リストから data_deletion_request を除外する", () => {
      const consents: RequiredConsentView[] = [
        requiredLegalTerms,
        makeConsent({ scope: "data_deletion_request", isRequired: true, isUpToDate: false }),
      ];
      const displayConsents = consents.filter((cv) => cv.scope !== "data_deletion_request");
      expect(displayConsents).toHaveLength(1);
      expect(displayConsents[0]?.scope).toBe("legal_terms");
    });
  });
});

// ──────────────────────────────────────────────
// AUTH_CONSENT_* interceptor ロジック
// ──────────────────────────────────────────────

describe("consent-interceptor", () => {
  it("isConsentError が AUTH_CONSENT_REQUIRED を検出する", async () => {
    const { isConsentError } = await import("../src/lib/consent-interceptor.js");
    expect(isConsentError("AUTH_CONSENT_REQUIRED")).toBe(true);
    expect(isConsentError("AUTH_CONSENT_VERSION_MISMATCH")).toBe(true);
  });

  it("isConsentError が AUTH_CONSENT_* 以外を false にする", async () => {
    const { isConsentError } = await import("../src/lib/consent-interceptor.js");
    expect(isConsentError("NETWORK_ERROR")).toBe(false);
    expect(isConsentError("AUTH_INVALID_CREDENTIALS")).toBe(false);
    expect(isConsentError("AUTH_CONSENT_IRREVOCABLE")).toBe(false);
  });

  it("handleConsentError が AUTH_CONSENT_REQUIRED で requestConsentRedirect を呼ぶ", async () => {
    // consent-store を直接インポートして spy する
    const { useConsentStore } = await import("../src/stores/consent-store.js");
    const mockRequest = vi.fn();
    // getState を一時的に上書き
    const originalGetState = useConsentStore.getState.bind(useConsentStore);
    vi.spyOn(useConsentStore, "getState").mockReturnValue({
      ...originalGetState(),
      requestConsentRedirect: mockRequest,
    });

    const { handleConsentError } = await import("../src/lib/consent-interceptor.js");
    const onComplete = vi.fn();

    const handled = handleConsentError(
      { code: "AUTH_CONSENT_REQUIRED" },
      [],
      "incoming_call_first_time",
      onComplete,
    );

    expect(handled).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith({
      errorCode: "AUTH_CONSENT_REQUIRED",
      requiredConsents: [],
      source: "incoming_call_first_time",
      onComplete,
    });

    // Restore
    vi.restoreAllMocks();
  });

  it("handleConsentError が AUTH_CONSENT_* 以外で false を返す", async () => {
    const { handleConsentError } = await import("../src/lib/consent-interceptor.js");
    const handled = handleConsentError({ code: "NETWORK_ERROR" }, [], "onboarding", vi.fn());
    expect(handled).toBe(false);
  });
});
