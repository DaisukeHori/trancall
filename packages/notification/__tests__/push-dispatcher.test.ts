/**
 * push-dispatcher テスト
 *
 * - 配信成功
 * - 失敗時 retry 3 回 + exponential backoff
 * - 最終失敗 NOTIFICATION_PUSH_DELIVERY_FAILED
 * - NOTIFICATION_DEVICE_TOKEN_INVALID 時は即時 revoke
 */

import { describe, it, expect, vi } from "vitest";

import { createPushDispatcher } from "../src/services/push-dispatcher.js";
import type { ApnsAdapter } from "../src/adapters/apns-adapter.js";
import type { FcmAdapter } from "../src/adapters/fcm-adapter.js";
import type { DeviceTokenRepository } from "../src/repositories/device-token-repository.js";
import type { PushLogRepository } from "../src/repositories/push-log-repository.js";
import type { DeviceTokenRow, IncomingCallNotification } from "../src/schemas.js";
import { UserIdSchema, RoomIdSchema } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

const userId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const roomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");

const notification: IncomingCallNotification = {
  roomId,
  uuid: "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
  callerId: "u_alice",
  callerName: "Alice",
  callerAvatarUrl: null,
  callerTrancallId: "@alice",
  roomType: "audio",
  translationEnabled: false,
  languagePair: "en-ja",
  callerLanguage: "en",
  timestamp: "2026-05-11T10:00:00Z",
};

function makeIosToken(token = "ios-device-token"): DeviceTokenRow {
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

function makeAndroidToken(token = "android-fcm-token"): DeviceTokenRow {
  return {
    ...makeIosToken(token),
    platform: "android",
    bundleId: null,
  };
}

// delay を即時化するモック
const noDelay = async (_attempt: number): Promise<void> => {};

const TEST_HMAC_SECRET = "test-hmac-secret-key-at-least-32-chars!";

function makeApnsAdapter(sendResult: ReturnType<ApnsAdapter["sendVoipPush"]> extends Promise<infer T> ? T : never): ApnsAdapter {
  return {
    sendVoipPush: vi.fn().mockResolvedValue(sendResult),
  };
}

function makeFcmAdapter(sendResult: Awaited<ReturnType<FcmAdapter["sendData"]>>): FcmAdapter {
  return {
    sendData: vi.fn().mockResolvedValue(sendResult),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTokenRepo(): DeviceTokenRepository {
  return {
    upsert: vi.fn().mockResolvedValue(ok(makeIosToken())),
    findActiveByUserId: vi.fn().mockResolvedValue(ok([])),
    revoke: vi.fn().mockResolvedValue(ok(true as const)),
    delete: vi.fn().mockResolvedValue(ok(true as const)),
  };
}

function makeLogRepo(): PushLogRepository {
  return {
    write: vi.fn().mockResolvedValue(ok(true as const)),
  };
}

describe("PushDispatcher.sendIncomingCall — iOS APNs", () => {
  it("APNs 配信成功で ok(true) を返す", async () => {
    const apns = makeApnsAdapter(ok({ apnsId: "apns-msg-id" }));
    const fcm = makeFcmAdapter(ok({ messageId: "fcm-id" }));
    const tokenRepo = makeTokenRepo();
    const logRepo = makeLogRepo();

    const dispatcher = createPushDispatcher({ apnsAdapter: apns, fcmAdapter: fcm, tokenRepo, logRepo, hmacSecret: TEST_HMAC_SECRET, delayFn: noDelay });
    const result = await dispatcher.sendIncomingCall(userId, notification, [makeIosToken()]);

    expect(result.ok).toBe(true);
    expect(apns.sendVoipPush).toHaveBeenCalledOnce();
    expect(logRepo.write).toHaveBeenCalledOnce();
  });

  it("APNs が retryable エラーを返す場合、3 回リトライして最終失敗 NOTIFICATION_PUSH_DELIVERY_FAILED", async () => {
    const apns: ApnsAdapter = {
      sendVoipPush: vi.fn().mockResolvedValue(err({
        code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
        message: "server error",
        retryable: true,
        provider: "apns",
      })),
    };
    const fcm = makeFcmAdapter(ok({ messageId: "fcm-id" }));
    const tokenRepo = makeTokenRepo();
    const logRepo = makeLogRepo();

    const dispatcher = createPushDispatcher({ apnsAdapter: apns, fcmAdapter: fcm, tokenRepo, logRepo, hmacSecret: TEST_HMAC_SECRET, delayFn: noDelay });
    const result = await dispatcher.sendIncomingCall(userId, notification, [makeIosToken()]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_PUSH_DELIVERY_FAILED");
    }
    // MAX_RETRIES = 3 回呼ばれる
    expect(apns.sendVoipPush).toHaveBeenCalledTimes(3);
    // ログも書かれる
    expect(logRepo.write).toHaveBeenCalledOnce();
  });

  it("APNs 410 Gone でトークンが revoke される", async () => {
    const apns: ApnsAdapter = {
      sendVoipPush: vi.fn().mockResolvedValue(err({
        code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
        message: "APNs: Unregistered (410)",
        retryable: false,
        provider: "apns",
      })),
    };
    const fcm = makeFcmAdapter(ok({ messageId: "fcm-id" }));
    const tokenRepo = makeTokenRepo();
    const logRepo = makeLogRepo();

    const dispatcher = createPushDispatcher({ apnsAdapter: apns, fcmAdapter: fcm, tokenRepo, logRepo, hmacSecret: TEST_HMAC_SECRET, delayFn: noDelay });
    await dispatcher.sendIncomingCall(userId, notification, [makeIosToken("expired-ios-token")]);

    expect(tokenRepo.revoke).toHaveBeenCalledWith("ios", "expired-ios-token");
  });
});

describe("PushDispatcher.sendIncomingCall — Android FCM", () => {
  it("FCM 配信成功で ok(true) を返す", async () => {
    const apns = makeApnsAdapter(ok({ apnsId: "apns-msg-id" }));
    const fcm: FcmAdapter = {
      sendData: vi.fn().mockResolvedValue(ok({ messageId: "projects/xxx/messages/yyy" })),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const tokenRepo = makeTokenRepo();
    const logRepo = makeLogRepo();

    const dispatcher = createPushDispatcher({ apnsAdapter: apns, fcmAdapter: fcm, tokenRepo, logRepo, hmacSecret: TEST_HMAC_SECRET, delayFn: noDelay });
    const result = await dispatcher.sendIncomingCall(userId, notification, [makeAndroidToken()]);

    expect(result.ok).toBe(true);
    expect(fcm.sendData).toHaveBeenCalledOnce();
  });
});

describe("PushDispatcher.sendIncomingCall — トークンなし", () => {
  it("tokens が空のとき NOTIFICATION_PUSH_DELIVERY_FAILED を返す", async () => {
    const apns = makeApnsAdapter(ok({ apnsId: "apns-msg-id" }));
    const fcm = makeFcmAdapter(ok({ messageId: "fcm-id" }));
    const tokenRepo = makeTokenRepo();
    const logRepo = makeLogRepo();

    const dispatcher = createPushDispatcher({ apnsAdapter: apns, fcmAdapter: fcm, tokenRepo, logRepo, hmacSecret: TEST_HMAC_SECRET, delayFn: noDelay });
    const result = await dispatcher.sendIncomingCall(userId, notification, []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_PUSH_DELIVERY_FAILED");
    }
  });
});
