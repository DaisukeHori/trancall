/**
 * ProfileRepository (Supabase 実装) テスト (Issue #79)
 *
 * `trancall_auth.profiles` に存在しない `email` 列を SELECT していたため
 * findByUserId が常に失敗していた問題の修正確認。
 * 修正後は profiles からは email を SELECT せず、
 * `supabase.auth.admin.getUserById()` (auth.users) から email を取得して合成する。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProfileRepository } from "../adapters/repositories/auth/profile-repository.supabase.js";
import type { UserId } from "@trancall/shared-kernel";

const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    display_name: "田中太郎",
    native_language: "ja",
    trancall_id: "tanaka_123",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSupabaseMock(params: {
  profileResult: { data: unknown; error: { code?: string; message: string } | null };
  getUserByIdResult?: {
    data: { user: { email?: string } | null };
    error: { message: string } | null;
  };
}) {
  const singleMock = vi.fn().mockResolvedValue(params.profileResult);
  const eqMock = vi.fn().mockReturnValue({ single: singleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });

  const getUserByIdMock = vi.fn().mockResolvedValue(
    params.getUserByIdResult ?? {
      data: { user: { email: "tanaka@example.com" } },
      error: null,
    },
  );

  const supabase = {
    schema: schemaMock,
    auth: { admin: { getUserById: getUserByIdMock } },
  } as unknown as SupabaseClient;

  return { supabase, selectMock, eqMock, getUserByIdMock };
}

describe("ProfileRepository (Supabase) — email 列不在バグの修正確認 (#79)", () => {
  it("profiles の SELECT には email 列を含めない (存在しない列を要求しない)", async () => {
    const { supabase, selectMock } = makeSupabaseMock({
      profileResult: { data: makeProfileRow(), error: null },
    });
    const repo = createProfileRepository(supabase);

    await repo.findByUserId(USER_ID);

    expect(selectMock).toHaveBeenCalledOnce();
    const selectArg = selectMock.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/\bemail\b/);
  });

  it("profiles 行 + auth.users の email を合成して正常な Profile を返す (GET /api/auth/profile 500 の再現解消)", async () => {
    const { supabase, getUserByIdMock } = makeSupabaseMock({
      profileResult: { data: makeProfileRow(), error: null },
    });
    const repo = createProfileRepository(supabase);

    const result = await repo.findByUserId(USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      userId: USER_ID,
      email: "tanaka@example.com",
      displayName: "田中太郎",
      nativeLanguage: "ja",
      trancallId: "tanaka_123",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(getUserByIdMock).toHaveBeenCalledWith(USER_ID);
  });

  it("profiles 行が見つからない場合 (PGRST116) は AUTH_PROFILE_NOT_FOUND を返す", async () => {
    const { supabase } = makeSupabaseMock({
      profileResult: { data: null, error: { code: "PGRST116", message: "No rows found" } },
    });
    const repo = createProfileRepository(supabase);

    const result = await repo.findByUserId(USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_PROFILE_NOT_FOUND");
  });

  it("profiles SELECT が他のエラー (例: 未知の列) を返した場合は INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeSupabaseMock({
      profileResult: {
        data: null,
        error: { code: "42703", message: "column profiles.email does not exist" },
      },
    });
    const repo = createProfileRepository(supabase);

    const result = await repo.findByUserId(USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.retryable).toBe(true);
  });

  it("auth.admin.getUserById がエラーを返した場合は INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeSupabaseMock({
      profileResult: { data: makeProfileRow(), error: null },
      getUserByIdResult: { data: { user: null }, error: { message: "user not found" } },
    });
    const repo = createProfileRepository(supabase);

    const result = await repo.findByUserId(USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("auth.users に email が設定されていない場合は INTERNAL_ERROR を返す (ProfileSchema の email 必須制約)", async () => {
    const { supabase } = makeSupabaseMock({
      profileResult: { data: makeProfileRow(), error: null },
      getUserByIdResult: { data: { user: {} }, error: null },
    });
    const repo = createProfileRepository(supabase);

    const result = await repo.findByUserId(USER_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
