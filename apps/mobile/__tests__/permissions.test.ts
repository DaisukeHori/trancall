/**
 * permissions.test.ts
 *
 * #32: lib/permissions (expo-audio マイク権限 / expo-notifications 通知権限) のテスト。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetRecordingPermissionsAsync,
  mockRequestRecordingPermissionsAsync,
  mockGetNotifPermissionsAsync,
  mockRequestNotifPermissionsAsync,
} = vi.hoisted(() => ({
  mockGetRecordingPermissionsAsync: vi.fn(),
  mockRequestRecordingPermissionsAsync: vi.fn(),
  mockGetNotifPermissionsAsync: vi.fn(),
  mockRequestNotifPermissionsAsync: vi.fn(),
}));

vi.mock("expo-audio", () => ({
  getRecordingPermissionsAsync: mockGetRecordingPermissionsAsync,
  requestRecordingPermissionsAsync: mockRequestRecordingPermissionsAsync,
}));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mockGetNotifPermissionsAsync,
  requestPermissionsAsync: mockRequestNotifPermissionsAsync,
}));

import { ensureMicrophonePermission, ensureNotificationPermission } from "../src/lib/permissions/index.js";

describe("ensureMicrophonePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("既に granted なら request を呼ばず true を返す", async () => {
    mockGetRecordingPermissionsAsync.mockResolvedValue({ granted: true });

    const result = await ensureMicrophonePermission();

    expect(result).toBe(true);
    expect(mockRequestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it("未許可なら request を呼び、結果を返す (許可)", async () => {
    mockGetRecordingPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true });

    const result = await ensureMicrophonePermission();

    expect(result).toBe(true);
    expect(mockRequestRecordingPermissionsAsync).toHaveBeenCalledOnce();
  });

  it("request も拒否されたら false を返す", async () => {
    mockGetRecordingPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: false });

    const result = await ensureMicrophonePermission();

    expect(result).toBe(false);
  });

  it("native call が reject しても false を返す (crash しない)", async () => {
    mockGetRecordingPermissionsAsync.mockRejectedValue(new Error("native module not linked"));

    const result = await ensureMicrophonePermission();

    expect(result).toBe(false);
  });
});

describe("ensureNotificationPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("既に granted なら request を呼ばず true を返す", async () => {
    mockGetNotifPermissionsAsync.mockResolvedValue({ granted: true });

    const result = await ensureNotificationPermission();

    expect(result).toBe(true);
    expect(mockRequestNotifPermissionsAsync).not.toHaveBeenCalled();
  });

  it("未許可なら request を呼び、結果を返す", async () => {
    mockGetNotifPermissionsAsync.mockResolvedValue({ granted: false });
    mockRequestNotifPermissionsAsync.mockResolvedValue({ granted: true });

    const result = await ensureNotificationPermission();

    expect(result).toBe(true);
    expect(mockRequestNotifPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  });

  it("native call が reject しても false を返す (crash しない)", async () => {
    mockGetNotifPermissionsAsync.mockRejectedValue(new Error("native module not linked"));

    const result = await ensureNotificationPermission();

    expect(result).toBe(false);
  });
});
