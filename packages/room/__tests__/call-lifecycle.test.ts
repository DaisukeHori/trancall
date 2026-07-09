/**
 * call-lifecycle-service テスト
 *
 * createCall / endCall のコアロジックを in-memory repository でテストする。
 */

import { describe, it, expect, vi } from "vitest";
import { RoomIdSchema, UserIdSchema } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import { createCallLifecycleService } from "../src/services/call-lifecycle-service.js";
import { createInMemoryRoomRepository } from "./helpers/in-memory-room-repository.js";
import { createInMemoryParticipantRepository } from "./helpers/in-memory-participant-repository.js";
import {
  makeBillingFacade,
  makeMediaFacade,
  makeNotificationFacade,
  makeEventBus,
} from "./helpers/mock-facades.js";

const creatorId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
const inviteeId1 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const inviteeId2 = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440003");

// #52: createCall opts に追加された callerName/languagePair/callerLanguage は
// 呼び出し元 (server route) が auth/profile から解決して渡す想定のテスト用ダミー値
const TEST_CALLER_NAME = "テスト太郎";
const TEST_LANGUAGE_PAIR = "ja → en";
const TEST_CALLER_LANGUAGE = "ja";

function makeService(overrides?: {
  canStart?: boolean;
  createRoomOk?: boolean;
}) {
  const roomRepo = createInMemoryRoomRepository();
  const participantRepo = createInMemoryParticipantRepository();
  const billing = makeBillingFacade(overrides?.canStart ?? true);
  const media = makeMediaFacade(overrides?.createRoomOk ?? true);
  const notification = makeNotificationFacade();
  const eventBus = makeEventBus();

  const service = createCallLifecycleService({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
  });

  return { service, roomRepo, participantRepo, billing, media, notification, eventBus };
}

// =============================================================================
// createCall
// =============================================================================

