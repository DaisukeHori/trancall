/**
 * NonceRepository (Supabase 実装) テスト [Issue #63]
 *
 * checkAndInsert が 23505 (UNIQUE 制約違反) で衝突した際、既存行の processed_at を見て
 * alreadyProcessed を正しく判定することを検証する (webhook-event-repository.test.ts と
 * 同じ検証パターン)。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNonceRepository } from "../adapters/repositories/agent/nonce-repository.supabase.js";

function makeSupabaseMock(params: {
  insertError: { code?: string; message: string } | null;
  selectRow?: { processed_at: string | null } | null;
  selectError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const insertMock = vi.fn().mockResolvedValue({ error: params.insertError });

  const singleMock = vi
    .fn()
    .mockResolvedValue({ data: params.selectRow ?? null, error: params.selectError ?? null });
  const selectEqMock = vi.fn().mockReturnValue({ single: singleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });

  const updateEqMock = vi.fn().mockResolvedValue({ error: params.updateError ?? null });
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

  const fromMock = vi.fn().mockReturnValue({ insert: insertMock, select: selectMock, update: updateMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;

  return { supabase, insertMock, selectMock, singleMock, updateMock, updateEqMock };
}

const KEY = "11111111-1111-4111-8111-111111111111";
const EXPIRES_AT = "2026-07-09T00:05:00.000Z";

describe("NonceRepository (Supabase実装).checkAndInsert", () => {
  it("新規 INSERT 成功時は isNew=true, alreadyProcessed=false を返す", async () => {
    const { supabase, insertMock } = makeSupabaseMock({ insertError: null });
    const repo = createNonceRepository(supabase);

    const result = await repo.checkAndInsert(KEY, EXPIRES_AT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isNew).toBe(true);
      expect(result.data.alreadyProcessed).toBe(false);
    }
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("23505 衝突・既存行が未処理 (processed_at IS NULL) の場合、isNew=false かつ alreadyProcessed=false (再処理許可)", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
      selectRow: { processed_at: null },
    });
    const repo = createNonceRepository(supabase);

    const result = await repo.checkAndInsert(KEY, EXPIRES_AT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isNew).toBe(false);
      // Agent 側の正当なリトライ (前回処理が完了前に失敗) を妨げないため false になる
      expect(result.data.alreadyProcessed).toBe(false);
    }
  });

  it("23505 衝突・既存行が処理完了済み (processed_at 非 null) の場合、alreadyProcessed=true を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
      selectRow: { processed_at: "2026-07-09T00:00:05.000Z" },
    });
    const repo = createNonceRepository(supabase);

    const result = await repo.checkAndInsert(KEY, EXPIRES_AT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isNew).toBe(false);
      expect(result.data.alreadyProcessed).toBe(true);
    }
  });

  it("23505 以外の INSERT エラーは INTERNAL_ERROR (retryable) を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { code: "08006", message: "connection failure" },
    });
    const repo = createNonceRepository(supabase);

    const result = await repo.checkAndInsert(KEY, EXPIRES_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("23505 衝突後の SELECT 自体が失敗した場合も INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
      selectError: { message: "connection lost" },
    });
    const repo = createNonceRepository(supabase);

    const result = await repo.checkAndInsert(KEY, EXPIRES_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });
});

describe("NonceRepository (Supabase実装).markProcessed", () => {
  it("成功時は ok(undefined) を返す", async () => {
    const { supabase, updateMock, updateEqMock } = makeSupabaseMock({ insertError: null });
    const repo = createNonceRepository(supabase);

    const result = await repo.markProcessed(KEY);

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateEqMock).toHaveBeenCalledWith("idempotency_key", KEY);
  });

  it("UPDATE 失敗時は INTERNAL_ERROR (retryable) を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: null,
      updateError: { message: "connection failure" },
    });
    const repo = createNonceRepository(supabase);

    const result = await repo.markProcessed(KEY);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });
});
