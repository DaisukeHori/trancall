import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock room-api
vi.mock("../src/api/room-api.js", () => ({
  getRoomHistory: vi.fn(),
}));

// Mock auth-store
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

import * as roomApi from "../src/api/room-api.js";
import { useRecentCallsStore } from "../src/stores/recent-calls-store.js";
import type { RecentCallEntry, RoomHistoryEntry } from "../src/stores/recent-calls-store.js";

const mockGetRoomHistory = vi.mocked(roomApi.getRoomHistory);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCall(overrides: Partial<RecentCallEntry> = {}): RecentCallEntry {
  return {
    id: "call-1",
    contactUserId: "user-abc",
    contactDisplayName: "Test User",
    contactTrancallId: "@testuser",
    direction: "outbound",
    durationSeconds: 120,
    costYen: 96,
    missed: false,
    translationEnabled: true,
    fromLanguage: "ja",
    toLanguage: "en",
    startedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<RoomHistoryEntry> = {}): RoomHistoryEntry {
  return {
    roomId: "room-1",
    status: "ended",
    roomType: "audio",
    translationEnabled: true,
    startedAt: "2026-01-01T10:00:00Z",
    endedAt: "2026-01-01T10:02:00Z",
    durationSeconds: 120,
    participants: [
      {
        userId: "user-host",
        displayName: "Host User",
        trancallId: "@hostuser",
        avatarUrl: null,
        isHost: true,
      },
      {
        userId: "user-abc",
        displayName: "Test User",
        trancallId: "@testuser",
        avatarUrl: null,
        isHost: false,
      },
    ],
    myRole: "host",
    costYen: 96,
    hasTranscript: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRecentCallsStore", () => {
  beforeEach(() => {
    useRecentCallsStore.setState({
      recentCalls: [],
      nextCursor: null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // refresh()
  // -------------------------------------------------------------------------
  describe("refresh()", () => {
    it("sets recentCalls from server response", async () => {
      const entry = makeHistoryEntry();
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: { rooms: [entry], nextCursor: null },
      });

      await useRecentCallsStore.getState().refresh();

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(1);
      expect(state.recentCalls[0]?.id).toBe("room-1");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("stores nextCursor when server provides one", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry()],
          nextCursor: "2026-01-01T09:00:00Z",
        },
      });

      await useRecentCallsStore.getState().refresh();

      expect(useRecentCallsStore.getState().nextCursor).toBe("2026-01-01T09:00:00Z");
    });

    it("replaces existing calls on subsequent refresh", async () => {
      useRecentCallsStore.setState({
        recentCalls: [makeCall({ id: "old-call" })],
        nextCursor: null,
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });

      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry({ roomId: "new-room" })],
          nextCursor: null,
        },
      });

      await useRecentCallsStore.getState().refresh();

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(1);
      expect(state.recentCalls[0]?.id).toBe("new-room");
    });

    it("sets error and keeps isLoading=false on failure", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "Network fail", retryable: true },
      });

      await useRecentCallsStore.getState().refresh();

      const state = useRecentCallsStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Network fail");
      expect(state.recentCalls).toHaveLength(0);
    });

    it("clears calls when no session", async () => {
      const { useAuthStore } = await import("../src/stores/auth-store.js");
      vi.mocked(useAuthStore.getState).mockReturnValueOnce({ session: null } as ReturnType<typeof useAuthStore.getState>);

      await useRecentCallsStore.getState().refresh();

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(0);
      expect(mockGetRoomHistory).not.toHaveBeenCalled();
    });

    it("maps host to outbound direction", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry({ myRole: "host" })],
          nextCursor: null,
        },
      });

      await useRecentCallsStore.getState().refresh();

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("outbound");
    });

    it("maps member to inbound direction", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry({ myRole: "member" })],
          nextCursor: null,
        },
      });

      await useRecentCallsStore.getState().refresh();

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("inbound");
    });

    it("marks durationSeconds=0 as missed", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry({ durationSeconds: 0 })],
          nextCursor: null,
        },
      });

      await useRecentCallsStore.getState().refresh();

      expect(useRecentCallsStore.getState().recentCalls[0]?.missed).toBe(true);
    });

    it("calls getRoomHistory with limit=20 and no before param on initial load", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: { rooms: [], nextCursor: null },
      });

      await useRecentCallsStore.getState().refresh();

      expect(mockGetRoomHistory).toHaveBeenCalledWith(
        { limit: 20 },
        "test-token",
      );
    });
  });

  // -------------------------------------------------------------------------
  // load() — backward-compat alias for refresh
  // -------------------------------------------------------------------------
  describe("load()", () => {
    it("delegates to refresh", async () => {
      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: { rooms: [], nextCursor: null },
      });

      await useRecentCallsStore.getState().load();

      expect(mockGetRoomHistory).toHaveBeenCalledTimes(1);
      expect(useRecentCallsStore.getState().isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // loadMore()
  // -------------------------------------------------------------------------
  describe("loadMore()", () => {
    it("appends entries when nextCursor is set", async () => {
      // Start state: one entry already loaded, cursor available
      useRecentCallsStore.setState({
        recentCalls: [makeCall({ id: "page1-room" })],
        nextCursor: "2026-01-01T09:00:00Z",
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });

      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: {
          rooms: [makeHistoryEntry({ roomId: "page2-room" })],
          nextCursor: null,
        },
      });

      await useRecentCallsStore.getState().loadMore();

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(2);
      expect(state.recentCalls[0]?.id).toBe("page1-room");
      expect(state.recentCalls[1]?.id).toBe("page2-room");
      expect(state.nextCursor).toBeNull();
    });

    it("passes before cursor param to getRoomHistory", async () => {
      useRecentCallsStore.setState({
        recentCalls: [],
        nextCursor: "2026-01-01T09:00:00Z",
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });

      mockGetRoomHistory.mockResolvedValue({
        ok: true,
        data: { rooms: [], nextCursor: null },
      });

      await useRecentCallsStore.getState().loadMore();

      expect(mockGetRoomHistory).toHaveBeenCalledWith(
        { limit: 20, before: "2026-01-01T09:00:00Z" },
        "test-token",
      );
    });

    it("does nothing when nextCursor is null", async () => {
      useRecentCallsStore.setState({
        recentCalls: [],
        nextCursor: null,
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });

      await useRecentCallsStore.getState().loadMore();

      expect(mockGetRoomHistory).not.toHaveBeenCalled();
    });

    it("does nothing when already loading more", async () => {
      useRecentCallsStore.setState({
        recentCalls: [],
        nextCursor: "2026-01-01T09:00:00Z",
        isLoading: false,
        isLoadingMore: true,
        error: null,
      });

      await useRecentCallsStore.getState().loadMore();

      expect(mockGetRoomHistory).not.toHaveBeenCalled();
    });

    it("sets error on API failure", async () => {
      useRecentCallsStore.setState({
        recentCalls: [],
        nextCursor: "2026-01-01T09:00:00Z",
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });

      mockGetRoomHistory.mockResolvedValue({
        ok: false,
        error: { code: "NETWORK_ERROR", message: "Network fail", retryable: true },
      });

      await useRecentCallsStore.getState().loadMore();

      expect(useRecentCallsStore.getState().isLoadingMore).toBe(false);
      expect(useRecentCallsStore.getState().error).toBe("Network fail");
    });
  });

  // -------------------------------------------------------------------------
  // addCall()
  // -------------------------------------------------------------------------
  describe("addCall()", () => {
    it("adds a call entry to the front of the list", () => {
      const call = makeCall();
      useRecentCallsStore.getState().addCall(call);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(1);
      expect(state.recentCalls[0]?.id).toBe("call-1");
    });

    it("prepends newest call to existing list", () => {
      const call1 = makeCall({ id: "call-1", startedAt: "2026-01-01T10:00:00Z" });
      const call2 = makeCall({ id: "call-2", startedAt: "2026-01-01T11:00:00Z" });
      useRecentCallsStore.getState().addCall(call1);
      useRecentCallsStore.getState().addCall(call2);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls[0]?.id).toBe("call-2");
      expect(state.recentCalls[1]?.id).toBe("call-1");
    });

    it("limits stored calls to 100", () => {
      for (let i = 0; i < 105; i++) {
        useRecentCallsStore.getState().addCall(makeCall({ id: `call-${String(i)}` }));
      }

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(100);
    });

    it("stores missed calls correctly", () => {
      const missedCall = makeCall({ missed: true, durationSeconds: 0, costYen: 0 });
      useRecentCallsStore.getState().addCall(missedCall);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls[0]?.missed).toBe(true);
      expect(state.recentCalls[0]?.durationSeconds).toBe(0);
    });

    it("stores inbound calls correctly", () => {
      const inboundCall = makeCall({ direction: "inbound" });
      useRecentCallsStore.getState().addCall(inboundCall);

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("inbound");
    });

    it("stores outbound calls correctly", () => {
      const outboundCall = makeCall({ direction: "outbound" });
      useRecentCallsStore.getState().addCall(outboundCall);

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("outbound");
    });

    it("stores translation metadata", () => {
      const translatedCall = makeCall({
        translationEnabled: true,
        fromLanguage: "ja",
        toLanguage: "en",
      });
      useRecentCallsStore.getState().addCall(translatedCall);

      const stored = useRecentCallsStore.getState().recentCalls[0];
      expect(stored?.translationEnabled).toBe(true);
      expect(stored?.fromLanguage).toBe("ja");
      expect(stored?.toLanguage).toBe("en");
    });

    it("stores calls without translation correctly", () => {
      const noTranslationCall = makeCall({
        translationEnabled: false,
        fromLanguage: undefined,
        toLanguage: undefined,
      });
      useRecentCallsStore.getState().addCall(noTranslationCall);

      const stored = useRecentCallsStore.getState().recentCalls[0];
      expect(stored?.translationEnabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clearAll()
  // -------------------------------------------------------------------------
  describe("clearAll()", () => {
    it("removes all call entries and resets cursor", () => {
      useRecentCallsStore.getState().addCall(makeCall({ id: "call-1" }));
      useRecentCallsStore.getState().addCall(makeCall({ id: "call-2" }));
      useRecentCallsStore.setState({ nextCursor: "some-cursor" });

      useRecentCallsStore.getState().clearAll();

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(0);
      expect(state.nextCursor).toBeNull();
    });

    it("can add calls again after clearing", () => {
      useRecentCallsStore.getState().addCall(makeCall());
      useRecentCallsStore.getState().clearAll();
      useRecentCallsStore.getState().addCall(makeCall({ id: "new-call" }));

      expect(useRecentCallsStore.getState().recentCalls).toHaveLength(1);
    });
  });
});
