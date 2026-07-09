/**
 * join-service テスト
 *
 * joinCall のコアロジックを in-memory repository でテストする。
 *
 * 確定#2 (認可バイパス修正): joinCall は「既に participant 行がある
 * (=招待済み or host) ユーザーのみ」join を許可する。そのため以下のテストの
 * seedRoom ヘルパーは、host に加えて「招待済み (joined_at: null)」の参加者を
 * 明示的に登録できるよう拡張している (createCall の invitee 事前登録を模す)。
 */

import { describe, it, expect } from "vitest";
import { RoomIdSchema, UserIdSchema } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";

import { createJoinService } from "../src/services/join-service.js";
import { createInMemoryRoomRepository } from "./helpers/in-memory-room-repository.js";
import { createInMemoryParticipantRepository } from "./helpers/in-memory-participant-repository.js";
import { makeEventBus } from "./helpers/mock-facades.js";

const creatorId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
const userId2 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const userId3 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440003");
const uninvitedUserId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440099");
const testRoomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440010");

function makeService() {
  const roomRepo = createInMemoryRoomRepository();
  const participantRepo = createInMemoryParticipantRepository();
  const eventBus = makeEventBus();

  const service = createJoinService({ roomRepo, participantRepo, eventBus });

  return { service, roomRepo, participantRepo, eventBus };
}

/**
 * @param invitedUserIds createCall が事前登録する invitee を模す
 *   (joined_at: null の「招待済み・未参加」行として登録する)。
 */
async function seedRoom(
  roomRepo: ReturnType<typeof createInMemoryRoomRepository>,
  participantRepo: ReturnType<typeof createInMemoryParticipantRepository>,
  status: "waiting" | "active" | "ended" = "waiting",
  invitedUserIds: UserId[] = [],
) {
  await roomRepo.insert({
    roomId: testRoomId,
    status,
    translationEnabled: false,
    createdBy: creatorId,
    createdAt: new Date().toISOString(),
  });
  await participantRepo.upsert({
    roomId: testRoomId,
    userId: creatorId,
    role: "host",
    joinedAt: new Date().toISOString(),
  });
  for (const invitedUserId of invitedUserIds) {
    await participantRepo.upsert({
      roomId: testRoomId,
      userId: invitedUserId,
      role: "member",
      joinedAt: null,
    });
  }
}

describe("JoinService.joinCall", () => {
  it("正常系: waiting → active に遷移し member が追加される", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2]);

    const result = await service.joinCall(testRoomId, userId2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe("active");
    expect(result.data.participants).toHaveLength(2);

    const member = result.data.participants.find((p) => p.userId === userId2);
    expect(member).toBeDefined();
    expect(member?.role).toBe("member");
  });

  it("既に active の room に招待済みユーザーが join しても成功する", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "active", [userId2]);

    const result = await service.joinCall(testRoomId, userId2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("active");
  });

  it("ended の room に join すると ROOM_ALREADY_ENDED", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "ended", [userId2]);

    const result = await service.joinCall(testRoomId, userId2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_ALREADY_ENDED");
  });

  it("存在しない roomId は ROOM_NOT_FOUND", async () => {
    const { service } = makeService();
    const fakeRoomId = RoomIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-000000000000");

    const result = await service.joinCall(fakeRoomId, userId2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("同一ユーザーが 2 回 join しても冪等 (participants 数が増えない)", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2]);

    await service.joinCall(testRoomId, userId2);
    const second = await service.joinCall(testRoomId, userId2);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // host + user2 で 2 人のまま
    expect(second.data.participants).toHaveLength(2);
  });

  it("room.participant_joined イベントが発行される", async () => {
    const { service, roomRepo, participantRepo, eventBus } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2]);

    await service.joinCall(testRoomId, userId2);

    const joinedEvents = eventBus.published.filter(
      (e) => (e as { type: string }).type === "room.participant_joined",
    );
    expect(joinedEvents).toHaveLength(1);
    const event = joinedEvents[0] as { payload: { roomId: string; userId: string } };
    expect(event.payload.roomId).toBe(testRoomId);
    expect(event.payload.userId).toBe(userId2);
  });

  it("複数の招待済みユーザーが join できる", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2, userId3]);

    await service.joinCall(testRoomId, userId2);
    const result = await service.joinCall(testRoomId, userId3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participants).toHaveLength(3);
  });

  it("host が自分自身で joinCall を呼んでも冪等かつ role が member に降格しない", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting");

    // host (creatorId) が再度 joinCall を呼ぶ
    const result = await service.joinCall(testRoomId, creatorId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // host 1 人のみ（重複しない）
    expect(result.data.participants).toHaveLength(1);
    // 確定#2: markJoined は role を書き換えないため host のまま維持される
    // (旧実装は upsert で role: "member" を常に書き込んでいたため降格していた)
    const host = result.data.participants.find((p) => p.userId === creatorId);
    expect(host?.role).toBe("host");
  });

  // 確定#2: 認可バイパス修正の回帰テスト
  it("招待されていないユーザーの join は ROOM_USER_NOT_INVITED で拒否される", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    // userId2 のみ招待し、uninvitedUserId は招待しない
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2]);

    const result = await service.joinCall(testRoomId, uninvitedUserId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_USER_NOT_INVITED");
  });

  it("招待されていないユーザーの join では participants / room 状態が変化しない", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting", [userId2]);

    await service.joinCall(testRoomId, uninvitedUserId);

    const participantsResult = await participantRepo.findByRoomId(testRoomId);
    expect(participantsResult.ok).toBe(true);
    if (!participantsResult.ok) return;
    // host + 招待済み userId2 (未 join) のみ。uninvitedUserId の行は作られない。
    expect(participantsResult.data).toHaveLength(2);
    expect(participantsResult.data.some((p) => p.user_id === uninvitedUserId)).toBe(false);

    const roomResult = await roomRepo.findById(testRoomId);
    expect(roomResult.ok).toBe(true);
    if (!roomResult.ok) return;
    // 拒否された join では waiting → active に遷移しない
    expect(roomResult.data.status).toBe("waiting");
  });
});
