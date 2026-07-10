/**
 * state-builder テスト
 *
 * nullable 追従 (00019 migration + 確定#2 自己レビュー):
 * - rooms.created_by / participants.user_id は退会ユーザー物理削除後に NULL 化されうる
 *   (行は保持される)。buildRoomState はこれをパースエラーにせず null として扱う。
 * - participants.joined_at === null (確定#2: 招待済み・未参加) の行は
 *   公開 RoomState.participants から除外される。
 */

import { describe, it, expect } from "vitest";
import { RoomIdSchema, UserIdSchema, ParticipantIdSchema } from "@trancall/shared-kernel";
import { buildRoomState } from "../src/services/state-builder.js";
import type { RoomRow, ParticipantRow } from "../src/schemas.js";

const roomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440010");
const hostUserId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
const memberUserId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const hostParticipantId = ParticipantIdSchema.parse("550e8400-e29b-41d4-a716-446655440021");
const memberParticipantId = ParticipantIdSchema.parse("550e8400-e29b-41d4-a716-446655440022");

function makeRoomRow(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    room_id: roomId,
    status: "active",
    room_type: "audio",
    translation_enabled: true,
    created_by: hostUserId,
    created_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  };
}

function makeParticipantRow(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: hostParticipantId,
    room_id: roomId,
    user_id: hostUserId,
    role: "host",
    is_muted: false,
    joined_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

describe("buildRoomState — nullable 追従", () => {
  it("created_by が null (退会済みユーザー物理削除) でもパースエラーにならない", () => {
    const room = makeRoomRow({ created_by: null });
    const result = buildRoomState(room, [makeParticipantRow()]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.createdBy).toBeNull();
  });

  it("participant.user_id が null (退会済みユーザー物理削除) でもパースエラーにならない", () => {
    const room = makeRoomRow();
    const participant = makeParticipantRow({ user_id: null });
    const result = buildRoomState(room, [participant]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participants).toHaveLength(1);
    expect(result.data.participants[0]?.userId).toBeNull();
  });

  it("created_by / user_id が両方非 null なら従来通りパースされる", () => {
    const room = makeRoomRow();
    const participant = makeParticipantRow();
    const result = buildRoomState(room, [participant]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.createdBy).toBe(hostUserId);
    expect(result.data.participants[0]?.userId).toBe(hostUserId);
  });

  // 確定#2: 招待済み・未参加 (joined_at: null) の行は公開 participants から除外される
  it("joined_at が null (招待済み・未参加) の行は participants から除外される", () => {
    const room = makeRoomRow();
    const host = makeParticipantRow();
    const invitedNotJoined = makeParticipantRow({
      id: memberParticipantId,
      user_id: memberUserId,
      role: "member",
      joined_at: null,
    });
    const result = buildRoomState(room, [host, invitedNotJoined]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participants).toHaveLength(1);
    expect(result.data.participants[0]?.userId).toBe(hostUserId);
  });
});
