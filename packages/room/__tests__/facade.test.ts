/**
 * RoomFacade テスト
 *
 * facade 経由で createCall / joinCall / endCall / getState を呼んで
 * Result が正しく返るかを確認する統合テスト。
 */

import { describe, it, expect, vi } from "vitest";
import { RoomIdSchema, UserIdSchema } from "@trancall/shared-kernel";
import { ok } from "@trancall/shared-kernel";

import { createRoomFacade } from "../src/facade.js";
import { createInMemoryRoomRepository } from "./helpers/in-memory-room-repository.js";
import { createInMemoryParticipantRepository } from "./helpers/in-memory-participant-repository.js";
import {
  makeBillingFacade,
  makeMediaFacade,
  makeNotificationFacade,
  makeEventBus,
} from "./helpers/mock-facades.js";

const creatorId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440011");
const inviteeId = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440012");

// #52: createCall opts に追加された callerName/languagePair/callerLanguage は
// 呼び出し元 (server route) が auth/profile から解決して渡す想定のテスト用ダミー値
const TEST_CALLER_NAME = "テスト太郎";
const TEST_LANGUAGE_PAIR = "ja → en";
const TEST_CALLER_LANGUAGE = "ja";

function makeFacade(overrides?: {
  canStart?: boolean;
  createRoomOk?: boolean;
}) {
  const roomRepo = createInMemoryRoomRepository();
  const participantRepo = createInMemoryParticipantRepository();
  const billing = makeBillingFacade(overrides?.canStart ?? true);
  const media = makeMediaFacade(overrides?.createRoomOk ?? true);
  const notification = makeNotificationFacade();
  const eventBus = makeEventBus();

  const facade = createRoomFacade({
    roomRepo,
    participantRepo,
    billing,
    media,
    notification,
    eventBus,
  });

  return { facade, roomRepo, participantRepo, billing, media, notification, eventBus };
}

// =============================================================================
// createCall
// =============================================================================

