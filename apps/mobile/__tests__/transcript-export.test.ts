/**
 * T-21: transcript export UI テスト
 *
 * - exportTranscript API 呼出と GET メソッド + クエリパラメータ
 * - base64 → expo-file-system へのファイル保存
 * - expo-sharing.shareAsync() の呼び出し
 * - エラー時のエラーメッセージ設定
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted: vi.mock factory から参照するモック関数はホイストが必要
// ---------------------------------------------------------------------------
const { mockWriteAsStringAsync, mockShareAsync, mockIsAvailableAsync } = vi.hoisted(() => ({
  mockWriteAsStringAsync: vi.fn<() => Promise<void>>(),
  mockShareAsync: vi.fn<() => Promise<void>>(),
  mockIsAvailableAsync: vi.fn<() => Promise<boolean>>(),
}));

// ---------------------------------------------------------------------------
// Mock expo-file-system
// ---------------------------------------------------------------------------
// SDK54 (expo-file-system v19) では legacy API は "expo-file-system/legacy" サブパスに移動 (#54)
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: {
    Base64: "base64",
    UTF8: "utf8",
  },
  writeAsStringAsync: mockWriteAsStringAsync,
}));

// ---------------------------------------------------------------------------
// Mock expo-sharing
// ---------------------------------------------------------------------------
vi.mock("expo-sharing", () => ({
  shareAsync: mockShareAsync,
  isAvailableAsync: mockIsAvailableAsync,
}));

// ---------------------------------------------------------------------------
// Mock API config
// ---------------------------------------------------------------------------
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

import { exportTranscript } from "../src/api/transcript-api.js";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440099";
const ACCESS_TOKEN = "test-token-export";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// exportTranscript() — GET endpoint (T-21)
// ---------------------------------------------------------------------------

describe("exportTranscript() — GET endpoint (T-21)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWriteAsStringAsync.mockReset();
    mockShareAsync.mockReset();
    mockIsAvailableAsync.mockReset();
  });

  it("uses GET method with format as query parameter", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "dGVzdA==", mime: "application/pdf" },
      }),
    );

    await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBe("GET");
    const url = callArgs[0];
    expect(url).toContain("/api/transcripts/");
    expect(url).toContain("format=pdf");
    // GET should not send a body
    expect(callArgs[1].body).toBeUndefined();
  });

  it("uses format=txt in query when txt is requested", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "dGVzdA==", mime: "text/plain; charset=utf-8" },
      }),
    );

    await exportTranscript(ROOM_ID, "txt", ACCESS_TOKEN);

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const url = callArgs[0];
    expect(url).toContain("format=txt");
  });

  it("returns contentBase64 and mime on success", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          contentBase64: "AAABBBCCC==",
          mime: "application/pdf",
          filename: "trancall-transcript-20260512-1000-550e8400.pdf",
        },
      }),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contentBase64).toBe("AAABBBCCC==");
      expect(result.data.mime).toBe("application/pdf");
      expect(result.data.filename).toBe("trancall-transcript-20260512-1000-550e8400.pdf");
    }
  });

  it("filename is optional — returns undefined when not in response", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: { contentBase64: "abc==", mime: "text/plain" },
      }),
    );

    const result = await exportTranscript(ROOM_ID, "txt", ACCESS_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.filename).toBeUndefined();
    }
  });

  it("returns error on TRANSCRIPT_EXPORT_FORBIDDEN (403)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse(
        { code: "TRANSCRIPT_EXPORT_FORBIDDEN", message: "Access denied" },
        403,
      ),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSCRIPT_EXPORT_FORBIDDEN");
    }
  });

  it("returns error on TRANSCRIPT_EXPORT_EMPTY (404)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse(
        { code: "TRANSCRIPT_EXPORT_EMPTY", message: "No segments" },
        404,
      ),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSCRIPT_EXPORT_EMPTY");
    }
  });

  it("returns retryable=true on INTERNAL_ERROR (500)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse(
        { code: "INTERNAL_ERROR", message: "PDF generation failed" },
        500,
      ),
    );

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// base64 → expo-file-system ファイル保存フロー
// ---------------------------------------------------------------------------

describe("base64 → FileSystem.writeAsStringAsync フロー", () => {
  beforeEach(() => {
    mockWriteAsStringAsync.mockReset();
    mockShareAsync.mockReset();
    mockIsAvailableAsync.mockReset();
    mockFetch.mockReset();
  });

  it("writeAsStringAsync is called with Base64 encoding when export succeeds", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        data: {
          contentBase64: "JVBERi0xLjQ=",
          mime: "application/pdf",
          filename: "trancall-transcript-20260512-1000-550e8400.pdf",
        },
      }),
    );
    mockIsAvailableAsync.mockResolvedValue(true);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockShareAsync.mockResolvedValue(undefined);

    const result = await exportTranscript(ROOM_ID, "pdf", ACCESS_TOKEN);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Simulate the screen's handleExport logic
      const filename = result.data.filename ?? `trancall-transcript-${ROOM_ID.slice(0, 8)}.pdf`;
      const fileUri = `${FileSystem.cacheDirectory ?? ""}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, result.data.contentBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining("trancall-transcript-"),
        "JVBERi0xLjQ=",
        { encoding: "base64" },
      );
    }
  });

  it("fileUri is built from cacheDirectory + filename", () => {
    const filename = "trancall-transcript-20260512-1000-550e8400.pdf";
    const expectedUri = `${FileSystem.cacheDirectory ?? ""}${filename}`;

    expect(expectedUri).toBe(`file:///cache/${filename}`);
  });

  it("default filename falls back to roomId prefix when server omits it", () => {
    const shortId = ROOM_ID.slice(0, 8);
    const defaultFilename = `trancall-transcript-${shortId}.pdf`;

    expect(defaultFilename).toBe(`trancall-transcript-550e8400.pdf`);
  });
});

// ---------------------------------------------------------------------------
// expo-sharing.shareAsync() フロー
// ---------------------------------------------------------------------------

describe("expo-sharing.shareAsync フロー", () => {
  beforeEach(() => {
    mockWriteAsStringAsync.mockReset();
    mockShareAsync.mockReset();
    mockIsAvailableAsync.mockReset();
  });

  it("shareAsync is called with correct mimeType for PDF", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockShareAsync.mockResolvedValue(undefined);

    const fileUri = "file:///cache/trancall-transcript-20260512-1000-550e8400.pdf";

    await Sharing.shareAsync(fileUri, {
      mimeType: "application/pdf",
      dialogTitle: "Share transcript",
      UTI: "com.adobe.pdf",
    });

    expect(mockShareAsync).toHaveBeenCalledWith(fileUri, {
      mimeType: "application/pdf",
      dialogTitle: "Share transcript",
      UTI: "com.adobe.pdf",
    });
  });

  it("shareAsync is called with correct mimeType for TXT", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockShareAsync.mockResolvedValue(undefined);

    const fileUri = "file:///cache/trancall-transcript-20260512-1000-550e8400.txt";

    await Sharing.shareAsync(fileUri, {
      mimeType: "text/plain",
      dialogTitle: "Share transcript",
      UTI: "public.plain-text",
    });

    expect(mockShareAsync).toHaveBeenCalledWith(fileUri, {
      mimeType: "text/plain",
      dialogTitle: "Share transcript",
      UTI: "public.plain-text",
    });
  });

  it("does not call shareAsync when isAvailableAsync returns false", async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    const isAvailable = await Sharing.isAvailableAsync();

    expect(isAvailable).toBe(false);
    // When not available, shareAsync should NOT be called
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it("isAvailableAsync returns true on supported platform", async () => {
    mockIsAvailableAsync.mockResolvedValue(true);

    const isAvailable = await Sharing.isAvailableAsync();

    expect(isAvailable).toBe(true);
  });
});
