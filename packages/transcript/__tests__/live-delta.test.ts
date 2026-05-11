/**
 * LiveSubtitleDelta バリデーション テスト
 *
 * 1. 正常な delta は ok を返す
 * 2. originalDelta が空文字は VALIDATION_ERROR
 * 3. translatedDelta が空文字は VALIDATION_ERROR
 * 4. speakerName が空は VALIDATION_ERROR
 * 5. roomId が不正 UUID は VALIDATION_ERROR
 * 6. isFinal が欠落は VALIDATION_ERROR
 */

import { describe, it, expect } from "vitest";
import { createTranscriptFacade } from "../src/facade.js";
import { InMemorySegmentRepository, InMemoryAccessRepository } from "./helpers/stubs.js";
import {
  ROOM_ID_RAW,
  PARTICIPANT_A_RAW,
  SESSION_ID_RAW,
} from "./helpers/fixtures.js";

function makeValidDelta() {
  return {
    roomId: ROOM_ID_RAW,
    participantId: PARTICIPANT_A_RAW,
    translationSessionId: SESSION_ID_RAW,
    speakerName: "Alice",
    originalDelta: "こんにち",
    translatedDelta: "Hel",
    language: "ja",
    isFinal: false,
    timestamp: Date.now(),
  };
}

describe("validateLiveDelta", () => {
  const facade = createTranscriptFacade(
    new InMemorySegmentRepository(),
    new InMemoryAccessRepository(),
  );

  it("test-1: 正常な delta は ok(LiveSubtitleDelta) を返す", () => {
    const result = facade.validateLiveDelta(makeValidDelta());
    expect(result.ok).toBe(true);
  });

  it("test-2: originalDelta が空文字は VALIDATION_ERROR", () => {
    const result = facade.validateLiveDelta({
      ...makeValidDelta(),
      originalDelta: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-3: translatedDelta が空文字は VALIDATION_ERROR", () => {
    const result = facade.validateLiveDelta({
      ...makeValidDelta(),
      translatedDelta: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-4: speakerName が空文字は VALIDATION_ERROR", () => {
    const result = facade.validateLiveDelta({
      ...makeValidDelta(),
      speakerName: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-5: roomId が不正 UUID は VALIDATION_ERROR", () => {
    const result = facade.validateLiveDelta({
      ...makeValidDelta(),
      roomId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-6: isFinal が欠落は VALIDATION_ERROR", () => {
    const { isFinal: _removed, ...withoutIsFinal } = makeValidDelta();
    const result = facade.validateLiveDelta(withoutIsFinal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-7: translationSessionId が null は許可される", () => {
    const result = facade.validateLiveDelta({
      ...makeValidDelta(),
      translationSessionId: null,
    });
    expect(result.ok).toBe(true);
  });
});
