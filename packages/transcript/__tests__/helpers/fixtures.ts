/**
 * テスト用フィクスチャ生成
 */

import {
  brandRoomId,
  brandParticipantId,
  brandUserId,
  brandTranslationSessionId,
} from "@trancall/shared-kernel";
import type { TranscriptSegment, TranscriptAccess } from "../../src/schemas.js";

// 固定 UUID（テスト再現性のため）
// Zod v4 は RFC 4122 準拠の UUID のみ受け付ける（variant bits が必要）
export const ROOM_ID_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
export const PARTICIPANT_A_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d480";
export const PARTICIPANT_B_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d481";
export const USER_A_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d482";
export const USER_B_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d483";
export const SESSION_ID_RAW = "f47ac10b-58cc-4372-a567-0e02b2c3d484";

function mustOk<T>(result: { success: boolean; data?: T }): T {
  if (!result.success || result.data === undefined) {
    throw new Error("brand parse failed");
  }
  return result.data;
}

export const ROOM_ID = mustOk(brandRoomId(ROOM_ID_RAW));
export const PARTICIPANT_A = mustOk(brandParticipantId(PARTICIPANT_A_RAW));
export const PARTICIPANT_B = mustOk(brandParticipantId(PARTICIPANT_B_RAW));
export const USER_A = mustOk(brandUserId(USER_A_RAW));
export const USER_B = mustOk(brandUserId(USER_B_RAW));
export const SESSION_ID = mustOk(brandTranslationSessionId(SESSION_ID_RAW));

export function makeSegment(
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d401",
    roomId: ROOM_ID,
    participantId: PARTICIPANT_A,
    speakerName: "Alice",
    originalText: "こんにちは",
    translatedText: "Hello",
    languagePair: "ja-en",
    startTimeMs: 0,
    endTimeMs: 2000,
    sequenceNo: 0,
    sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d402",
    agentSessionId: null,
    retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAccessRecord(
  userId: TranscriptAccess["userId"],
  overrides: Partial<TranscriptAccess> = {},
): TranscriptAccess {
  return {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d403",
    roomId: ROOM_ID,
    userId,
    canView: true,
    canExport: false,
    deletedAt: null,
    consentVersion: "v1.0",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
