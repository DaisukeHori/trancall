import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// Mock auth-store for token retrieval
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      session: { accessToken: "test-access-token" },
    })),
  },
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import {
  getContacts,
  addContact,
  removeContact,
  searchUsers,
  createInviteLink,
  blockUser,
  reportUser,
} from "../src/api/contacts-api.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validContact = {
  id: "entry-uuid-1",
  userId: "self-uuid",
  contactUserId: "other-uuid",
  displayName: "Test User",
  trancallId: "@testuser",
  nativeLanguage: "ja",
  isFavorite: false,
  isBlocked: false,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("contacts-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getContacts()", () => {
    it("returns array of contacts on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([validContact]));

      const result = await getContacts();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.displayName).toBe("Test User");
      }
    });

    it("returns empty array when no contacts", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));

      const result = await getContacts();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it("sends Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));

      await getContacts();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-access-token" }),
        }),
      );
    });

    it("returns NETWORK_ERROR when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const result = await getContacts();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("returns VALIDATION_ERROR for malformed response", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ notAnArray: true }));

      const result = await getContacts();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("addContact()", () => {
    it("returns the new contact entry on success", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validContact, 201));

      const result = await addContact("other-uuid");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.contactUserId).toBe("other-uuid");
      }
    });

    it("sends POST with contactUserId in body", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse(validContact, 201));

      await addContact("other-uuid");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ contactUserId: "other-uuid" }),
        }),
      );
    });

    it("returns error on 409 CONTACT_ALREADY_EXISTS", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ code: "CONTACT_ALREADY_EXISTS", message: "Already exists" }, 409),
      );

      const result = await addContact("other-uuid");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONTACT_ALREADY_EXISTS");
        expect(result.error.httpStatus).toBe(409);
      }
    });
  });

  describe("removeContact()", () => {
    it("calls DELETE with encoded id in URL", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await removeContact("entry-uuid-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts/entry-uuid-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("returns success true on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      const result = await removeContact("entry-uuid-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });
  });

  describe("searchUsers()", () => {
    const validProfile = {
      userId: "u1",
      displayName: "Alice",
      trancallId: "@alice",
      nativeLanguage: "en",
    };

    it("returns matching profiles", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([validProfile]));

      const result = await searchUsers("alice");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0]?.displayName).toBe("Alice");
      }
    });

    it("URL-encodes the query param", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));

      await searchUsers("@alice test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent("@alice test")),
        expect.anything(),
      );
    });

    it("returns empty array when no results", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse([]));

      const result = await searchUsers("zzznomatch");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  describe("createInviteLink()", () => {
    it("returns invite URL on success", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ inviteUrl: "https://trancall.app/invite/abc123" }),
      );

      const result = await createInviteLink();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.inviteUrl).toContain("invite");
      }
    });

    it("sends POST to /api/contacts/invite-link", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ inviteUrl: "https://trancall.app/invite/abc123" }),
      );

      await createInviteLink();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts/invite-link",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("blockUser()", () => {
    it("sends POST with userId in body", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await blockUser("target-user-id");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts/block",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "target-user-id" }),
        }),
      );
    });

    it("returns success true on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      const result = await blockUser("target-user-id");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
      }
    });
  });

  describe("reportUser()", () => {
    it("sends POST with userId and optional reason", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      await reportUser("target-user-id", "spam");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/contacts/report",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "target-user-id", reason: "spam" }),
        }),
      );
    });

    it("returns success true on 200", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ success: true }));

      const result = await reportUser("target-user-id");

      expect(result.ok).toBe(true);
    });
  });
});
