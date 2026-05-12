import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module
vi.mock("../src/api/client.js", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

import * as clientModule from "../src/api/client.js";
import { createCall, joinCall, endCall, getRoomState } from "../src/api/room-api.js";

const mockApiFetch = vi.mocked(clientModule.apiFetch);

const fakeRoomState = {
  roomId: "room-uuid-123",
  status: "waiting",
  translationEnabled: true,
};

const fakeJoinResult = {
  token: "livekit-token-xyz",
  livekitUrl: "wss://livekit.example.com",
  roomId: "room-uuid-123",
};

const fakeEndResult = {
  roomId: "room-uuid-123",
  status: "ended",
  durationSeconds: 120,
};

const ACCESS_TOKEN = "bearer-token-test";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("room-api — createCall", () => {
  it("calls POST /api/rooms with correct body", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeRoomState });

    const result = await createCall(
      { calleeId: "callee-uuid", creatorId: "creator-uuid", translationEnabled: true },
      ACCESS_TOKEN,
    );

    expect(mockApiFetch).toHaveBeenCalledOnce();
    const [path, , options] = mockApiFetch.mock.calls[0] as [string, unknown, { method: string; accessToken: string; body: unknown }];
    expect(path).toBe("/api/rooms");
    expect(options.method).toBe("POST");
    expect(options.accessToken).toBe(ACCESS_TOKEN);
    const body = options.body as { inviteeIds: string[]; translationEnabled: boolean };
    expect(body.inviteeIds).toContain("callee-uuid");
    expect(body.translationEnabled).toBe(true);
    expect(result).toEqual({ ok: true, data: fakeRoomState });
  });

  it("returns error when apiFetch fails", async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      error: { code: "BILLING_INSUFFICIENT_BALANCE", message: "残高不足", retryable: false },
    });

    const result = await createCall(
      { calleeId: "callee-uuid", creatorId: "creator-uuid", translationEnabled: true },
      ACCESS_TOKEN,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BILLING_INSUFFICIENT_BALANCE");
    }
  });
});

describe("room-api — joinCall", () => {
  it("calls POST /api/rooms/:id/join", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeJoinResult });

    const result = await joinCall("room-uuid-123", ACCESS_TOKEN);

    const [path, , options] = mockApiFetch.mock.calls[0] as [string, unknown, { method: string }];
    expect(path).toBe("/api/rooms/room-uuid-123/join");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ ok: true, data: fakeJoinResult });
  });

  it("URL-encodes roomId", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeJoinResult });
    await joinCall("room/with spaces", ACCESS_TOKEN);
    const callArgs = mockApiFetch.mock.calls[0] as unknown as [string, unknown, unknown];
    const [path] = callArgs;
    expect(path).toBe("/api/rooms/room%2Fwith%20spaces/join");
  });
});

describe("room-api — endCall", () => {
  it("calls POST /api/rooms/:id/leave", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeEndResult });

    const result = await endCall("room-uuid-123", ACCESS_TOKEN);

    const [path, , options] = mockApiFetch.mock.calls[0] as [string, unknown, { method: string }];
    expect(path).toBe("/api/rooms/room-uuid-123/leave");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ ok: true, data: fakeEndResult });
  });

  it("returns error when room not found", async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      error: { code: "ROOM_NOT_FOUND", message: "通話が見つかりません", retryable: false },
    });

    const result = await endCall("nonexistent-room", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
    }
  });
});

describe("room-api — getRoomState", () => {
  it("calls GET /api/rooms/:id", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeRoomState });

    const result = await getRoomState("room-uuid-123", ACCESS_TOKEN);

    const [path, , options] = mockApiFetch.mock.calls[0] as [string, unknown, { method: string }];
    expect(path).toBe("/api/rooms/room-uuid-123");
    expect(options.method).toBe("GET");
    expect(result).toEqual({ ok: true, data: fakeRoomState });
  });

  it("returns error on network failure", async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      error: { code: "NETWORK_ERROR", message: "接続できません", retryable: true },
    });

    const result = await getRoomState("room-uuid-123", ACCESS_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retryable).toBe(true);
    }
  });

  it("passes access token in options", async () => {
    mockApiFetch.mockResolvedValue({ ok: true, data: fakeRoomState });

    await getRoomState("room-uuid-123", "my-token");

    const [, , options] = mockApiFetch.mock.calls[0] as [string, unknown, { accessToken: string }];
    expect(options.accessToken).toBe("my-token");
  });
});