describe("RoomFacade.createCall", () => {
  it("正常系: ok=true, RoomState を返す", async () => {
    const { facade } = makeFacade();
    const result = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("waiting");
    expect(result.data.translationEnabled).toBe(true);
    expect(result.data.participants).toHaveLength(1);
  });

  it("billing 失敗 → ok=false, code=BILLING_INSUFFICIENT_BALANCE", async () => {
    const { facade } = makeFacade({ canStart: false });
    const result = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_INSUFFICIENT_BALANCE");
  });

  it("media 失敗 → ok=false, code=ROOM_MEDIA_CREATE_FAILED", async () => {
    const { facade } = makeFacade({ createRoomOk: false });
    const result = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_MEDIA_CREATE_FAILED");
  });

  it("billing.canStartCall が呼ばれる", async () => {
    const { facade, billing } = makeFacade();
    await facade.createCall(creatorId, [], { translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE, });
    expect(billing.canStartCall).toHaveBeenCalledWith(creatorId);
  });

  it("media.createRoom が呼ばれる", async () => {
    const { facade, media } = makeFacade();
    await facade.createCall(creatorId, [], { translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE, });
    expect(media.createRoom).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// joinCall
// =============================================================================

describe("RoomFacade.joinCall", () => {
  it("正常系: waiting → active", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const joinResult = await facade.joinCall(roomId, inviteeId);

    expect(joinResult.ok).toBe(true);
    if (!joinResult.ok) return;
    expect(joinResult.data.status).toBe("active");
    expect(joinResult.data.participants).toHaveLength(2);
  });

  it("ended room に join → ROOM_ALREADY_ENDED", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await facade.endCall(roomId);

    const joinResult = await facade.joinCall(roomId, inviteeId);
    expect(joinResult.ok).toBe(false);
    if (joinResult.ok) return;
    expect(joinResult.error.code).toBe("ROOM_ALREADY_ENDED");
  });

  it("存在しない room に join → ROOM_NOT_FOUND", async () => {
    const { facade } = makeFacade();
    const fakeRoomId = RoomIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-000000000001");

    const result = await facade.joinCall(fakeRoomId, inviteeId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });
});

// =============================================================================
// endCall
// =============================================================================

describe("RoomFacade.endCall", () => {
  it("正常系: ok=true, status='ended'", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const endResult = await facade.endCall(roomId);

    expect(endResult.ok).toBe(true);
    if (!endResult.ok) return;
    expect(endResult.data.status).toBe("ended");
  });

  it("冪等: 2 回 endCall しても ok", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await facade.endCall(roomId);
    const second = await facade.endCall(roomId);

    expect(second.ok).toBe(true);
  });

  it("存在しない room → ROOM_NOT_FOUND", async () => {
    const { facade } = makeFacade();
    const fakeRoomId = RoomIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-000000000002");

    const result = await facade.endCall(fakeRoomId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("media.deleteRoom が呼ばれる", async () => {
    const { facade, media } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await facade.endCall(roomId);

    expect(media.deleteRoom).toHaveBeenCalledWith(roomId);
  });
});

// =============================================================================
// getState
// =============================================================================

describe("RoomFacade.getState", () => {
  it("正常系: RoomState が返る", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    const stateResult = await facade.getState(roomId);

    expect(stateResult.ok).toBe(true);
    if (!stateResult.ok) return;
    expect(stateResult.data.roomId).toBe(roomId);
    expect(stateResult.data.status).toBe("waiting");
    expect(stateResult.data.translationEnabled).toBe(true);
  });

  it("존재しない room → ROOM_NOT_FOUND", async () => {
    const { facade } = makeFacade();
    const fakeRoomId = RoomIdSchema.parse("aaaaaaaa-bbbb-4ccc-8ddd-000000000003");

    const result = await facade.getState(fakeRoomId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("joinCall 後に getState を呼ぶと participants が反映される", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await facade.joinCall(roomId, inviteeId);

    const stateResult = await facade.getState(roomId);
    expect(stateResult.ok).toBe(true);
    if (!stateResult.ok) return;
    expect(stateResult.data.participants).toHaveLength(2);
    expect(stateResult.data.status).toBe("active");
  });

  it("endCall 後の getState は status='ended'", async () => {
    const { facade } = makeFacade();

    const createResult = await facade.createCall(creatorId, [], {
      translationEnabled: false, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const roomId = createResult.data.roomId;
    await facade.endCall(roomId);

    const stateResult = await facade.getState(roomId);
    expect(stateResult.ok).toBe(true);
    if (!stateResult.ok) return;
    expect(stateResult.data.status).toBe("ended");
    expect(stateResult.data.endedAt).not.toBeNull();
  });

  it("全ライフサイクル: createCall → joinCall → endCall → getState", async () => {
    const { facade } = makeFacade();

    // 1. create
    const createResult = await facade.createCall(creatorId, [inviteeId], {
      translationEnabled: true, callerName: TEST_CALLER_NAME, languagePair: TEST_LANGUAGE_PAIR, callerLanguage: TEST_CALLER_LANGUAGE,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const roomId = createResult.data.roomId;

    // 2. join
    const joinResult = await facade.joinCall(roomId, inviteeId);
    expect(joinResult.ok).toBe(true);
    if (!joinResult.ok) return;
    expect(joinResult.data.status).toBe("active");

    // 3. end
    const endResult = await facade.endCall(roomId);
    expect(endResult.ok).toBe(true);

    // 4. getState
    const stateResult = await facade.getState(roomId);
    expect(stateResult.ok).toBe(true);
    if (!stateResult.ok) return;
    expect(stateResult.data.status).toBe("ended");
    expect(stateResult.data.participants).toHaveLength(2);
    for (const p of stateResult.data.participants) {
      expect(p.leftAt).not.toBeNull();
    }
  });
});
