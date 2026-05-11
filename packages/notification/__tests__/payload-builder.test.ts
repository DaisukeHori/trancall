/**
 * payload-builder テスト
 *
 * APNs VoIP / FCM / missed call ペイロードの構造が
 * docs/notification-detail.md 仕様に一致することを検証する。
 */

import { describe, it, expect } from "vitest";

import { buildApnsIncomingCallPayload, buildFcmIncomingCallPayload, buildApnsMissedCallPayload, buildFcmMissedCallPayload } from "../src/services/payload-builder.js";
import type { IncomingCallNotification, MissedCallPayload } from "../src/schemas.js";
import { RoomIdSchema } from "@trancall/shared-kernel";

// テスト用の RoomId ブランド付き値
const roomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");

const baseNotification: IncomingCallNotification = {
  roomId,
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
  callerAvatarUrl: null,
  roomId,
  timestamp: "2026-05-11T10:00:00Z",
};

describe("buildApnsIncomingCallPayload", () => {
  it("aps が空オブジェクトである", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification);
    expect(payload.aps).toEqual({});
  });

  it("trancall.type が incoming_call である", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification);
    expect(payload.trancall.type).toBe("incoming_call");
  });

  it("必須フィールドがすべて存在する (roomId / callerName / callerTrancallId / callerLanguage)", () => {
    const payload = buildApnsIncomingCallPayload(baseNotification);
    expect(payload.trancall.roomId).toBe(baseNotification.roomId);
    expect(payload.trancall.callerName).toBe("John Wang");
    expect(payload.trancall.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.trancall.callerLanguage).toBe("en");
    expect(payload.trancall.languagePair).toBe("en-ja");
    expect(payload.trancall.translationEnabled).toBe(true);
    expect(payload.trancall.roomType).toBe("audio");
    expect(payload.trancall.timestamp).toBe("2026-05-11T10:00:00Z");
  });

  it("callerAvatarUrl が null のとき null で出力される", () => {
    const payload = buildApnsIncomingCallPayload({ ...baseNotification, callerAvatarUrl: null });
    expect(payload.trancall.callerAvatarUrl).toBeNull();
  });
});

describe("buildFcmIncomingCallPayload", () => {
  it("type が incoming_call である", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification);
    expect(payload.type).toBe("incoming_call");
  });

  it("translationEnabled が文字列 'true' に変換される", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification);
    expect(payload.translationEnabled).toBe("true");
  });

  it("translationEnabled=false は文字列 'false' になる", () => {
    const payload = buildFcmIncomingCallPayload({ ...baseNotification, translationEnabled: false });
    expect(payload.translationEnabled).toBe("false");
  });

  it("必須フィールドがすべて存在する", () => {
    const payload = buildFcmIncomingCallPayload(baseNotification);
    expect(payload.roomId).toBe(baseNotification.roomId);
    expect(payload.callerName).toBe("John Wang");
    expect(payload.callerTrancallId).toBe("@johnwang_sf");
    expect(payload.languagePair).toBe("en-ja");
    expect(payload.roomType).toBe("audio");
    expect(payload.timestamp).toBe("2026-05-11T10:00:00Z");
  });
});

describe("buildApnsMissedCallPayload", () => {
  it("missed_call payload が正しい型を含む", () => {
    const payload = buildApnsMissedCallPayload(baseMissed) as {
      aps: object;
      trancall: { type: string; roomId: string; callerName: string; callerAvatarUrl: null; timestamp: string };
    };
    expect(payload.trancall.type).toBe("missed_call");
    expect(payload.trancall.callerName).toBe("John Wang");
    expect(payload.trancall.callerAvatarUrl).toBeNull();
  });
});

describe("buildFcmMissedCallPayload", () => {
  it("missed_call FCM payload が正しい型を含む", () => {
    const payload = buildFcmMissedCallPayload(baseMissed);
    expect(payload.type).toBe("missed_call");
    expect(payload.callerName).toBe("John Wang");
    expect(payload.callerAvatarUrl).toBeNull();
    expect(payload.roomId).toBe(baseMissed.roomId);
  });
});
