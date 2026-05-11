import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

// Mock global fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

import {
  getTranscript,
  searchSegments,
  exportTranscript,
  deleteAccess,
} from "../src/api/transcript-api.js";

const ACCESS_TOKEN = "test-access-token";
const ROOM_ID = "550e8400-e29b-41d4-a716-446655440001";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fakeSegment = {
  segmentId: "seg-001",
  roomId: ROOM_ID,
  participantId: "part-001",
  speakerName: "Alice",
  originalText: "Hello, how are you?",
  translatedText: "こんにちは、お元気ですか？",
  languagePair: "en-ja",
  startTimeMs: 1000,
  endTimeMs: 4000,
  sequenceNo: 0,
  sourceEventId: "evt-001",
  agentSessionId: null,
  retentionUntil: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-05-12T10:00:00.000Z",
};

const fakeTranscript = {
  roomId: ROOM_ID,
  segments: [fakeSegment],
  duration: 4.0,
  participantCount: 2,
  generatedAt: "2026-05-12T10:00:04.000Z",
};

describe("getTranscript()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns FullTranscript on 200", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: fakeTranscript }),
    );

    const result = await getTranscript(ROOM_ID, ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.roomId).toBe(ROOM_ID);
      expect(result.data.segments).toHaveLength(1);
      expect(result.data.segments[0]?.speakerName).toBe("Alice");
    }
  });

  it("calls the correct endpoint URL", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: fakeTranscript }),
    );

    await getTranscript(ROOM_ID, ACCESS_TOKEN);

    const calledUrl = String((mockFetch.mock.calls[0] as [string])[0]);
    expect(calledUrl).toContain(`/api/transcripts/${ROOM_ID}`);
  });

  it("returns NETWORK_ERROR when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await getTranscript(ROOM_ID, ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("returns error on 403 Forbidden", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ code: "FORBIDDEN", message: "Access denied" }, 403),
    );

    const result = await getTranscript(ROOM_ID, ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });
});

describe("searchSegments()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns matching segments on 200", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: [fakeSegment] }),
    );

    const result = await searchSegments(ROOM_ID, "Hello", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.originalText).toBe("Hello, how are you?");
    }
  });

  it("URL-encodes the search query", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: [] }),
    );

    await searchSegments(ROOM_ID, "hello world", ACCESS_TOKEN);

    const calledUrl = String((mockFetch.mock.calls[0] as [string])[0]);
    expect(calledUrl).toContain("q=hello%20world");
  });

  it("returns empty array when no matches", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: [] }),
    );

    const result = await searchSegments(ROOM_ID, "xyz-no-match", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(0);
    }
  });
});

describe("exportTranscript()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns base64 content for PDF format", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "base64data==", mime: "application/pdf" },
      }),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mime).toBe("application/pdf");
      expect(result.data.contentBase64).toBe("base64data==");
    }
  });

  it("returns base64 content for TXT format", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "dGV4dA==", mime: "text/plain" },
      }),
    );

    const result = await exportTranscript(ROOM_ID, "txt", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mime).toBe("text/plain");
    }
  });

  it("sends POST with correct format body", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "abc", mime: "text/plain" },
      }),
    );

    await exportTranscript(ROOM_ID, "txt", ACCESS_TOKEN);

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBe("POST");
    expect(JSON.parse(callArgs[1].body as string)).toEqual({ format: "txt" });
  });

  it("returns error on server failure", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ code: "INTERNAL_ERROR", message: "Export failed" }, 500),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe("deleteAccess()", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns true on successful deletion", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: true }),
    );

    const result = await deleteAccess(ROOM_ID, ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });

  it("calls DELETE method on the correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ ok: true, data: true }),
    );

    await deleteAccess(ROOM_ID, ACCESS_TOKEN);

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBe("DELETE");
    const calledUrl = callArgs[0];
    expect(calledUrl).toContain(`/api/transcripts/${ROOM_ID}`);
  });

  it("returns error on 404 Not Found", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ code: "NOT_FOUND", message: "Not found" }, 404),
    );

    const result = await deleteAccess(ROOM_ID, ACCESS_TOKEN);

    expect(result.ok).toBe(false);
  });
});
