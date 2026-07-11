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
  // 実際の supabase-js クエリビルダーに合わせ、フィルタ系メソッド (eq/ilike) は
  // すべて同一のチェーン可能オブジェクトを返し、終端メソッド (limit/maybeSingle) のみ
  // Promise を解決する (Issue #64: searchByDisplayName が `.eq("is_searchable", true)`
  // → `.ilike(...)` → `.limit(...)` の順でチェーンするため、eq の戻り値にも ilike が
  // 必要になった)。
  const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });

  const chain = {
    eq: vi.fn(),
    ilike: vi.fn(),
    limit: limitMock,
    maybeSingle: maybeSingleMock,
  };
  chain.eq.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);

  const selectMock = vi.fn().mockReturnValue(chain);
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });

  const supabase = { schema: schemaMock } as unknown as SupabaseClient;
  return {
    supabase,
    schemaMock,
    fromMock,
    selectMock,
    eqMock: chain.eq,
    ilikeMock: chain.ilike,
    limitMock,
    maybeSingleMock,
  };
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

  // 確定#3: PostgREST は ilike パターン中の `*` を `%` の別名として解釈するため、
  // `\%` `\_` `\\` のエスケープだけでは `q=*` が全件マッチしてしまっていた。
  it("`*` を含むクエリもエスケープされる (PostgREST の % 別名対策、確定#3)", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("*");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%\\*%");
  });

  it("`*` を含む複合クエリもエスケープされる", async () => {
    const { supabase, ilikeMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("a*b");

    expect(ilikeMock).toHaveBeenCalledWith("display_name", "%a\\*b%");
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

describe("ProfileSearchRepository — opt-in 検索フラグ (Issue #64)", () => {
  it("searchByDisplayName は is_searchable=true の WHERE 条件を付与する", async () => {
    const { supabase, eqMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.searchByDisplayName("tanaka");

    expect(eqMock).toHaveBeenCalledWith("is_searchable", true);
  });

  it("findByTrancallId は is_searchable でフィルタしない (完全一致検索は opt-in 対象外)", async () => {
    const { supabase, eqMock } = makeSupabaseMock();
    const repo = createProfileSearchRepository(supabase);

    await repo.findByTrancallId("hori123");

    // trancall_id での完全一致検索のみ (is_searchable は渡さない)
    expect(eqMock).toHaveBeenCalledWith("trancall_id", "hori123");
    expect(eqMock).not.toHaveBeenCalledWith("is_searchable", expect.anything());
  });
});