describe("CallLifecycleService.createCall", () => {
  it("正常系: RoomState を返し status='waiting'", async () => {
    const { service } = makeService();
    const result = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.status).toBe("waiting");
    expect(result.data.translationEnabled).toBe(true);
    expect(result.data.createdBy).toBe(creatorId);
    expect(result.data.endedAt).toBeNull();
    expect(result.data.participants).toHaveLength(1);
    expect(result.data.participants[0]?.role).toBe("host");
    expect(result.data.participants[0]?.userId).toBe(creatorId);
  });

  it("billing.canStartCall が失敗 → BILLING_INSUFFICIENT_BALANCE", async () => {
    const { service } = makeService({ canStart: false });
    const result = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INSUFFICIENT_BALANCE");
  });

  it("media.createRoom が失敗 → ROOM_MEDIA_CREATE_FAILED + room は ended になる", async () => {
    const { service, roomRepo } = makeService({ createRoomOk: false });
    const result = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_MEDIA_CREATE_FAILED");

    // rooms テーブルの該当 room が ended になっていることを確認
    const rooms = [...roomRepo._store.values()];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.status).toBe("ended");
  });

  it("invitee 2 人に sendIncomingCall が並列で呼ばれる", async () => {
    const { service, notification } = makeService();
    const result = await service.createCall(creatorId, [inviteeId1, inviteeId2], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(true);
    expect(notification.sendIncomingCall).toHaveBeenCalledTimes(2);
  });

  it("invitee なしでも createCall は成功する", async () => {
    const { service, notification } = makeService();
    const result = await service.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(true);
    expect(notification.sendIncomingCall).toHaveBeenCalledTimes(0);
  });

  it("room.created イベントが発行される", async () => {
    const { service, eventBus } = makeService();
    await service.createCall(creatorId, [inviteeId1], { translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE, });

    expect(eventBus.published).toHaveLength(1);
    const event = eventBus.published[0] as { type: string };
    expect(event.type).toBe("room.created");
  });

  // 確定#2 (認可バイパス修正): invitee は participants に「招待済み・未参加」
  // (joined_at: null) として事前登録される。RoomState.participants (公開契約) には
  // 実際に join したユーザーのみ含まれる (= host 1 人のまま) が、内部の
  // participantRepo には invitee 行が存在し、後で joinCall する際に使われる。
  it("invitee は participants に「招待済み・未参加」として事前登録される", async () => {
    const { service, participantRepo } = makeService();
    const result = await service.createCall(creatorId, [inviteeId1, inviteeId2], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 公開 RoomState.participants は host のみ (invitee は未 join のため含まれない)
    expect(result.data.participants).toHaveLength(1);

    // 内部の participantRepo には invitee 行 (joined_at: null) が存在する
    const rowsResult = await participantRepo.findByRoomId(result.data.roomId);
    expect(rowsResult.ok).toBe(true);
    if (!rowsResult.ok) return;
    expect(rowsResult.data).toHaveLength(3);
    const invitee1Row = rowsResult.data.find((r) => r.user_id === inviteeId1);
    const invitee2Row = rowsResult.data.find((r) => r.user_id === inviteeId2);
    expect(invitee1Row?.joined_at).toBeNull();
    expect(invitee2Row?.joined_at).toBeNull();
    expect(invitee1Row?.role).toBe("member");
  });

  it("notification が失敗しても createCall は成功する (best-effort)", async () => {
    const { service, notification } = makeService();
    vi.mocked(notification.sendIncomingCall).mockResolvedValue({
      ok: false,
      error: { code: "NOTIFICATION_PUSH_DELIVERY_FAILED", message: "error", retryable: false },
    });

    const result = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// endCall
// =============================================================================

describe("CallLifecycleService.endCall", () => {
  it("正常系: status='active' → 'ended' + endedAt 設定", async () => {
    const { service, roomRepo } = makeService();
    // createCall で room を作成
    const createResult = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;

    // active にする
    await roomRepo.updateStatus(roomId, "active");

    const endResult = await service.endCall(roomId);
    expect(endResult.ok).toBe(true);
    if (!endResult.ok) return;

    expect(endResult.data.status).toBe("ended");
    expect(endResult.data.endedAt).not.toBeNull();
  });

  it("waiting → ended も可能", async () => {
    const { service } = makeService();
    const createResult = await service.createCall(creatorId, [inviteeId1], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const endResult = await service.endCall(roomId);

    expect(endResult.ok).toBe(true);
    if (!endResult.ok) return;
    expect(endResult.data.status).toBe("ended");
  });

  it("既に ended の room を endCall すると冪等で OK", async () => {
    const { service } = makeService();
    const createResult = await service.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const first = await service.endCall(roomId);
    expect(first.ok).toBe(true);

    const second = await service.endCall(roomId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.status).toBe("ended");
  });

  it("存在しない roomId は ROOM_NOT_FOUND", async () => {
    const { service } = makeService();
    const fakeRoomId = RoomIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-000000000000");
    const result = await service.endCall(fakeRoomId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("endCall 後に participants の left_at が設定される", async () => {
    const { service, participantRepo } = makeService();
    const createResult = await service.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await service.endCall(roomId);

    const participantsResult = await participantRepo.findByRoomId(roomId);
    expect(participantsResult.ok).toBe(true);
    if (!participantsResult.ok) return;

    for (const p of participantsResult.data) {
      expect(p.left_at).not.toBeNull();
    }
  });

  it("media.deleteRoom は best-effort — 失敗しても endCall は成功", async () => {
    const { service, media } = makeService();
    vi.mocked(media.deleteRoom).mockRejectedValue(new Error("LiveKit timeout"));

    const createResult = await service.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const endResult = await service.endCall(roomId);
    expect(endResult.ok).toBe(true);
  });

  it("room.participant_left イベントが参加者数分発行される", async () => {
    const { service, eventBus } = makeService();
    const createResult = await service.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    // room.created イベントをクリア
    eventBus.published.length = 0;

    await service.endCall(roomId);

    const leftEvents = eventBus.published.filter(
      (e) => (e as { type: string }).type === "room.participant_left",
    );
    // host 1 人分
    expect(leftEvents).toHaveLength(1);
  });
});
