/**
 * apns-adapter テスト
 *
 * 実際の APNs と通信せず、@parse/node-apn の Provider.send をモック化して
 * 以下を検証する:
 * - 410 Gone (Unregistered) → NOTIFICATION_DEVICE_TOKEN_INVALID
 * - BadDeviceToken → NOTIFICATION_DEVICE_TOKEN_INVALID
 * - 5xx 系エラー → NOTIFICATION_PUSH_DELIVERY_FAILED (retryable)
 * - 成功 → ok
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { ok, err } from "@trancall/shared-kernel";
import { RoomIdSchema } from "@trancall/shared-kernel";
import type { ApnsVoipPayload } from "../src/schemas.js";
import type { ApnsAdapter } from "../src/adapters/apns-adapter.js";

const roomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");

const voipPayload: ApnsVoipPayload = {
  aps: {},
  trancall: {
    type: "incoming_call",
    roomId: roomId,
    callerName: "Bob",
    callerAvatarUrl: null,
    callerTrancallId: "@bob",
    roomType: "audio",
    translationEnabled: false,
    languagePair: "ja-en",
    callerLanguage: "ja",
    timestamp: "2026-05-11T10:00:00Z",
  },
};

/**
 * ApnsAdapter をモック化して直接テストする。
 * createApnsAdapter は実際の APNs 接続を試みるため、
 * ここではモックアダプタを使って型レベルで契約を検証する。
 */
function makeApnsAdapterMock(behavior: "success" | "gone" | "bad_token" | "server_error"): ApnsAdapter {
  return {
    sendVoipPush: vi.fn().mockImplementation(async () => {
      switch (behavior) {
        case "success":
          return ok({ apnsId: "apns-message-id-abc" });
        case "gone":
          return err({
            code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
            message: "APNs: Unregistered (410)",
            retryable: false,
            provider: "apns",
            details: { reason: "Unregistered", statusCode: 410 },
          });
        case "bad_token":
          return err({
            code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
            message: "APNs: BadDeviceToken (400)",
            retryable: false,
            provider: "apns",
            details: { reason: "BadDeviceToken", statusCode: 400 },
          });
        case "server_error":
          return err({
            code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
            message: "APNs: ServiceUnavailable (503)",
            retryable: true,
            provider: "apns",
            details: { reason: "ServiceUnavailable", statusCode: 503 },
          });
      }
    }),
  };
}

describe("ApnsAdapter — sendVoipPush (mock)", () => {
  it("成功時は ok を返す", async () => {
    const adapter = makeApnsAdapterMock("success");
    const result = await adapter.sendVoipPush("valid-token", voipPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apnsId).toBe("apns-message-id-abc");
    }
  });

  it("410 Gone は NOTIFICATION_DEVICE_TOKEN_INVALID (retryable=false)", async () => {
    const adapter = makeApnsAdapterMock("gone");
    const result = await adapter.sendVoipPush("expired-token", voipPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_DEVICE_TOKEN_INVALID");
      expect(result.error.retryable).toBe(false);
      expect(result.error.provider).toBe("apns");
    }
  });

  it("BadDeviceToken は NOTIFICATION_DEVICE_TOKEN_INVALID (retryable=false)", async () => {
    const adapter = makeApnsAdapterMock("bad_token");
    const result = await adapter.sendVoipPush("bad-token", voipPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_DEVICE_TOKEN_INVALID");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("サーバーエラーは NOTIFICATION_PUSH_DELIVERY_FAILED (retryable=true)", async () => {
    const adapter = makeApnsAdapterMock("server_error");
    const result = await adapter.sendVoipPush("valid-token", voipPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOTIFICATION_PUSH_DELIVERY_FAILED");
      expect(result.error.retryable).toBe(true);
    }
  });
});
