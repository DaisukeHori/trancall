/**
 * 通話エンドポイントテスト
 */

/* eslint-disable @typescript-eslint/unbound-method --
 * vi.mocked(container.X.Y) は vitest の定番パターンだが、typescript-eslint の
 * unbound-method は「メソッド参照を this なしで渡している」と誤検知する
 * (vi.mocked は呼び出さず型情報のみラップするため実害なし)。ファイル全体で無効化する。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/test-app.js";
import { createMockContainer } from "./helpers/mock-container.js";
import {
  MOCK_ROOM_ID,
  MOCK_USER_ID,
  MOCK_OTHER_USER_ID,
  MOCK_PARTICIPANT_ID,
} from "./helpers/mock-container.js";
import type { AppContainer } from "../container.js";
import { ok } from "@trancall/shared-kernel";
import type { RoomState } from "@trancall/room";

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

let app: FastifyInstance;
let container: AppContainer;

beforeAll(async () => {
  container = createMockContainer();
  app = await buildTestApp(container);
});

afterAll(async () => {
  await app.close();
});

/** #43 テスト用: MOCK_USER_ID (認証済みユーザー) を含まない RoomState */
function makeOtherParticipantRoomState(): RoomState {
  return {
    roomId: MOCK_ROOM_ID,
    status: "waiting",
    translationEnabled: true,
    createdBy: MOCK_OTHER_USER_ID,
    createdAt: new Date().toISOString(),
    endedAt: null,
    participants: [
      {
        id: MOCK_PARTICIPANT_ID,
        userId: MOCK_OTHER_USER_ID,
        role: "host",
        isMuted: false,
        joinedAt: new Date().toISOString(),
        leftAt: null,
      },
    ],
  };
}

