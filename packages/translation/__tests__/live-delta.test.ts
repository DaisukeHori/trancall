import { describe, it, expect } from "vitest";

import { LiveSubtitleDeltaSchema } from "../src/schemas.js";

const validRoomId = "00000000-0000-4000-8000-000000000001";
const validParticipantId = "00000000-0000-4000-8000-000000000002";
const validSessionId = "00000000-0000-4000-8000-000000000003";

describe("LiveSubtitleDeltaSchema", () => {
  it("正常なデルタをパースできる", () => {
    const result = LiveSubtitleDeltaSchema.safeParse({
      roomId: validRoomId,
      participantId: validParticipantId,
      translationSessionId: validSessionId,
      speakerName: "Taro",
      originalDelta: "Hello",
      translatedDelta: "こんにちは",
      language: "ja",
      isFinal: false,
      timestamp: 1716000000000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isFinal).toBe(false);
      expect(result.data.language).toBe("ja");
    }
  });

  it("translationSessionId が null でもパースできる（1対1通話用）", () => {
    const result = LiveSubtitleDeltaSchema.safeParse({
      roomId: validRoomId,
      participantId: validParticipantId,
      translationSessionId: null,
      speakerName: "Hanako",
      originalDelta: "Hi",
      translatedDelta: "やあ",
      language: "ja",
      isFinal: true,
      timestamp: 1716000001000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.translationSessionId).toBeNull();
      expect(result.data.isFinal).toBe(true);
    }
  });

  it("timestamp が負値の場合はバリデーションエラー", () => {
    const result = LiveSubtitleDeltaSchema.safeParse({
      roomId: validRoomId,
      participantId: validParticipantId,
      translationSessionId: null,
      speakerName: "Alice",
      originalDelta: "Test",
      translatedDelta: "テスト",
      language: "en",
      isFinal: false,
      timestamp: -1,
    });
    expect(result.success).toBe(false);
  });

  it("roomId が UUID でない場合はバリデーションエラー", () => {
    const result = LiveSubtitleDeltaSchema.safeParse({
      roomId: "not-a-uuid",
      participantId: validParticipantId,
      translationSessionId: null,
      speakerName: "Bob",
      originalDelta: "Hello",
      translatedDelta: "こんにちは",
      language: "ja",
      isFinal: false,
      timestamp: 1716000000000,
    });
    expect(result.success).toBe(false);
  });

  it("isFinal が boolean でない場合はバリデーションエラー", () => {
    const result = LiveSubtitleDeltaSchema.safeParse({
      roomId: validRoomId,
      participantId: validParticipantId,
      translationSessionId: null,
      speakerName: "Carol",
      originalDelta: "Hello",
      translatedDelta: "こんにちは",
      language: "ja",
      isFinal: "true",
      timestamp: 1716000000000,
    });
    expect(result.success).toBe(false);
  });
});
