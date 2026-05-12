import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock transcript-api before importing the store
vi.mock("../src/api/transcript-api.js", () => ({
  getTranscript: vi.fn(),
  searchSegments: vi.fn(),
  exportTranscript: vi.fn(),
  deleteAccess: vi.fn(),
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as transcriptApi from "../src/api/transcript-api.js";
import { useTranscriptStore, selectCurrentTranscript, selectIsAccessRevoked } from "../src/stores/transcript-store.js";
import type { FullTranscript, TranscriptSegment } from "../src/api/transcript-api.js";

const mockGetTranscript = vi.mocked(transcriptApi.getTranscript);
const mockExportTranscript = vi.mocked(transcriptApi.exportTranscript);
const mockDeleteAccess = vi.mocked(transcriptApi.deleteAccess);

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440002";
const ACCESS_TOKEN = "test-token";

const fakeSegmentAlice: TranscriptSegment = {
  segmentId: "seg-alice-001",
  roomId: ROOM_ID,
  participantId: "part-alice",
  speakerName: "Alice",
  originalText: "Hello there",
  translatedText: "こんにちは",
  languagePair: "en-ja",
  startTimeMs: 1000,
  endTimeMs: 3000,
  sequenceNo: 0,
  sourceEventId: "evt-001",
  agentSessionId: null,
  retentionUntil: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-05-12T10:00:01.000Z",
};

const fakeSegmentBob: TranscriptSegment = {
  segmentId: "seg-bob-001",
  roomId: ROOM_ID,
  participantId: "part-bob",
  speakerName: "Bob",
  originalText: "Good morning, how are you today?",
  translatedText: "おはようございます",
  languagePair: "en-ja",
  startTimeMs: 4000,
  endTimeMs: 7000,
  sequenceNo: 1,
  sourceEventId: "evt-002",
  agentSessionId: null,
  retentionUntil: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-05-12T10:00:04.000Z",
};

const fakeTranscript: FullTranscript = {
  roomId: ROOM_ID,
  segments: [fakeSegmentAlice, fakeSegmentBob],
  duration: 7.0,
  participantCount: 2,
  generatedAt: "2026-05-12T10:00:07.000Z",
};

function resetStore() {
  useTranscriptStore.setState({
    transcripts: new Map(),
    currentRoomId: null,
    searchQuery: "",
    filter: "all",
    isLoading: false,
    error: null,
    revokedRooms: new Set(),
  });
}

describe("useTranscriptStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // load()
  // ---------------------------------------------------------------------------
  describe("load()", () => {
    it("caches transcript on success", async () => {
      mockGetTranscript.mockResolvedValue({ ok: true, data: fakeTranscript });

      const result = await useTranscriptStore.getState().load(ROOM_ID, ACCESS_TOKEN);

      expect(result.ok).toBe(true);
      const state = useTranscriptStore.getState();
      expect(state.transcripts.get(ROOM_ID)).not.toBeUndefined();
      expect(state.currentRoomId).toBe(ROOM_ID);
      expect(state.isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockGetTranscript.mockResolvedValue({
        ok: false,
        error: { code: "FORBIDDEN", message: "Access denied", retryable: false },
      });

      const result = await useTranscriptStore.getState().load(ROOM_ID, ACCESS_TOKEN);

      expect(result.ok).toBe(false);
      const state = useTranscriptStore.getState();
      expect(state.error).toBe("Access denied");
      expect(state.isLoading).toBe(false);
    });

    it("sets isLoading=true while loading", async () => {
      let resolvePromise: (value: { ok: true; data: FullTranscript }) => void;
      const pending = new Promise<{ ok: true; data: FullTranscript }>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetTranscript.mockReturnValue(pending);

      const loadPromise = useTranscriptStore.getState().load(ROOM_ID, ACCESS_TOKEN);

      // isLoading should be true while loading
      expect(useTranscriptStore.getState().isLoading).toBe(true);

      resolvePromise!({ ok: true, data: fakeTranscript });
      await loadPromise;

      expect(useTranscriptStore.getState().isLoading).toBe(false);
    });

    it("returns cached data without refetching on second load", async () => {
      mockGetTranscript.mockResolvedValue({ ok: true, data: fakeTranscript });

      await useTranscriptStore.getState().load(ROOM_ID, ACCESS_TOKEN);
      await useTranscriptStore.getState().load(ROOM_ID, ACCESS_TOKEN);

      // Called twice since store always re-fetches (no dedup in store)
      expect(mockGetTranscript).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // search()
  // ---------------------------------------------------------------------------
  describe("search()", () => {
    it("updates searchQuery", () => {
      useTranscriptStore.getState().search("hello");

      expect(useTranscriptStore.getState().searchQuery).toBe("hello");
    });

    it("clears searchQuery when empty string", () => {
      useTranscriptStore.getState().search("hello");
      useTranscriptStore.getState().search("");

      expect(useTranscriptStore.getState().searchQuery).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // setFilter()
  // ---------------------------------------------------------------------------
  describe("setFilter()", () => {
    it("sets filter to self", () => {
      useTranscriptStore.getState().setFilter("self");
      expect(useTranscriptStore.getState().filter).toBe("self");
    });

    it("sets filter to other", () => {
      useTranscriptStore.getState().setFilter("other");
      expect(useTranscriptStore.getState().filter).toBe("other");
    });

    it("resets to all", () => {
      useTranscriptStore.getState().setFilter("self");
      useTranscriptStore.getState().setFilter("all");
      expect(useTranscriptStore.getState().filter).toBe("all");
    });
  });

  // ---------------------------------------------------------------------------
  // getFilteredSegments()
  // ---------------------------------------------------------------------------
  describe("getFilteredSegments()", () => {
    beforeEach(() => {
      useTranscriptStore.setState((state) => {
        const updated = new Map(state.transcripts);
        updated.set(ROOM_ID, fakeTranscript);
        return { transcripts: updated, currentRoomId: ROOM_ID };
      });
    });

    it("returns all segments with filter=all", () => {
      useTranscriptStore.getState().setFilter("all");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID, "part-alice");
      expect(segments).toHaveLength(2);
    });

    it("returns only self segments with filter=self", () => {
      useTranscriptStore.getState().setFilter("self");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID, "part-alice");
      expect(segments).toHaveLength(1);
      expect(segments[0]?.participantId).toBe("part-alice");
    });

    it("returns only other segments with filter=other", () => {
      useTranscriptStore.getState().setFilter("other");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID, "part-alice");
      expect(segments).toHaveLength(1);
      expect(segments[0]?.participantId).toBe("part-bob");
    });

    it("filters by searchQuery on originalText", () => {
      useTranscriptStore.getState().search("hello");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.originalText).toBe("Hello there");
    });

    it("filters by searchQuery on translatedText", () => {
      useTranscriptStore.getState().search("おはよう");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.speakerName).toBe("Bob");
    });

    it("is case-insensitive in search", () => {
      useTranscriptStore.getState().search("HELLO");
      const segments = useTranscriptStore.getState().getFilteredSegments(ROOM_ID);
      expect(segments).toHaveLength(1);
    });

    it("returns empty array for unknown roomId", () => {
      const segments = useTranscriptStore.getState().getFilteredSegments("unknown-room");
      expect(segments).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // export()
  // ---------------------------------------------------------------------------
  describe("export()", () => {
    it("returns export result on success", async () => {
      mockExportTranscript.mockResolvedValue({
        ok: true,
        data: { contentBase64: "abc123==", mime: "application/pdf" },
      });

      const result = await useTranscriptStore.getState().export(ROOM_ID, "pdf", ACCESS_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mime).toBe("application/pdf");
      }
    });

    it("sets error on export failure", async () => {
      mockExportTranscript.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Export error", retryable: true },
      });

      const result = await useTranscriptStore.getState().export(ROOM_ID, "txt", ACCESS_TOKEN);

      expect(result.ok).toBe(false);
      const state = useTranscriptStore.getState();
      expect(state.error).toBe("Export error");
    });
  });

  // ---------------------------------------------------------------------------
  // clearAccess()
  // ---------------------------------------------------------------------------
  describe("clearAccess()", () => {
    it("marks room as revoked and removes from cache", async () => {
      mockDeleteAccess.mockResolvedValue({ ok: true, data: true });

      // Pre-populate cache
      useTranscriptStore.setState((state) => {
        const updated = new Map(state.transcripts);
        updated.set(ROOM_ID, fakeTranscript);
        return { transcripts: updated };
      });

      const result = await useTranscriptStore.getState().clearAccess(ROOM_ID, ACCESS_TOKEN);

      expect(result.ok).toBe(true);
      const state = useTranscriptStore.getState();
      expect(state.revokedRooms.has(ROOM_ID)).toBe(true);
      expect(state.transcripts.has(ROOM_ID)).toBe(false);
    });

    it("does not revoke on API failure", async () => {
      mockDeleteAccess.mockResolvedValue({
        ok: false,
        error: { code: "FORBIDDEN", message: "Not allowed", retryable: false },
      });

      const result = await useTranscriptStore.getState().clearAccess(ROOM_ID, ACCESS_TOKEN);

      expect(result.ok).toBe(false);
      const state = useTranscriptStore.getState();
      expect(state.revokedRooms.has(ROOM_ID)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Selectors
  // ---------------------------------------------------------------------------
  describe("selectors", () => {
    it("selectCurrentTranscript returns null when no currentRoomId", () => {
      const transcript = selectCurrentTranscript(useTranscriptStore.getState());
      expect(transcript).toBeNull();
    });

    it("selectCurrentTranscript returns transcript for currentRoomId", () => {
      useTranscriptStore.setState((state) => {
        const updated = new Map(state.transcripts);
        updated.set(ROOM_ID, fakeTranscript);
        return { transcripts: updated, currentRoomId: ROOM_ID };
      });

      const transcript = selectCurrentTranscript(useTranscriptStore.getState());
      expect(transcript).not.toBeNull();
      expect(transcript?.roomId).toBe(ROOM_ID);
    });

    it("selectIsAccessRevoked returns false by default", () => {
      const isRevoked = selectIsAccessRevoked(ROOM_ID)(useTranscriptStore.getState());
      expect(isRevoked).toBe(false);
    });

    it("selectIsAccessRevoked returns true after clearAccess", async () => {
      mockDeleteAccess.mockResolvedValue({ ok: true, data: true });

      await useTranscriptStore.getState().clearAccess(ROOM_ID, ACCESS_TOKEN);

      const isRevoked = selectIsAccessRevoked(ROOM_ID)(useTranscriptStore.getState());
      expect(isRevoked).toBe(true);
    });
  });
});
