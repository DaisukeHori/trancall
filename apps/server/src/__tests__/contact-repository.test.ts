/**
 * ContactRepository (Supabase 実装) テスト [Issue #72.2]
 *
 * list() が DB エラー時に空配列を返して呼び出し元がエラーを検知できなくなっていた
 * 問題を修正し、Result<ContactEntry[]> でエラーを伝播することを検証する。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContactRepository } from "../adapters/repositories/contact/contact-repository.supabase.js";
import { brandUserId } from "@trancall/shared-kernel";

const USER_ID = brandUserId("11111111-1111-4111-8111-111111111111");
if (!USER_ID.success) throw new Error("test setup: brandUserId failed");

function makeSupabaseMock(params: {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}) {
  const orderMock = vi.fn().mockResolvedValue({ data: params.data, error: params.error });
  const eqMock = vi.fn().mockReturnValue({ order: orderMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;
  return { supabase, orderMock, eqMock, selectMock, fromMock, schemaMock };
}

describe("ContactRepository (Supabase実装).list — Issue #72.2", () => {
  it("正常系: 連絡先一覧を Result.ok で返す", async () => {
    const { supabase } = makeSupabaseMock({
      data: [
        {
          id: "10101010-1010-4010-8010-101010101010",
          user_id: USER_ID.data,
          contact_user_id: "22222222-2222-4222-8222-222222222222",
          display_name: "Test Contact",
          native_language: "en",
          avatar_url: null,
          added_at: new Date().toISOString(),
          is_favorite: false,
          trancall_id: "testcontact",
        },
      ],
      error: null,
    });
    const repo = createContactRepository(supabase);

    const result = await repo.list(USER_ID.data);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.contactUserId).toBe("22222222-2222-4222-8222-222222222222");
    }
  });

  it("DB エラー時は Result.err (INTERNAL_ERROR, retryable) を返す (旧実装は空配列を返していた)", async () => {
    const { supabase } = makeSupabaseMock({
      data: null,
      error: { message: "connection failure" },
    });
    const repo = createContactRepository(supabase);

    const result = await repo.list(USER_ID.data);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("0 件 (正常な空配列) は Result.ok({ data: [] }) を返し、エラーとは区別される", async () => {
    const { supabase } = makeSupabaseMock({ data: [], error: null });
    const repo = createContactRepository(supabase);

    const result = await repo.list(USER_ID.data);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
  });
});
