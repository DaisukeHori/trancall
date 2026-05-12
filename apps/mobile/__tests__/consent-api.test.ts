/**
 * consent-api.test.ts
 *
 * consent-api.ts の単体テスト
 * - getRequiredConsents()
 * - recordConsent()
 * - revokeConsentByScope()
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-key",
}));

import {
  getRequiredConsents,
  recordConsent,
  revokeConsentByScope,
} from "../src/api/consent-api.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validConsent = {
  scope: "legal_terms",
  currentVersion: "2026-05-12",
  userVersion: null,
  isRequired: true,
  isUpToDate: false,
  documentUrl: "https://trancall.app/terms",
};

const validOptionalConsent = {
  scope: "marketing_email",
  currentVersion: "2026-05-12",
  userVersion: "2026-05-12",
  isRequired: false,
  isUpToDate: true,
  documentUrl: null,
};

describe("consent-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ──────────────────────────────────────────────
  // getRequiredConsents()
  // ──────────────────────────────────────────────

  describe("getRequiredConsents()", () => {
    it("200 で RequiredConsentView[] を返す", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ consents: [validConsent, validOptionalConsent] }),
      );

      const result = await getRequiredConsents("access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]?.scope).toBe("legal_terms");
        expect(result.data[0]?.isRequired).toBe(true);
        expect(result.data[0]?.isUpToDate).toBe(false);
        expect(result.data[1]?.scope).toBe("marketing_email");
        expect(result.data[1]?.isRequired).toBe(false);
      }
    });

    it("空配列を返す場合も ok: true", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ consents: [] }));

      const result = await getRequiredConsents("access-token");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it("Authorization ヘッダーを付与する", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ consents: [] }));

      await getRequiredConsents("my-token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/consents"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );
    });

    it("403 AUTH_CONSENT_REQUIRED を ok: false で返す", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ code: "AUTH_CONSENT_REQUIRED", message: "consent required" }, 403),
      );

      const result = await getRequiredConsents("access-token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_CONSENT_REQUIRED");
      }
    });

    it("ネットワークエラーを ok: false で返す", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      const result = await getRequiredConsents("access-token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NETWORK_ERROR");
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────
  // recordConsent()
  // ──────────────────────────────────────────────

  describe("recordConsent()", () => {
    it("POST /api/auth/consents を呼び ok: true を返す", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

      const result = await recordConsent(
        "legal_terms",
        "2026-05-12",
        "onboarding",
        "access-token",
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.ok).toBe(true);
      }
    });

    it("正しい body を送信する", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

      await recordConsent("voice_to_openai", "2026-05-12", "incoming_call_first_time", "tok");

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        scope: string;
        version: string;
        source: string;
      };
      expect(body.scope).toBe("voice_to_openai");
      expect(body.version).toBe("2026-05-12");
      expect(body.source).toBe("incoming_call_first_time");
    });

    it("409 AUTH_CONSENT_VERSION_MISMATCH を ok: false で返す", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse(
          { code: "AUTH_CONSENT_VERSION_MISMATCH", message: "version mismatch" },
          409,
        ),
      );

      const result = await recordConsent("legal_terms", "2026-05-01", "onboarding", "tok");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_CONSENT_VERSION_MISMATCH");
      }
    });
  });

  // ──────────────────────────────────────────────
  // revokeConsentByScope()
  // ──────────────────────────────────────────────

  describe("revokeConsentByScope()", () => {
    it("DELETE /api/auth/consents/:scope を呼ぶ", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

      const result = await revokeConsentByScope("transcript_retention", "tok");

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/consents/transcript_retention"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("422 AUTH_CONSENT_IRREVOCABLE を ok: false で返す", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse(
          { code: "AUTH_CONSENT_IRREVOCABLE", message: "cannot revoke" },
          422,
        ),
      );

      const result = await revokeConsentByScope("legal_terms", "tok");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AUTH_CONSENT_IRREVOCABLE");
      }
    });
  });
});
