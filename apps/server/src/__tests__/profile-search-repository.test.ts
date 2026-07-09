/**
 * ProfileSearchRepository (Supabase 実装) テスト (Issue #26)
 *
 * - `%` / `_` / `\` を含む検索クエリが ILIKE のワイルドカードとして解釈されず
 *   エスケープされることを検証する。
 * - trancall_auth.public_profiles VIEW (退会ユーザー除外済み) を参照していることを検証する。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProfileSearchRepository } from "../adapters/repositories/contact/profile-search-repository.supabase.js";

function makeSupabaseMock() {
  const ilikeMock = vi.fn();
  const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const eqMock = vi.fn();
  const selectMock = vi.fn();
  const fromMock = vi.fn();
  const schemaMock = vi.fn();

  ilikeMock.mockReturnValue({ limit: limitMock });
  eqMock.mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) });
  selectMock.mockReturnValue({ ilike: ilikeMock, eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
  schemaMock.mockReturnValue({ from: fromMock });

  const supabase = { schema: schemaMock } as unknown as SupabaseClient;
  return { supabase, schemaMock, fromMock, selectMock, ilikeMock, limitMock };
}

describe("ProfileSearchRepository.searchByDisplayName — ILIKE ワイルドカードエスケープ (#26)", () => {
  it("`%` を含むクエリはリテラルとしてエスケープされる (全件マッチを防ぐ)", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("%");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%\\%%");
  });

  it("`_` を含むクエリもエスケープされる", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("a_b");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%a\\_b%");
  });

  it("`\\` を含むクエリもエスケープされる", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("a\\b");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%a\\\\b%");
  });

  it("通常の英数字クエリはそのまま (エスケープなし) 前後に % を付けて渡される", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("tanaka");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%tanaka%");
  });

  it("trancall_auth.public_profiles VIEW を参照する (退会ユーザー除外 / 最小カラムのみ)", async () => {
    const { supabase, schemaMock, fromMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("tanaka");
    await repo.findByTrancallId("hori123");

    expect(schemaMock).toHaveBeenCalledWith("trancall_auth");
    expect(fromMock).toHaveBeenCalledWith("public_profiles");
    expect(fromMock).not.toHaveBeenCalledWith("profiles");
  });
});
