/**
 * RoomHistoryEnrichmentRepository (Supabase 実装) テスト (L-13)
 *
 * - getProfile: trancall_auth.public_profiles VIEW を参照する (auth 所有テーブルへの直接
 *   read-only view、profile-search-repository.supabase.ts と同型パターン)
 * - getCostYen: trancall_billing.usage_windows の amount_yen を room_id/user_id で SUM する
 * - hasTranscript: 注入済みの transcript AccessRepository.canView() をそのまま再利用する
 *   (新規のテーブル直読みを増やさない)
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessRepository } from "@trancall/transcript";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import { ok } from "@trancall/shared-kernel";
import { createRoomHistoryEnrichmentRepository } from "../adapters/repositories/room/room-history-enrichment-repository.supabase.js";

const ROOM_ID = "22222222-2222-4222-8222-222222222222" as RoomId;
const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;

/**
 * 実際の supabase-js クエリビルダーはチェーン可能かつ thenable (await で直接解決可能)。
 * 本モックは eq/select/from/schema すべてが自身を返す (チェーン可能) と同時に
 * `.then` も実装し、maybeSingle() を挟まないクエリ (getCostYen) もそのまま await できる。
 */
function makeSupabaseMock(resolved: { data: unknown; error: unknown }) {
  const maybeSingleMock = vi.fn().mockResolvedValue(resolved);

  const chain: Record<string, unknown> = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: maybeSingleMock,
    then: (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
    ) => Promise.resolve(resolved).then(onFulfilled),
  };
  (chain["eq"] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain["select"] as ReturnType<typeof vi.fn>).mockReturnValue(chain);

  const fromMock = vi.fn().mockReturnValue(chain);
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });

  const supabase = { schema: schemaMock } as unknown as SupabaseClient;
  return {
    supabase,
    schemaMock,
    fromMock,
    selectMock: chain["select"] as ReturnType<typeof vi.fn>,
    eqMock: chain["eq"] as ReturnType<typeof vi.fn>,
    maybeSingleMock,
  };
}

function makeAccessRepo(canView: boolean) {
  const canViewMock = vi.fn().mockResolvedValue(ok(canView));
  const accessRepo: AccessRepository = {
    canView: canViewMock,
    softDelete: vi.fn(),
    findOne: vi.fn(),
    grant: vi.fn(),
  };
  return { accessRepo, canViewMock };
}

describe("RoomHistoryEnrichmentRepository.getProfile", () => {
  it("trancall_auth.public_profiles VIEW を参照する", async () => {
    const { supabase, schemaMock, fromMock } = makeSupabaseMock({
      data: { display_name: "山田太郎", trancall_id: "@yamada", avatar_url: null },
      error: null,
    });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    await repo.getProfile(USER_ID);

    expect(schemaMock).toHaveBeenCalledWith("trancall_auth");
    expect(fromMock).toHaveBeenCalledWith("public_profiles");
  });

  it("見つかった行を RoomHistoryParticipantProfile に変換する", async () => {
    const { supabase } = makeSupabaseMock({
      data: { display_name: "山田太郎", trancall_id: "@yamada", avatar_url: "https://x/a.png" },
      error: null,
    });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getProfile(USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      displayName: "山田太郎",
      trancallId: "@yamada",
      avatarUrl: "https://x/a.png",
    });
  });

  it("行が見つからない場合 data: null を返す (エラーにしない)", async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: null });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getProfile(USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("Supabase エラー時は INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: { message: "boom" } });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getProfile(USER_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("RoomHistoryEnrichmentRepository.getCostYen", () => {
  it("trancall_billing.usage_windows を room_id/user_id で絞り込む", async () => {
    const { supabase, schemaMock, fromMock, eqMock } = makeSupabaseMock({
      data: [{ amount_yen: 50 }, { amount_yen: 70 }],
      error: null,
    });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getCostYen(ROOM_ID, USER_ID);

    expect(schemaMock).toHaveBeenCalledWith("trancall_billing");
    expect(fromMock).toHaveBeenCalledWith("usage_windows");
    expect(eqMock).toHaveBeenCalledWith("room_id", ROOM_ID);
    expect(eqMock).toHaveBeenCalledWith("user_id", USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(120);
  });

  it("行が 0 件なら 0 を返す", async () => {
    const { supabase } = makeSupabaseMock({ data: [], error: null });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getCostYen(ROOM_ID, USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(0);
  });

  it("Supabase エラー時は INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: { message: "boom" } });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.getCostYen(ROOM_ID, USER_ID);
    expect(result.ok).toBe(false);
  });
});

describe("RoomHistoryEnrichmentRepository.hasTranscript", () => {
  it("注入済みの transcript AccessRepository.canView をそのまま呼ぶ", async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: null });
    const { accessRepo, canViewMock } = makeAccessRepo(true);
    const repo = createRoomHistoryEnrichmentRepository(supabase, accessRepo);

    const result = await repo.hasTranscript(ROOM_ID, USER_ID);

    expect(canViewMock).toHaveBeenCalledWith(ROOM_ID, USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(true);
  });

  it("can_view=false の場合 false を返す", async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: null });
    const repo = createRoomHistoryEnrichmentRepository(supabase, makeAccessRepo(false).accessRepo);

    const result = await repo.hasTranscript(ROOM_ID, USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(false);
  });
});
