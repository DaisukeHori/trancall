import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { apiFetch } from "../src/api/client.js";

// Mock global fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

const TestSchema = z.object({
  id: z.string(),
  name: z.string(),
});

type TestItem = z.infer<typeof TestSchema>;

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("apiFetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns ok result with parsed data on 200", async () => {
    const payload = { id: "abc", name: "Test" };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(payload));

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("abc");
      expect(result.data.name).toBe("Test");
    }
  });

  it("returns NETWORK_ERROR when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network unavailable"));

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("returns VALIDATION_ERROR when response shape is wrong", async () => {
    // Missing 'name' field
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: "abc" }));

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns server error code on HTTP 4xx", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ code: "AUTH_INVALID_CREDENTIALS", message: "Bad creds" }, 401),
    );

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      expect(result.error.httpStatus).toBe(401);
    }
  });

  it("attaches Authorization header when accessToken is provided", async () => {
    const payload = { id: "x", name: "y" };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(payload));

    await apiFetch("/test", TestSchema, { accessToken: "tok123" });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/test",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      }),
    );
  });

  it("returns INTERNAL_ERROR when response JSON is invalid", async () => {
    const badResponse: Response = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Bad JSON")),
    } as unknown as Response;
    mockFetch.mockResolvedValueOnce(badResponse);

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("sends POST with JSON body", async () => {
    const payload = { id: "new", name: "Created" };
    mockFetch.mockResolvedValueOnce(makeJsonResponse(payload, 201));

    await apiFetch("/test", TestSchema, {
      method: "POST",
      body: { foo: "bar" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
      }),
    );
  });

  it("marks 5xx errors as retryable", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ code: "INTERNAL_ERROR", message: "Server error" }, 503),
    );

    const result = await apiFetch("/test", TestSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });
});
