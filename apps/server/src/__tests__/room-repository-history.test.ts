/**
 * RoomRepository.findEndedByParticipantId (Supabase 実装) テスト (L-13)
 *
 * docs/api-spec.md GET /api/rooms/history の実装側の制約:
 * 1) trancall_room.participants から対象ユーザーが参加した room_id 一覧を取得
 * 2) trancall_room.rooms のうち status='ended' かつ since/before の範囲内を新しい順に limit 件
 * のみを対象とし、他モジュールのテーブルは一切参照しないことを検証する。
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import { createRoomRepository } from "../adapters/repositories/room/room-repository.supabase.js";

const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;
const ROOM_ID_1 = "22222222-2222-4222-8222-222222222222" as RoomId;
const ROOM_ID_2 = "33333333-3333-4333-8333-333333333333" as RoomId;

function makeRoomRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    room_id: ROOM_ID_1,
    status: "ended",
    room_type: "audio",
    translation_enabled: true,
    created_by: USER_ID,
    created_at: "2026-05-01T00:00:00.000Z",
    ended_at: "2026-05-01T00:10:00.000Z",
    ...overrides,
  };
}

function makeSupabaseMock(opts: {
  participantRows: Array<{ room_id: string }>;
  roomRows: Array<Record<string, unknown>>;
}) {
  const participantsChain: Record<string, unknown> = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: opts.participantRows, error: null }).then(onFulfilled),
  };
  (participantsChain["select"] as ReturnType<typeof vi.fn>).mockReturnValue(participantsChain);
  (participantsChain["eq"] as ReturnType<typeof vi.fn>).mockReturnValue(participantsChain);

  const roomsChain: Record<string, unknown> = {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: opts.roomRows, error: null }).then(onFulfilled),
  };
  for (const key of ["select", "in", "eq", "order", "limit", "gte", "lt"]) {
    (roomsChain[key] as ReturnType<typeof vi.fn>).mockReturnValue(roomsChain);
  }

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "participants") return participantsChain;
    if (table === "rooms") return roomsChain;
    throw new Error(`unexpected table: ${table}`);
  });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;

  return { supabase, schemaMock, fromMock, participantsChain, roomsChain };
}

describe("RoomRepository.findEndedByParticipantId", () => {
  it("trancall_room.participants / trancall_room.rooms のみを参照する (他モジュールのテーブル不参照)", async () => {
    const { supabase, schemaMock } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    await repo.findEndedByParticipantId(USER_ID, { limit: 20 });

    expect(schemaMock).toHaveBeenCalledWith("trancall_room");
    expect(schemaMock).not.toHaveBeenCalledWith("trancall_auth");
    expect(schemaMock).not.toHaveBeenCalledWith("trancall_billing");
    expect(schemaMock).not.toHaveBeenCalledWith("trancall_transcript");
  });

  it("参加した room_id で絞り込み、status='ended' の行のみ返す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }, { room_id: ROOM_ID_2 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    const result = await repo.findEndedByParticipantId(USER_ID, { limit: 20 });

    expect(roomsChain["in"]).toHaveBeenCalledWith("room_id", [ROOM_ID_1, ROOM_ID_2]);
    expect(roomsChain["eq"]).toHaveBeenCalledWith("status", "ended");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
  });

  it("limit を渡す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    await repo.findEndedByParticipantId(USER_ID, { limit: 5 });

    expect(roomsChain["limit"]).toHaveBeenCalledWith(5);
  });

  it("since 指定時は gte('created_at', since) を渡す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    await repo.findEndedByParticipantId(USER_ID, {
      limit: 20,
      since: "2026-01-01T00:00:00.000Z",
    });

    expect(roomsChain["gte"]).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00.000Z");
  });

  it("before 指定時は lt('created_at', before) を渡す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    await repo.findEndedByParticipantId(USER_ID, {
      limit: 20,
      before: "2026-06-01T00:00:00.000Z",
    });

    expect(roomsChain["lt"]).toHaveBeenCalledWith("created_at", "2026-06-01T00:00:00.000Z");
  });

  it("参加履歴が 0 件なら rooms クエリを発行せず空配列を返す", async () => {
    const { supabase, fromMock } = makeSupabaseMock({
      participantRows: [],
      roomRows: [],
    });
    const repo = createRoomRepository(supabase);

    const result = await repo.findEndedByParticipantId(USER_ID, { limit: 20 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
    expect(fromMock).not.toHaveBeenCalledWith("rooms");
  });

  it("重複する room_id は de-dupe してから in() に渡す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }, { room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow()],
    });
    const repo = createRoomRepository(supabase);

    await repo.findEndedByParticipantId(USER_ID, { limit: 20 });

    expect(roomsChain["in"]).toHaveBeenCalledWith("room_id", [ROOM_ID_1]);
  });

  it("Supabase エラー時 (participants クエリ) は INTERNAL_ERROR を返す", async () => {
    const { supabase, participantsChain } = makeSupabaseMock({
      participantRows: [],
      roomRows: [],
    });
    participantsChain["then"] = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: "boom" } }).then(onFulfilled);
    const repo = createRoomRepository(supabase);

    const result = await repo.findEndedByParticipantId(USER_ID, { limit: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("Supabase エラー時 (rooms クエリ) は INTERNAL_ERROR を返す", async () => {
    const { supabase, roomsChain } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [],
    });
    roomsChain["then"] = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: "boom" } }).then(onFulfilled);
    const repo = createRoomRepository(supabase);

    const result = await repo.findEndedByParticipantId(USER_ID, { limit: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("スキーマ不正な行は静かにスキップする", async () => {
    const { supabase } = makeSupabaseMock({
      participantRows: [{ room_id: ROOM_ID_1 }],
      roomRows: [makeRoomRow({ room_id: "not-a-uuid" })],
    });
    const repo = createRoomRepository(supabase);

    const result = await repo.findEndedByParticipantId(USER_ID, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });
});
