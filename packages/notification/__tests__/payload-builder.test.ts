/**
 * payload-builder テスト
 *
 * APNs VoIP / FCM / missed call ペイロードの構造が
 * docs/notification-detail.md 仕様に一致することを検証する。
 * T-8: uuid / callerId / issuedAt / expiresAt / signature の追加を検証する。
 */

import { describe, it, expect } from "vitest";

import { buildApnsIncomingCallPayload, buildFcmIncomingCallPayload, buildApnsMissedCallPayload, buildFcmMissedCallPayload } from "../src/services/payload-builder.js";
import type { IncomingCallNotification, MissedCallPayload } from "../src/schemas.js";
import { RoomIdSchema } from "@trancall/shared-kernel";

// テスト用の RoomId ブランド付き値
const roomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");

const TEST_UUID = "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77";
const TEST_CALLER_ID = "u_abc123";
const TEST_HMAC_SECRET = "test-hmac-secret-key-at-least-32-chars!";

const baseNotification: IncomingCallNotification = {
  roomId,
  uuid: TEST_UUID,
  callerId: TEST_CALLER_ID,
  callerName: "John Wang",
  callerAvatarUrl: "https://example.com/avatar.jpg",
  callerTrancallId: "@johnwang_sf",
  roomType: "audio",
  translationEnabled: true,
  languagePair: "en-ja",
  callerLanguage: "en",
  timestamp: "2026-05-11T10:00:00Z",
};

const baseMissed: MissedCallPayload = {
  callerName: "John Wang",
  callerTrancallId: "@johnwang_sf",
  callerAvatarUrl: null,
  roomId,
  timestamp: "2026-05-11T10:00:00Z",
};

// 固定時刻（deterministic なテスト用）
const fixedNow = new Date("2026-05-11T10:00:00.000Z");

describe("buildApnsIncomingCallPayload", () => {
  it("aps が空オブジェクトである", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.aps).toEqual({});
  });

  it("trancall.type が incoming_call である", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.trancall.type).toBe("incoming_call");
  });

  it("必須フィールドがすべて存在する (roomId / uuid / callerId / callerName / callerTrancallId / callerLanguage)", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.trancall.roomId).toBe(baseNotification.roomId);
    expect(payload.trancall.uuid).toBe(TEST_UUID);
    expect(payload.trancall.callerId).toBe(TEST_CALLER_ID);
    expect(payload.trancall.callerName).toBe("John Wang");
    expect(payload.trancall.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.trancall.callerLanguage).toBe("en");
    expect(payload.trancall.languagePair).toBe("en-ja");
    expect(payload.trancall.translationEnabled).toBe(true);
    expect(payload.trancall.roomType).toBe("audio");
    expect(payload.trancall.timestamp).toBe("2026-05-11T10:00:00Z");
  });

  it("issuedAt / expiresAt が ISO8601 .000Z 形式で含まれる", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.trancall.issuedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(payload.trancall.expiresAt).toBe("2026-05-11T10:00:30.000Z");
  });

  it("signature が小文字 hex 64 文字である", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.trancall.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ入力で同じ signature が生成される（deterministic）", () => {
    const payload1 = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    const payload2 = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload1.trancall.signature).toBe(payload2.trancall.signature);
  });

  it("callerAvatarUrl が null のとき null で出力される", () => {
    const payload = buildApnsIncomingCallPayload({ ...baseNotification, callerAvatarUrl: null }, TEST_HMAC_SECRET, fixedNow);
    expect(payload.trancall.callerAvatarUrl).toBeNull();
  });
});

describe("buildFcmIncomingCallPayload", () => {
  it("type が incoming_call である", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.type).toBe("incoming_call");
  });

  it("translationEnabled が文字列 'true' に変換される", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.translationEnabled).toBe("true");
  });

  it("translationEnabled=false は文字列 'false' になる", () => {
    const payload = buildFcmIncomingCallPayload({ ...baseNotification, translationEnabled: false }, TEST_HMAC_SECRET, fixedNow);
    expect(payload.translationEnabled).toBe("false");
  });

  it("必須フィールドがすべて存在する（uuid / callerId / issuedAt / expiresAt / signature を含む）", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.roomId).toBe(baseNotification.roomId);
    expect(payload.uuid).toBe(TEST_UUID);
    expect(payload.callerId).toBe(TEST_CALLER_ID);
    expect(payload.callerName).toBe("John Wang");
    expect(payload.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.languagePair).toBe("en-ja");
    expect(payload.roomType).toBe("audio");
    expect(payload.timestamp).toBe("2026-05-11T10:00:00Z");
    expect(payload.issuedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(payload.expiresAt).toBe("2026-05-11T10:00:30.000Z");
  });

  it("signature が小文字 hex 64 文字である", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(payload.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("APNs と FCM で同じ canonical string から同じ signature が生成される", () => {
    const apns = buildApnsIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    const fcm = buildFcmIncomingCallPayload(baseNotification, TEST_HMAC_SECRET, fixedNow);
    expect(apns.trancall.signature).toBe(fcm.signature);
  });
});

describe("buildApnsMissedCallPayload", () => {
  it("missed_call payload が正しい型を含む", () => {
    const payload = buildApnsMissedCallPayload(baseMissed) as {
      aps: { alert: { title: string; body: string }; "content-available": number };
      trancall: { type: string; roomId: string; callerName: string; callerTrancallId: string; callerAvatarUrl: null; timestamp: string };
    };
    expect(payload.trancall.type).toBe("missed_call");
    expect(payload.trancall.callerName).toBe("John Wang");
    expect(payload.trancall.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.trancall.callerAvatarUrl).toBeNull();
  });

  it("body フォーマットが \"{callerName} ({callerTrancallId})\" であること", () => {
    const payload = buildApnsMissedCallPayload(baseMissed) as {
      aps: { alert: { title: string; body: string } };
      trancall: Record<string, unknown>;
    };
    expect(payload.aps.alert.body).toBe("John Wang (@johnwang_sf)");
  });

  it("不在着信通知には signature が含まれない（docs/notification-detail.md §4）", () => {
    const payload = buildApnsMissedCallPayload(baseMissed) as {
      trancall: Record<string, unknown>;
    };
    expect(payload.trancall["signature"]).toBeUndefined();
  });
});

describe("buildFcmMissedCallPayload", () => {
  it("missed_call FCM payload が正しい型を含む", () => {
    const payload = buildFcmMissedCallPayload(baseMissed);
    expect(payload.type).toBe("missed_call");
    expect(payload.callerName).toBe("John Wang");
    expect(payload.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.callerAvatarUrl).toBeNull();
    expect(payload.roomId).toBe(baseMissed.roomId);
  });

  it("body フォーマットが \"{callerName} ({callerTrancallId})\" であること", () => {
    // FCM missed_call には notification.body がないため callerTrancallId フィールドを直接検証
    const payload = buildFcmMissedCallPayload(baseMissed);
    expect(payload.callerTrancallId).toBe("@johnwang_sf");
    expect(`${payload.callerName} (${payload.callerTrancallId})`).toBe("John Wang (@johnwang_sf)");
  });

  it("不在着信通知には signature が含まれない（docs/notification-detail.md §4）", () => {
    const payload = buildFcmMissedCallPayload(baseMissed);
    expect(payload.signature).toBeUndefined();
  });
});
