import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock expo-secure-store before importing the store
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn().mockResolvedValue(null),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth-api
vi.mock("../src/api/auth-api.js", () => ({
  signInWithSupabase: vi.fn(),
  signUpWithSupabase: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  getProfile: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as SecureStore from "expo-secure-store";
import * as authApi from "../src/api/auth-api.js";
import { useAuthStore, selectIsAuthenticated } from "../src/stores/auth-store.js";

const mockSignIn = vi.mocked(authApi.signInWithSupabase);
const mockSignUp = vi.mocked(authApi.signUpWithSupabase);
const mockGetProfile = vi.mocked(authApi.getProfile);
const mockSecureGet = vi.mocked(SecureStore.getItemAsync);

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

describe("useAuthStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useAuthStore.setState({
      session: null,
      profile: null,
      preferredLanguage: "ja",
      isLoading: false,
    });
    vi.clearAllMocks();
    mockSecureGet.mockResolvedValue(null);
  });

  describe("login()", () => {
    it("sets session and profile on success", async () => {
      mockSignIn.mockResolvedValue({ ok: true, data: fakeSession });
      mockGetProfile.mockResolvedValue({ ok: true, data: fakeProfile });

      const result = await useAuthStore.getState().login("test@example.com", "password123");

      expect(result.ok).toBe(true);
      const state = useAuthStore.getState();
      expect(state.session?.accessToken).toBe("access-token-xyz");
      expect(state.profile?.display_name).toBe("Test User");
      expect(state.isLoading).toBe(false);
    });

    it("returns error on invalid credentials", async () => {
      mockSignIn.mockResolvedValue({
        ok: false,
        error: { code: "AUTH_INVALID_CREDENTIALS", message: "Bad creds", retryable: false },
      });

      const result = await useAuthStore.getState().login("bad@example.com", "wrongpass");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      }
      const state = useAuthStore.getState();
      expect(state.session).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("sets session even when profile fetch fails", async () => {
      mockSignIn.mockResolvedValue({ ok: true, data: fakeSession });
      mockGetProfile.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Server error", retryable: true },
      });

      const result = await useAuthStore.getState().login("test@example.com", "password123");

      expect(result.ok).toBe(true);
      const state = useAuthStore.getState();
      expect(state.session).not.toBeNull();
      expect(state.profile).toBeNull();
    });
  });

  describe("signup()", () => {
    it("requires consent", async () => {
      const result = await useAuthStore.getState().signup(
        "new@example.com",
        "password123",
        "New User",
        "en",
        false, // consentAccepted = false
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_CONSENT_REQUIRED");
      }
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("creates session on successful signup", async () => {
      mockSignUp.mockResolvedValue({ ok: true, data: fakeSession });
      mockGetProfile.mockResolvedValue({ ok: true, data: fakeProfile });

      const result = await useAuthStore.getState().signup(
        "new@example.com",
        "password123",
        "New User",
        "en",
        true,
      );

      expect(result.ok).toBe(true);
      const state = useAuthStore.getState();
      expect(state.session?.userId).toBe("user-uuid-123");
    });
  });

  describe("logout()", () => {
    it("clears session and profile", async () => {
      useAuthStore.setState({ session: fakeSession, profile: fakeProfile });

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.session).toBeNull();
      expect(state.profile).toBeNull();
    });
  });

  describe("restore()", () => {
    it("does nothing when SecureStore is empty", async () => {
      mockSecureGet.mockResolvedValue(null);

      await useAuthStore.getState().restore();

      const state = useAuthStore.getState();
      expect(state.session).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("restores session from SecureStore", async () => {
      mockSecureGet.mockResolvedValue(JSON.stringify(fakeSession));
      mockGetProfile.mockResolvedValue({ ok: true, data: fakeProfile });

      await useAuthStore.getState().restore();

      const state = useAuthStore.getState();
      expect(state.session?.accessToken).toBe("access-token-xyz");
      expect(state.profile?.display_name).toBe("Test User");
      expect(state.isLoading).toBe(false);
    });

    it("handles malformed SecureStore data gracefully", async () => {
      mockSecureGet.mockResolvedValue("not-valid-json{{{");

      await useAuthStore.getState().restore();

      const state = useAuthStore.getState();
      expect(state.session).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("setPreferredLanguage()", () => {
    it("updates preferred language", () => {
      useAuthStore.getState().setPreferredLanguage("en");
      expect(useAuthStore.getState().preferredLanguage).toBe("en");
    });
  });

  describe("selectIsAuthenticated()", () => {
    it("returns false when session is null", () => {
      const state = useAuthStore.getState();
      expect(selectIsAuthenticated(state)).toBe(false);
    });

    it("returns true when session is set", () => {
      useAuthStore.setState({ session: fakeSession });
      const state = useAuthStore.getState();
      expect(selectIsAuthenticated(state)).toBe(true);
    });
  });
});
