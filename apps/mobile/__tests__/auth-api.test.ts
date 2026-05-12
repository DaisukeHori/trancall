import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// Mock Supabase client to avoid initialization errors
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  })),
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-key",
}));

import {
  getProfile,
  updateProfile,
  deleteAccount,
  revokeConsent,
} from "../src/api/auth-api.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validProfile = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  email: "test@example.com",
  display_name: "Test User",
  native_language: "ja",
  created_at: "2026-01-01T00:00:00Z",
};

describe("auth-api (extended)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getProfile()", () => {
    it("returns profile on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validProfile));

      const result = await getProfile("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.display_name).toBe("Test User");
        expect(result.data.native_language).toBe("ja");
      }
    });

    it("passes accessToken as Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validProfile));

      await getProfile("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "my-token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/profile"),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
        }),
      );
    });

    it("returns NETWORK_ERROR on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await getProfile("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("returns VALIDATION_ERROR on malformed profile", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: "only-id" }));

      const result = await getProfile("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("updateProfile()", () => {
    it("sends PATCH with patch data", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validProfile));

      await updateProfile({ display_name: "New Name" }, "access-token");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/auth/profile",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ display_name: "New Name" }),
        }),
      );
    });

    it("returns updated profile on success", async () => {
      const updated = { ...validProfile, display_name: "New Name", id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(updated));

      const result = await updateProfile({ display_name: "New Name" }, "access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.display_name).toBe("New Name");
      }
    });

    it("passes Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validProfile));

      await updateProfile({}, "my-patch-token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer my-patch-token" }),
        }),
      );
    });

    it("can update native_language", async () => {
      const updated = { ...validProfile, native_language: "en", id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
      mockFetch.mockResolvedValueOnce(makeJsonResponse(updated));

      const result = await updateProfile({ native_language: "en" }, "token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.native_language).toBe("en");
      }
    });

    it("returns error on 4xx", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ code: "VALIDATION_ERROR", message: "Bad input" }, 400),
      );

      const result = await updateProfile({ display_name: "" }, "token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.httpStatus).toBe(400);
      }
    });
  });

  describe("deleteAccount()", () => {
    it("sends POST to /api/account/delete", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await deleteAccount("access-token");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/account/delete",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns success true on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      const result = await deleteAccount("access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });

    it("passes access token", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await deleteAccount("delete-token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer delete-token" }),
        }),
      );
    });

    it("returns error on 401 unauthorized", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ code: "AUTH_TOKEN_EXPIRED", message: "Expired" }, 401),
      );

      const result = await deleteAccount("expired-token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_TOKEN_EXPIRED");
        expect(result.error.httpStatus).toBe(401);
      }
    });
  });

  describe("revokeConsent()", () => {
    it("sends POST to /api/auth/consent with revoke: true", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await revokeConsent("access-token");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/auth/consent",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ revoke: true }),
        }),
      );
    });

    it("returns success true on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      const result = await revokeConsent("access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });

    it("returns NETWORK_ERROR on failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const result = await revokeConsent("token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });
  });
});
