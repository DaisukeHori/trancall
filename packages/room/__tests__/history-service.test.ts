/**
 * history-service テスト (L-13)
 *
 * docs/api-spec.md GET /api/rooms/history 準拠。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { ok } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import { UserIdSchema, RoomIdSchema } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";

import { createHistoryService } from "../src/services/history-service.js";
import { createInMemoryRoomRepository } from "./helpers/in-memory-room-repository.js";
import { createInMemoryParticipantRepository } from "./helpers/in-memory-participant-repository.js";
import type { RoomHistoryEnrichmentRepository } from "../src/repositories/room-history-enrichment-repository.js";
import type { RoomRow, ParticipantRow } from "../src/schemas.js";

const USER_A = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
const USER_B = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440002");
const USER_C = UserIdSchema.parse("550e8400-e29b-41d4-a716-446655440003");

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeBillingFacade(tier: "free" | "light" | "standard" | "business" = "free"): BillingFacade {
  return {
    canStartCall: vi.fn(),
    reserveMinutes: vi.fn(),
    reconcile: vi.fn(),
    refundMinutes: vi.fn(),
    getSubscription: vi.fn().mockResolvedValue(
      ok({
        userId: USER_A,
        plan: {
          tier,
          includedMinutes: 0,
          overageRateYen: 0,
          monthlyPriceYen: 0,
          transcriptRetentionDays: 7,
        },
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date().toISOString(),
        usedMinutes: 0,
        remainingMinutes: 0,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        iapOriginalTransactionId: null,
        iapPlatform: null,
      }),
    ),
    recordUsage: vi.fn(),
    createCheckoutSession: vi.fn(),
    handleStripeWebhook: vi.fn(),
    handleAppleIapWebhook: vi.fn(),
    handleGoogleIapWebhook: vi.fn(),
  };
}

/**
 * room + host/member 参加者行を直接 store に投入する (insert()/upsert() 経由だと
 * ended_at / room_type / joined_at を細かく制御できないため)。
 */
function seedEndedRoom(
  roomRepo: ReturnType<typeof createInMemoryRoomRepository>,
  participantRepo: ReturnType<typeof createInMemoryParticipantRepository>,
  opts: {
    roomId?: string;
    roomType?: "audio" | "video";
    translationEnabled?: boolean;
    createdAt: string;
    endedAt: string;
    participants: { userId: UserId; role: "host" | "member"; joined?: boolean }[];
  },
): string {
  const roomId = opts.roomId ?? randomUUID();
  const room: RoomRow = {
    room_id: roomId,
    status: "ended",
    room_type: opts.roomType ?? "audio",
    translation_enabled: opts.translationEnabled ?? true,
    created_by: opts.participants[0]?.userId ?? USER_A,
    created_at: opts.createdAt,
    ended_at: opts.endedAt,
  };
  roomRepo._store.set(roomId, room);

  for (const p of opts.participants) {
    const key = `${roomId}:${p.userId}`;
    const row: ParticipantRow = {
      id: randomUUID(),
      room_id: roomId,
      user_id: p.userId,
      role: p.role,
      is_muted: false,
      joined_at: p.joined === false ? null : opts.createdAt,
      left_at: opts.endedAt,
    };
    participantRepo._store.set(key, row);
  }

  return roomId;
}

function wireParticipantLookup(
  roomRepo: ReturnType<typeof createInMemoryRoomRepository>,
  participantRepo: ReturnType<typeof createInMemoryParticipantRepository>,
): void {
  roomRepo._setParticipantLookup((userId: UserId) => {
    const roomIds: string[] = [];
    for (const row of participantRepo._store.values()) {
      if (row.user_id === userId && row.joined_at !== null) {
        roomIds.push(row.room_id);
      }
    }
    return roomIds;
  });
}

function makeService(billing: BillingFacade, enrichmentRepo?: RoomHistoryEnrichmentRepository) {
  const roomRepo = createInMemoryRoomRepository();
  const participantRepo = createInMemoryParticipantRepository();
  wireParticipantLookup(roomRepo, participantRepo);
  const service = createHistoryService({
    roomRepo,
    participantRepo,
    billing,
    ...(enrichmentRepo ? { historyEnrichmentRepo: enrichmentRepo } : {}),
  });
  return { service, roomRepo, participantRepo };
}

