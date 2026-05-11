/**
 * device-token-service テスト
 *
 * - register: 正常登録
 * - register: 同一トークンの upsert (UNIQUE 上書き)
 * - register: 不正 token (バリデーション失敗)
 */

import { describe, it, expect, vi } from "vitest";

import { createDeviceTokenService } from "../src/services/device-token-service.js";
import type { DeviceTokenRepository } from "../src/repositories/device-token-repository.js";
import type { DeviceTokenRow } from "../src/schemas.js";
import { UserIdSchema, RoomIdSchema } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

const userId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");

// in-memory DeviceTokenRepository モック
function makeRow(token: string): DeviceTokenRow {
  return {
    id: "550e8400-e29b-41d4-a716-446655440099",
    userId,
    platform: "ios",
    token,
    bundleId: "com.trancall.app",
    isActive: true,
    lastSeenAt: "2026-05-11T10:00:00Z",
    revokedAt: null,
    createdAt: "2026-05-11T10:00:00Z",
  };
}

function makeRepo(overrides?: Partial<DeviceTokenRepository>): DeviceTokenRepository {
  return {
    upsert: vi.fn().mockResolvedValue(ok(makeRow("device-token-abc"))),
    findActiveByUserId: vi.fn().mockResolvedValue(ok([])),
    revoke: vi.fn().mockResolvedValue(ok(true as const)),
    delete: vi.fn().mockResolvedValue(ok(true as const)),
    ...overrides,
  };
}

describe("DeviceTokenService.register", () => {
  it("正常な iOS トークンを登録できる", async () => {
    const repo = makeRepo();
    const service = createDeviceTokenService(repo);

    const result = await service.register(userId, {
      platform: "ios",
      voipToken: "valid-voip-token",
      bundleId: "com.trancall.app",
    });

    expect(result.ok).toBe(true);
    expect(repo.upsert).toHaveBeenCalledOnce();
  });

  it("正常な Android トークンを登録できる", async () => {
    const repo = makeRepo({
      upsert: vi.fn().mockResolvedValue(ok({
        ...makeRow("fcm-token-xyz"),
        platform: "android" as const,
        bundleId: null,
      })),
    });
    const service = createDeviceTokenService(repo);

    const result = await service.register(userId, {
      platform: "android",
      fcmToken: "fcm-token-xyz",
    });

    expect(result.ok).toBe(true);
    expect(repo.upsert).toHaveBeenCalledOnce();
  });

  it("voipToken が空文字のとき NOTIFICATION_DEVICE_TOKEN_INVALID を返す", async () => {
    const repo = makeRepo();
    const service = createDeviceTokenService(repo);

    const result = await service.register(userId, {
      platform: "ios",
      voipToken: "",  // 空文字は無効
      bundleId: "com.trancall.app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_DEVICE_TOKEN_INVALID");
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("platform が不明なとき NOTIFICATION_DEVICE_TOKEN_INVALID を返す", async () => {
    const repo = makeRepo();
    const service = createDeviceTokenService(repo);

    const result = await service.register(userId, {
      platform: "windows",  // 不正
      token: "some-token",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_DEVICE_TOKEN_INVALID");
    }
  });

  it("同じトークンの upsert では repo.upsert が呼ばれる (UNIQUE 上書き)", async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce(ok(makeRow("same-token")))
      .mockResolvedValueOnce(ok(makeRow("same-token")));
    const repo = makeRepo({ upsert });
    const service = createDeviceTokenService(repo);

    await service.register(userId, {
      platform: "ios",
      voipToken: "same-token",
      bundleId: "com.trancall.app",
    });
    await service.register(userId, {
      platform: "ios",
      voipToken: "same-token",
      bundleId: "com.trancall.app",
    });

    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

describe("DeviceTokenService.revoke", () => {
  it("revoke を呼ぶと repo.revoke が呼ばれる", async () => {
    const repo = makeRepo();
    const service = createDeviceTokenService(repo);

    const result = await service.revoke("ios", "bad-token");

    expect(result.ok).toBe(true);
    expect(repo.revoke).toHaveBeenCalledWith("ios", "bad-token");
  });
});
