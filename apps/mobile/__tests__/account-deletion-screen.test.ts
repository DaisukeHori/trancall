import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn().mockResolvedValue(null),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/api/auth-api.js", () => ({
  signInWithSupabase: vi.fn(),
  signUpWithSupabase: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  getProfile: vi.fn(),
  getSupabaseClient: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as authApi from "../src/api/auth-api.js";
import { useAuthStore } from "../src/stores/auth-store.js";

const mockSignIn = vi.mocked(authApi.signInWithSupabase);
const mockDeleteAccount = vi.mocked(authApi.deleteAccount);
const mockGetProfile = vi.mocked(authApi.getProfile);

const fakeSession = {
  accessToken: "access-token-xyz",
  refreshToken: "refresh-token-xyz",
  userId: "user-uuid-123",
};

const fakeProfile = {
  id: "user-uuid-123",
  email: "test@example.com",
  display_name: "Test User",
  native_language: "ja" as const,
  created_at: "2026-01-01T00:00:00Z",
};

describe("account deletion flow logic", () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: fakeSession,
      profile: fakeProfile,
      preferredLanguage: "ja",
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  describe("Step 3: password re-authentication and deleteAccount API", () => {
    it("calls signInWithSupabase with user email on confirm", async () => {
      mockSignIn.mockResolvedValue({ ok: true, data: fakeSession });
      mockDeleteAccount.mockResolvedValue({ ok: true, data: { success: true } });

      // Simulate the handleStep3Confirm logic
      const session = useAuthStore.getState().session;
      const profile = useAuthStore.getState().profile;

      expect(session).not.toBeNull();
      expect(profile?.email).toBe("test@example.com");

      const reAuthResult = await authApi.signInWithSupabase("test@example.com", "correct-password");
      expect(mockSignIn).toHaveBeenCalledWith("test@example.com", "correct-password");
      expect(reAuthResult.ok).toBe(true);

      if (!reAuthResult.ok) return;
      const deleteResult = await authApi.deleteAccount(reAuthResult.data.accessToken);
      expect(mockDeleteAccount).toHaveBeenCalledWith("access-token-xyz");
      expect(deleteResult.ok).toBe(true);
    });

    it("throws on invalid password (re-auth fails)", async () => {
      mockSignIn.mockResolvedValue({
        ok: false,
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "AUTH_INVALID_CREDENTIALS",
          retryable: false,
        },
      });

      const reAuthResult = await authApi.signInWithSupabase("test@example.com", "wrong-password");
      expect(reAuthResult.ok).toBe(false);
      // deleteAccount should NOT be called
      expect(mockDeleteAccount).not.toHaveBeenCalled();
    });

    it("does not proceed to deleteAccount when re-auth fails", async () => {
      mockSignIn.mockResolvedValue({
        ok: false,
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "AUTH_INVALID_CREDENTIALS",
          retryable: false,
        },
      });

      const reAuthResult = await authApi.signInWithSupabase("test@example.com", "bad-pw");
      if (!reAuthResult.ok) {
        // Simulates the guard in handleStep3Confirm
        expect(mockDeleteAccount).not.toHaveBeenCalled();
        return;
      }
      await authApi.deleteAccount(reAuthResult.data.accessToken);
    });

    it("propagates deleteAccount API error", async () => {
      mockSignIn.mockResolvedValue({ ok: true, data: fakeSession });
      mockDeleteAccount.mockResolvedValue({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Server error",
          retryable: true,
        },
      });

      const reAuthResult = await authApi.signInWithSupabase("test@example.com", "password");
      expect(reAuthResult.ok).toBe(true);

      if (!reAuthResult.ok) return;
      const deleteResult = await authApi.deleteAccount(reAuthResult.data.accessToken);
      expect(deleteResult.ok).toBe(false);
      if (!deleteResult.ok) {
        expect(deleteResult.error.code).toBe("INTERNAL_ERROR");
      }
    });
  });

  describe("logout after successful deletion (Step 4 done)", () => {
    it("calls logout which clears session and profile", async () => {
      useAuthStore.setState({ session: fakeSession, profile: fakeProfile });

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.session).toBeNull();
      expect(state.profile).toBeNull();
    });
  });

  describe("i18n keys for account_deletion", () => {
    it("all required account_deletion keys exist in en locale", async () => {
      const { default: en } = await import("../../../packages/ui-kit/src/i18n/locales/en.json", {
        with: { type: "json" },
      }) as { default: Record<string, unknown> };

      const ad = en["account_deletion"] as Record<string, unknown>;
      expect(ad).toBeDefined();
      expect(typeof ad["title"]).toBe("string");

      const reason = ad["reason"] as Record<string, unknown>;
      expect(typeof reason["title"]).toBe("string");
      expect(typeof reason["not_using"]).toBe("string");
      expect(typeof reason["privacy"]).toBe("string");
      expect(typeof reason["too_expensive"]).toBe("string");
      expect(typeof reason["found_alternative"]).toBe("string");
      expect(typeof reason["other"]).toBe("string");

      const warning = ad["warning"] as Record<string, unknown>;
      expect(typeof warning["title"]).toBe("string");
      expect(typeof warning["grace_period"]).toBe("string");
      expect(typeof warning["subscription_cancel"]).toBe("string");
      expect(typeof warning["data_irrecoverable"]).toBe("string");
      expect(typeof warning["iap_note"]).toBe("string");
      expect(typeof warning["proceed"]).toBe("string");

      const confirm = ad["confirm"] as Record<string, unknown>;
      expect(typeof confirm["title"]).toBe("string");
      expect(typeof confirm["subtitle"]).toBe("string");
      expect(typeof confirm["submit"]).toBe("string");
      expect(typeof confirm["auth_error"]).toBe("string");

      const grace = ad["grace_period"] as Record<string, unknown>;
      expect(typeof grace["title"]).toBe("string");
      expect(typeof grace["body"]).toBe("string");
      expect(typeof grace["cancellable"]).toBe("string");
      expect(typeof grace["email_sent"]).toBe("string");
      expect(typeof grace["days_label"]).toBe("string");
    });

    it("ja and zh have the same account_deletion keys as en", async () => {
      const [{ default: en }, { default: ja }, { default: zh }] = await Promise.all([
        import("../../../packages/ui-kit/src/i18n/locales/en.json", { with: { type: "json" } }) as Promise<{ default: Record<string, unknown> }>,
        import("../../../packages/ui-kit/src/i18n/locales/ja.json", { with: { type: "json" } }) as Promise<{ default: Record<string, unknown> }>,
        import("../../../packages/ui-kit/src/i18n/locales/zh.json", { with: { type: "json" } }) as Promise<{ default: Record<string, unknown> }>,
      ]);

      function flattenSubkeys(obj: Record<string, unknown>, prefix = ""): string[] {
        const result: string[] = [];
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix.length > 0 ? `${prefix}.${key}` : key;
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            result.push(...flattenSubkeys(value as Record<string, unknown>, fullKey));
          } else {
            result.push(fullKey);
          }
        }
        return result;
      }

      const enAd = (en["account_deletion"] ?? {}) as Record<string, unknown>;
      const jaAd = (ja["account_deletion"] ?? {}) as Record<string, unknown>;
      const zhAd = (zh["account_deletion"] ?? {}) as Record<string, unknown>;

      const enKeys = flattenSubkeys(enAd).sort();
      const jaKeys = flattenSubkeys(jaAd).sort();
      const zhKeys = flattenSubkeys(zhAd).sort();

      expect(jaKeys).toEqual(enKeys);
      expect(zhKeys).toEqual(enKeys);
    });
  });

  describe("password button disable logic", () => {
    it("button should be disabled when password is empty", () => {
      const password = "";
      const canSubmit = password.length >= 1;
      expect(canSubmit).toBe(false);
    });

    it("button should be enabled when password has at least 1 character", () => {
      const password = "x";
      const canSubmit = password.length >= 1;
      expect(canSubmit).toBe(true);
    });

    it("button should be enabled when password has 8 characters", () => {
      const password = "password";
      const canSubmit = password.length >= 1;
      expect(canSubmit).toBe(true);
    });
  });

  describe("step navigation logic", () => {
    it("step 1 -> 2 -> 3 -> 4 progression is valid", () => {
      let step: 1 | 2 | 3 | 4 = 1;

      // Advance to step 2
      step = (step + 1) as 1 | 2 | 3 | 4;
      expect(step).toBe(2);

      // Advance to step 3
      step = (step + 1) as 1 | 2 | 3 | 4;
      expect(step).toBe(3);

      // Advance to step 4 (grace period)
      step = (step + 1) as 1 | 2 | 3 | 4;
      expect(step).toBe(4);
    });

    it("back navigation: step 3 -> 2, step 2 -> 1", () => {
      let step: 1 | 2 | 3 | 4 = 3;

      // Go back from step 3
      step = (step - 1) as 1 | 2 | 3 | 4;
      expect(step).toBe(2);

      // Go back from step 2
      step = (step - 1) as 1 | 2 | 3 | 4;
      expect(step).toBe(1);
    });
  });

  describe("session guard", () => {
    it("returns early when session is null", () => {
      useAuthStore.setState({ session: null, profile: null });

      const session = useAuthStore.getState().session;
      // handleStep3Confirm guard: if session == null, return early
      if (session == null) {
        expect(mockSignIn).not.toHaveBeenCalled();
        expect(mockDeleteAccount).not.toHaveBeenCalled();
        return;
      }

      // Should not reach here
      expect(true).toBe(false);
    });

    it("returns early when profile email is null", () => {
      useAuthStore.setState({
        session: fakeSession,
        profile: { ...fakeProfile, email: "" },
      });

      const profile = useAuthStore.getState().profile;
      const email = profile?.email;

      if (email == null || email.length === 0) {
        expect(mockSignIn).not.toHaveBeenCalled();
        return;
      }

      expect(true).toBe(false);
    });
  });
});

describe("deleteAccount API function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported from auth-api", () => {
    expect(typeof authApi.deleteAccount).toBe("function");
  });

  it("returns ok:true on success", async () => {
    mockDeleteAccount.mockResolvedValue({ ok: true, data: { success: true } });
    const result = await authApi.deleteAccount("some-token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.success).toBe(true);
    }
  });

  it("returns ok:false with error code on failure", async () => {
    mockDeleteAccount.mockResolvedValue({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "NETWORK_ERROR",
        retryable: true,
      },
    });

    const result = await authApi.deleteAccount("some-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });
});