describe("HistoryService.getRoomHistory", () => {
  it("参加履歴がなければ空配列を返す", async () => {
    const { service } = makeService(makeBillingFacade());
    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toEqual([]);
    expect(result.data.nextCursor).toBeNull();
  });

  it("ended room を含み、参加者・myRole・durationSeconds を正しく組み立てる", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    const createdAt = isoDaysAgo(2);
    const endedAt = new Date(new Date(createdAt).getTime() + 300_000).toISOString(); // +5min
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt,
      endedAt,
      participants: [
        { userId: USER_A, role: "host" },
        { userId: USER_B, role: "member" },
      ],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(1);
    const entry = result.data.rooms[0];
    expect(entry?.status).toBe("ended");
    expect(entry?.myRole).toBe("host");
    expect(entry?.durationSeconds).toBe(300);
    expect(entry?.participants).toHaveLength(2);
    expect(entry?.participants.some((p) => p.userId === USER_A && p.isHost)).toBe(true);
    expect(entry?.participants.some((p) => p.userId === USER_B && !p.isHost)).toBe(true);
  });

  it("自分が member の room は myRole='member' になる", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(1),
      endedAt: isoDaysAgo(1),
      participants: [
        { userId: USER_B, role: "host" },
        { userId: USER_A, role: "member" },
      ],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms[0]?.myRole).toBe("member");
  });

  it("status='ended' 以外 (waiting/active) の room は含まれない", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    const roomId = randomUUID();
    roomRepo._store.set(roomId, {
      room_id: roomId,
      status: "active",
      room_type: "audio",
      translation_enabled: true,
      created_by: USER_A,
      created_at: isoDaysAgo(1),
      ended_at: null,
    });
    participantRepo._store.set(`${roomId}:${USER_A}`, {
      id: randomUUID(),
      room_id: roomId,
      user_id: USER_A,
      role: "host",
      is_muted: false,
      joined_at: isoDaysAgo(1),
      left_at: null,
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toEqual([]);
  });

  it("自分が招待されただけで参加していない (joined_at=null) room は含まれない", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(1),
      endedAt: isoDaysAgo(1),
      participants: [
        { userId: USER_B, role: "host" },
        { userId: USER_A, role: "member", joined: false },
      ],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toEqual([]);
  });

  it("他人が参加した room は自分の履歴に含まれない", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(1),
      endedAt: isoDaysAgo(1),
      participants: [
        { userId: USER_B, role: "host" },
        { userId: USER_C, role: "member" },
      ],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toEqual([]);
  });

  it("startedAt (created_at) 降順でソートされる", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(5),
      endedAt: isoDaysAgo(5),
      participants: [{ userId: USER_A, role: "host" }],
    });
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(1),
      endedAt: isoDaysAgo(1),
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(2);
    expect(new Date(result.data.rooms[0]?.startedAt ?? 0).getTime()).toBeGreaterThan(
      new Date(result.data.rooms[1]?.startedAt ?? 0).getTime(),
    );
  });

  it("limit を超える件数がある場合 nextCursor が最古 entry の startedAt になる", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    for (let i = 0; i < 3; i++) {
      seedEndedRoom(roomRepo, participantRepo, {
        createdAt: isoDaysAgo(i + 1),
        endedAt: isoDaysAgo(i + 1),
        participants: [{ userId: USER_A, role: "host" }],
      });
    }

    const result = await service.getRoomHistory(USER_A, { limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(2);
    expect(result.data.nextCursor).toBe(result.data.rooms[1]?.startedAt);
  });

  it("件数が limit 未満の場合 nextCursor は null", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(1),
      endedAt: isoDaysAgo(1),
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextCursor).toBeNull();
  });

  it("before カーソルより新しい room は除外される", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
    const older = isoDaysAgo(10);
    const newer = isoDaysAgo(1);
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: older,
      endedAt: older,
      participants: [{ userId: USER_A, role: "host" }],
    });
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: newer,
      endedAt: newer,
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20, before: isoDaysAgo(5) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(1);
    expect(result.data.rooms[0]?.startedAt).toBe(older);
  });

  it("free プランは 90 日超の room を履歴から除外する", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade("free"));
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(100),
      endedAt: isoDaysAgo(100),
      participants: [{ userId: USER_A, role: "host" }],
    });
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(10),
      endedAt: isoDaysAgo(10),
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(1);
  });

  it("business プランは 100 日前の room も履歴に含める (365 日ウィンドウ)", async () => {
    const { service, roomRepo, participantRepo } = makeService(makeBillingFacade("business"));
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(100),
      endedAt: isoDaysAgo(100),
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(1);
  });

  it("billing.getSubscription が失敗しても既定 90 日ウィンドウで継続する (best-effort)", async () => {
    const billing = makeBillingFacade();
    billing.getSubscription = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "boom", retryable: true },
    });
    const { service, roomRepo, participantRepo } = makeService(billing);
    seedEndedRoom(roomRepo, participantRepo, {
      createdAt: isoDaysAgo(10),
      endedAt: isoDaysAgo(10),
      participants: [{ userId: USER_A, role: "host" }],
    });

    const result = await service.getRoomHistory(USER_A, { limit: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rooms).toHaveLength(1);
  });

  describe("historyEnrichmentRepo 未注入時のフォールバック", () => {
    it("costYen=0 / hasTranscript=false / displayName='Unknown' になる", async () => {
      const { service, roomRepo, participantRepo } = makeService(makeBillingFacade());
      seedEndedRoom(roomRepo, participantRepo, {
        createdAt: isoDaysAgo(1),
        endedAt: isoDaysAgo(1),
        participants: [{ userId: USER_A, role: "host" }],
      });

      const result = await service.getRoomHistory(USER_A, { limit: 20 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const entry = result.data.rooms[0];
      expect(entry?.costYen).toBe(0);
      expect(entry?.hasTranscript).toBe(false);
      expect(entry?.participants[0]?.displayName).toBe("Unknown");
      expect(entry?.participants[0]?.trancallId).toBe("@unknown");
    });
  });

  describe("historyEnrichmentRepo 注入時", () => {
    it("プロフィール/costYen/hasTranscript が enrichment repo の値になる", async () => {
      const enrichmentRepo: RoomHistoryEnrichmentRepository = {
        getProfile: vi.fn().mockResolvedValue(
          ok({ displayName: "山田太郎", trancallId: "@yamada", avatarUrl: "https://example.com/a.png" }),
        ),
        getCostYen: vi.fn().mockResolvedValue(ok(120)),
        hasTranscript: vi.fn().mockResolvedValue(ok(true)),
      };
      const { service, roomRepo, participantRepo } = makeService(makeBillingFacade(), enrichmentRepo);
      const roomId = seedEndedRoom(roomRepo, participantRepo, {
        createdAt: isoDaysAgo(1),
        endedAt: isoDaysAgo(1),
        participants: [{ userId: USER_A, role: "host" }],
      });

      const result = await service.getRoomHistory(USER_A, { limit: 20 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const entry = result.data.rooms[0];
      expect(entry?.costYen).toBe(120);
      expect(entry?.hasTranscript).toBe(true);
      expect(entry?.participants[0]?.displayName).toBe("山田太郎");
      expect(entry?.participants[0]?.trancallId).toBe("@yamada");
      expect(enrichmentRepo.getCostYen).toHaveBeenCalledWith(
        RoomIdSchema.parse(roomId),
        USER_A,
      );
    });

    it("enrichment repo がエラーを返しても best-effort でフォールバックする", async () => {
      const enrichmentRepo: RoomHistoryEnrichmentRepository = {
        getProfile: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "boom", retryable: true },
        }),
        getCostYen: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "boom", retryable: true },
        }),
        hasTranscript: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "boom", retryable: true },
        }),
      };
      const { service, roomRepo, participantRepo } = makeService(makeBillingFacade(), enrichmentRepo);
      seedEndedRoom(roomRepo, participantRepo, {
        createdAt: isoDaysAgo(1),
        endedAt: isoDaysAgo(1),
        participants: [{ userId: USER_A, role: "host" }],
      });

      const result = await service.getRoomHistory(USER_A, { limit: 20 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const entry = result.data.rooms[0];
      expect(entry?.costYen).toBe(0);
      expect(entry?.hasTranscript).toBe(false);
      expect(entry?.participants[0]?.displayName).toBe("Unknown");
    });
  });
});
