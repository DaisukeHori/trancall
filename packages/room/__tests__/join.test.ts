/**
 * join-service テスト
 *
 * joinCall のコアロジックを in-memory repository でテストする。
 */

import { describe, it, expect } from "vitest";
import { RoomIdSchema, UserIdSchema } from "@trancall/shared-kernel";

import { createJoinService } from "../src/services/join-service.js";
import { createInMemoryRoomRepository } from "./helpers/in-memory-room-repository.js";
import { createInMemoryParticipantRepository } from "./helpers/in-memory-participant-repository.js";
import { makeEventBus } from "./helpers/mock-facades.js";

const creatorId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
const userId2 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const userId3 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440003");
const testRoomId = RoomIdSchema.parse("550e8400-e29b-41d4-a716-446655440010");

function makeService() {
  const roomRepo = createInMemoryRoomRepository();
  const participantRepo = createInMemoryParticipantRepository();
  const eventBus = makeEventBus();

  const service = createJoinService({ roomRepo, participantRepo, eventBus });

  return { service, roomRepo, participantRepo, eventBus };
}

async function seedRoom(
  roomRepo: ReturnType<typeof createInMemoryRoomRepository>,
  participantRepo: ReturnType<typeof createInMemoryParticipantRepository>,
  status: "waiting" | "active" | "ended" = "waiting",
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
}

describe("JoinService.joinCall", () => {
  it("正常系: waiting → active に遷移し member が追加される", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting");

    const result = await service.joinCall(testRoomId, userId2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe("active");
    expect(result.data.participants).toHaveLength(2);

    const member = result.data.participants.find((p) => p.userId === userId2);
    expect(member).toBeDefined();
    expect(member?.role).toBe("member");
  });

  it("既に active の room に join しても成功する", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "active");

    const result = await service.joinCall(testRoomId, userId2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("active");
  });

  it("ended の room に join すると ROOM_ALREADY_ENDED", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "ended");

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
    await seedRoom(roomRepo, participantRepo, "waiting");

    await service.joinCall(testRoomId, userId2);
    const second = await service.joinCall(testRoomId, userId2);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // host + user2 で 2 人のまま
    expect(second.data.participants).toHaveLength(2);
  });

  it("room.participant_joined イベントが発行される", async () => {
    const { service, roomRepo, participantRepo, eventBus } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting");

    await service.joinCall(testRoomId, userId2);

    const joinedEvents = eventBus.published.filter(
      (e) => (e as { type: string }).type === "room.participant_joined",
    );
    expect(joinedEvents).toHaveLength(1);
    const event = joinedEvents[0] as { roomId: string; userId: string };
    expect(event.roomId).toBe(testRoomId);
    expect(event.userId).toBe(userId2);
  });

  it("複数ユーザーが join できる", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting");

    await service.joinCall(testRoomId, userId2);
    const result = await service.joinCall(testRoomId, userId3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participants).toHaveLength(3);
  });

  it("host が自分自身で joinCall を呼んでも冪等", async () => {
    const { service, roomRepo, participantRepo } = makeService();
    await seedRoom(roomRepo, participantRepo, "waiting");

    // host (creatorId) が再度 joinCall を呼ぶ
    // 仕様上 member として upsert されるが冪等性は保たれる
    const result = await service.joinCall(testRoomId, creatorId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // host 1 人のみ（重複しない）
    expect(result.data.participants).toHaveLength(1);
  });
});