describe("POST /api/rooms", () => {
  it("通話を作成できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { ok: boolean; data: { roomId: string } };
    expect(body.ok).toBe(true);
    expect(body.data.roomId).toBeDefined();
  });

  it("inviteeIds が空だと 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: [],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("無効な UUID を inviteeIds に含むと 400 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["not-a-uuid"],
        translationEnabled: false,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("認証なしで 401 を返す", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
      },
    });

    expect(response.statusCode).toBe(401);
  });

  // #52: 着信 Push の callerName/languagePair/callerLanguage を auth.getProfile から解決する
  it("#52: auth.getProfile から callerName/languagePair を解決して notification に渡す (UUID をそのまま渡さない)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(vi.mocked(container.auth.getProfile)).toHaveBeenCalled();

    // room.createCall(creatorId, inviteeIds, opts) の第 3 引数 (CreateCallOptions) を検証する。
    // container.room はここでは facade 全体がモックのため、実際に notification.sendIncomingCall
    // を呼ぶのは packages/room 内部 (call-lifecycle-service.ts) の責務であり、server 層の責務は
    // 「正しい CreateCallOptions を room.createCall に渡すこと」までである。
    const createCallMock = vi.mocked(container.room.createCall);
    const lastCall = createCallMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const opts = lastCall?.[2];
    expect(opts).toBeDefined();

    // callerName は Profile.displayName ("Test User"、mock-container.ts の auth.getProfile 参照)
    // であり、発信者の生 UUID (MOCK_USER_ID) ではない
    expect(opts?.callerName).toBe("Test User");
    expect(opts?.callerName).not.toBe(MOCK_USER_ID);
    expect(opts?.callerLanguage).toBe("ja");
    expect(opts?.languagePair.length).toBeGreaterThan(0);
    expect(opts?.languagePair).toContain("-");
  });

  // 2巡目 finding1/4 二重防御 (#2): inviteeIds に自分自身 (認証済みユーザー) を含む
  // リクエストは room.createCall を呼ぶ前に 400 で拒否される。
  it("2巡目 finding1/4: inviteeIds に自分自身 (creatorId) を含むと 400 を返し room.createCall を呼ばない", async () => {
    const createCallMock = vi.mocked(container.room.createCall);
    createCallMock.mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: [MOCK_USER_ID, "11011011-0110-4110-8110-110110110110"],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createCallMock).not.toHaveBeenCalled();
  });

  // 2巡目 finding1/4 二重防御 (#2): inviteeIds に重複がある場合もスキーマの refine で 400。
  it("2巡目 finding1/4: inviteeIds に重複があると 400 を返す", async () => {
    const createCallMock = vi.mocked(container.room.createCall);
    createCallMock.mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: [
          "11011011-0110-4110-8110-110110110110",
          "11011011-0110-4110-8110-110110110110",
        ],
        translationEnabled: true,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createCallMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/rooms/:id", () => {
  it("Room 状態を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/rooms/${MOCK_ROOM_ID}`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { roomId: string } };
    expect(body.ok).toBe(true);
  });

  it("無効な UUID で 400 を返す", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/rooms/invalid-id",
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(400);
  });

  // #43: room の参加者でないユーザーは 403
  it("#43: room の参加者でない場合は 403 を返す", async () => {
    vi.mocked(container.room.getState).mockResolvedValueOnce(ok(makeOtherParticipantRoomState()));

    const response = await app.inject({
      method: "GET",
      url: `/api/rooms/${MOCK_ROOM_ID}`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/rooms/:id/join", () => {
  it("通話に参加できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/join`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { status: string } };
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/rooms/:id/leave", () => {
  it("通話を終了できる", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/leave`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { status: string } };
    expect(body.ok).toBe(true);
  });

  // #43: room の参加者でないユーザーは終話不可
  it("#43: room の参加者でない場合は 403 を返す (endCall は呼ばれない)", async () => {
    vi.mocked(container.room.getState).mockResolvedValueOnce(ok(makeOtherParticipantRoomState()));
    const endCallMock = vi.mocked(container.room.endCall);
    const callsBefore = endCallMock.mock.calls.length;

    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/leave`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(403);
    expect(endCallMock.mock.calls.length).toBe(callsBefore);
  });

  // #53: 予約時に生成した sessionId (roomId とは別の値) で reconcile されること
  it("#53: 作成時に予約した sessionId で reconcile する (roomId をそのまま sessionId に使わない)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: AUTH_HEADER,
      payload: {
        inviteeIds: ["11011011-0110-4110-8110-110110110110"],
        translationEnabled: true,
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const reserveMock = vi.mocked(container.billing.reserveMinutes);
    const reserveCall = reserveMock.mock.calls.at(-1);
    expect(reserveCall).toBeDefined();
    const reservedSessionId = reserveCall?.[1];
    expect(reservedSessionId).toBeDefined();
    // sessionId は roomId とは異なる独立した UUID であること (#53 の核心)
    expect(reservedSessionId).not.toBe(MOCK_ROOM_ID);

    const leaveResponse = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/leave`,
      headers: AUTH_HEADER,
    });
    expect(leaveResponse.statusCode).toBe(200);

    const reconcileMock = vi.mocked(container.billing.reconcile);
    const reconcileCall = reconcileMock.mock.calls.at(-1);
    expect(reconcileCall).toBeDefined();
    // #53 修正前は roomId がそのまま sessionId として渡され、予約時の sessionId と
    // 一致しないため reconcile が対象レコードなしで実質失敗していた。
    expect(reconcileCall?.[1]).toBe(reservedSessionId);
  });
});

describe("POST /api/rooms/:id/token", () => {
  it("Token を発行できる (host は role=caller)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/token`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(200);
    const issueTokenMock = vi.mocked(container.media.issueAccessToken);
    const lastCall = issueTokenMock.mock.calls.at(-1);
    const requestArg = lastCall?.[0] as { role: string; userId: string };
    expect(requestArg.role).toBe("caller");
    expect(requestArg.userId).toBe(MOCK_USER_ID);
  });

  // #43: body の userId は無視し、常に認証済みユーザー自身の Token を発行する
  it("#43: body に他人の userId を送っても無視され、自分の Token が発行される", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/token`,
      headers: AUTH_HEADER,
      payload: { userId: MOCK_OTHER_USER_ID },
    });

    expect(response.statusCode).toBe(200);
    const issueTokenMock = vi.mocked(container.media.issueAccessToken);
    const lastCall = issueTokenMock.mock.calls.at(-1);
    const requestArg = lastCall?.[0] as { userId: string };
    expect(requestArg.userId).toBe(MOCK_USER_ID);
    expect(requestArg.userId).not.toBe(MOCK_OTHER_USER_ID);
  });

  // #43: room の参加者でないユーザーは Token 発行不可
  it("#43: room の参加者でない場合は 403 を返す", async () => {
    vi.mocked(container.room.getState).mockResolvedValueOnce(ok(makeOtherParticipantRoomState()));

    const response = await app.inject({
      method: "POST",
      url: `/api/rooms/${MOCK_ROOM_ID}/token`,
      headers: AUTH_HEADER,
    });

    expect(response.statusCode).toBe(403);
  });
});
