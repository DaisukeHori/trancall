import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock contacts-api
vi.mock("../src/api/contacts-api.js", () => ({
  getContacts: vi.fn(),
  addContact: vi.fn(),
  removeContact: vi.fn(),
  blockUser: vi.fn(),
}));

// Mock auth-store (used inside contacts-api for token)
vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ session: { accessToken: "test-token" } })),
  },
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as contactsApi from "../src/api/contacts-api.js";
import { useContactsStore } from "../src/stores/contacts-store.js";
import type { ContactEntry } from "../src/api/contacts-api.js";

const mockGetContacts = vi.mocked(contactsApi.getContacts);
const mockAddContact = vi.mocked(contactsApi.addContact);
const mockRemoveContact = vi.mocked(contactsApi.removeContact);
const mockBlockUser = vi.mocked(contactsApi.blockUser);

const makeContact = (overrides: Partial<ContactEntry> = {}): ContactEntry => ({
  id: "entry-1",
  userId: "user-self",
  contactUserId: "user-abc",
  displayName: "Test User",
  trancallId: "@testuser",
  nativeLanguage: "ja",
  isFavorite: false,
  isBlocked: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("useContactsStore", () => {
  beforeEach(() => {
    useContactsStore.setState({
      contacts: [],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe("load()", () => {
    it("sets contacts on success", async () => {
      const contact = makeContact();
      mockGetContacts.mockResolvedValue({ ok: true, data: [contact] });

      await useContactsStore.getState().load();

      const state = useContactsStore.getState();
      expect(state.contacts).toHaveLength(1);
      expect(state.contacts[0]?.displayName).toBe("Test User");
      expect(state.isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockGetContacts.mockResolvedValue({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "Network fail", retryable: true },
      });

      await useContactsStore.getState().load();

      const state = useContactsStore.getState();
      expect(state.contacts).toHaveLength(0);
      expect(state.error).toBe("Network fail");
      expect(state.isLoading).toBe(false);
    });

    it("sets isLoading true during fetch", async () => {
      let resolvePromise!: (val: { ok: true; data: ContactEntry[] }) => void;
      const pending = new Promise<{ ok: true; data: ContactEntry[] }>((res) => {
        resolvePromise = res;
      });
      mockGetContacts.mockReturnValue(pending);

      const loadPromise = useContactsStore.getState().load();
      expect(useContactsStore.getState().isLoading).toBe(true);

      resolvePromise({ ok: true, data: [] });
      await loadPromise;
      expect(useContactsStore.getState().isLoading).toBe(false);
    });
  });

  describe("add()", () => {
    it("appends contact to list on success", async () => {
      const contact = makeContact();
      mockAddContact.mockResolvedValue({ ok: true, data: contact });

      const result = await useContactsStore.getState().add("user-abc");

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe("Test User");
      const state = useContactsStore.getState();
      expect(state.contacts).toHaveLength(1);
    });

    it("returns null on failure", async () => {
      mockAddContact.mockResolvedValue({
        ok: false,
        error: { code: "CONTACT_ALREADY_EXISTS", message: "Already exists", retryable: false },
      });

      const result = await useContactsStore.getState().add("user-abc");

      expect(result).toBeNull();
      expect(useContactsStore.getState().contacts).toHaveLength(0);
    });
  });

  describe("remove()", () => {
    it("removes contact from list on success", async () => {
      const contact = makeContact();
      useContactsStore.setState({ contacts: [contact] });
      mockRemoveContact.mockResolvedValue({ ok: true, data: { success: true } });

      const success = await useContactsStore.getState().remove("entry-1");

      expect(success).toBe(true);
      expect(useContactsStore.getState().contacts).toHaveLength(0);
    });

    it("keeps contact when removal fails", async () => {
      const contact = makeContact();
      useContactsStore.setState({ contacts: [contact] });
      mockRemoveContact.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Server error", retryable: true },
      });

      const success = await useContactsStore.getState().remove("entry-1");

      expect(success).toBe(false);
      expect(useContactsStore.getState().contacts).toHaveLength(1);
    });
  });

  describe("toggleFavorite()", () => {
    it("sets isFavorite to true when was false", () => {
      const contact = makeContact({ isFavorite: false });
      useContactsStore.setState({ contacts: [contact] });

      useContactsStore.getState().toggleFavorite("user-abc");

      expect(useContactsStore.getState().contacts[0]?.isFavorite).toBe(true);
    });

    it("sets isFavorite to false when was true", () => {
      const contact = makeContact({ isFavorite: true });
      useContactsStore.setState({ contacts: [contact] });

      useContactsStore.getState().toggleFavorite("user-abc");

      expect(useContactsStore.getState().contacts[0]?.isFavorite).toBe(false);
    });

    it("only toggles the target contact", () => {
      const c1 = makeContact({ id: "e1", contactUserId: "u1", isFavorite: false });
      const c2 = makeContact({ id: "e2", contactUserId: "u2", isFavorite: false });
      useContactsStore.setState({ contacts: [c1, c2] });

      useContactsStore.getState().toggleFavorite("u1");

      const state = useContactsStore.getState();
      expect(state.contacts[0]?.isFavorite).toBe(true);
      expect(state.contacts[1]?.isFavorite).toBe(false);
    });
  });

  describe("block()", () => {
    it("marks contact as blocked on success", async () => {
      const contact = makeContact({ isBlocked: false });
      useContactsStore.setState({ contacts: [contact] });
      mockBlockUser.mockResolvedValue({ ok: true, data: { success: true } });

      const success = await useContactsStore.getState().block("user-abc");

      expect(success).toBe(true);
      expect(useContactsStore.getState().contacts[0]?.isBlocked).toBe(true);
    });

    it("returns false on block failure", async () => {
      const contact = makeContact();
      useContactsStore.setState({ contacts: [contact] });
      mockBlockUser.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Error", retryable: true },
      });

      const success = await useContactsStore.getState().block("user-abc");

      expect(success).toBe(false);
      expect(useContactsStore.getState().contacts[0]?.isBlocked).toBe(false);
    });
  });

  describe("search()", () => {
    beforeEach(() => {
      const contacts = [
        makeContact({ id: "e1", contactUserId: "u1", displayName: "Alice Smith", trancallId: "@alice", isBlocked: false }),
        makeContact({ id: "e2", contactUserId: "u2", displayName: "Bob Jones", trancallId: "@bob", isBlocked: false }),
        makeContact({ id: "e3", contactUserId: "u3", displayName: "Carol White", trancallId: "@carol", isBlocked: true }),
      ];
      useContactsStore.setState({ contacts });
    });

    it("returns all non-blocked contacts for empty query", () => {
      const results = useContactsStore.getState().search("");
      expect(results).toHaveLength(2);
    });

    it("filters by display name (case insensitive)", () => {
      const results = useContactsStore.getState().search("alice");
      expect(results).toHaveLength(1);
      expect(results[0]?.displayName).toBe("Alice Smith");
    });

    it("filters by trancallId", () => {
      const results = useContactsStore.getState().search("@bob");
      expect(results).toHaveLength(1);
      expect(results[0]?.trancallId).toBe("@bob");
    });

    it("excludes blocked contacts from results", () => {
      const results = useContactsStore.getState().search("carol");
      expect(results).toHaveLength(0);
    });

    it("returns empty array for no matches", () => {
      const results = useContactsStore.getState().search("zzznomatch");
      expect(results).toHaveLength(0);
    });
  });

  describe("getFavoriteIds()", () => {
    it("returns set of favorite contactUserIds", () => {
      const contacts = [
        makeContact({ id: "e1", contactUserId: "u1", isFavorite: true }),
        makeContact({ id: "e2", contactUserId: "u2", isFavorite: false }),
      ];
      useContactsStore.setState({ contacts });

      const ids = useContactsStore.getState().getFavoriteIds();
      expect(ids.has("u1")).toBe(true);
      expect(ids.has("u2")).toBe(false);
    });
  });

  describe("getBlockedIds()", () => {
    it("returns set of blocked contactUserIds", () => {
      const contacts = [
        makeContact({ id: "e1", contactUserId: "u1", isBlocked: true }),
        makeContact({ id: "e2", contactUserId: "u2", isBlocked: false }),
      ];
      useContactsStore.setState({ contacts });

      const ids = useContactsStore.getState().getBlockedIds();
      expect(ids.has("u1")).toBe(true);
      expect(ids.has("u2")).toBe(false);
    });
  });
});
