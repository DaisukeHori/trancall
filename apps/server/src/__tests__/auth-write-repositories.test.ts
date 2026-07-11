/**
 * Issue #72.1: facade バイパス是正で追加した auth 書き込み用リポジトリの
 * Supabase 実装テスト。
 * - ProfileWriteRepository (profile-write-repository.supabase.ts)
 * - LegacyConsentRepository (legacy-consent-repository.supabase.ts)
 * - ProfileDeletionRepository (profile-deletion-repository.supabase.ts)
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandUserId } from "@trancall/shared-kernel";
import { createProfileWriteRepository } from "../adapters/repositories/auth/profile-write-repository.supabase.js";
import { createLegacyConsentRepository } from "../adapters/repositories/auth/legacy-consent-repository.supabase.js";
import { createProfileDeletionRepository } from "../adapters/repositories/auth/profile-deletion-repository.supabase.js";

const USER_ID_RESULT = brandUserId("11111111-1111-4111-8111-111111111111");
if (!USER_ID_RESULT.success) throw new Error("test setup: brandUserId failed");
const USER_ID = USER_ID_RESULT.data;

function makeChainSupabaseMock(terminal: { error: { message: string } | null }) {
  const eqMock = vi.fn().mockResolvedValue(terminal);
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  const upsertMock = vi.fn().mockResolvedValue(terminal);
  const fromMock = vi.fn().mockReturnValue({ update: updateMock, upsert: upsertMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;
  return { supabase, eqMock, updateMock, upsertMock, fromMock, schemaMock };
}

describe("ProfileWriteRepository (Supabase実装).update", () => {
  it("正常系: display_name/native_language/avatar_url を差分のみ更新する", async () => {
    const { supabase, updateMock, eqMock } = makeChainSupabaseMock({ error: null });
    const repo = createProfileWriteRepository(supabase);

    const result = await repo.update(USER_ID, { displayName: "新しい名前" });

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ display_name: "新しい名前" });
    expect(eqMock).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("DB エラー時は INTERNAL_ERROR (retryable) を返す", async () => {
    const { supabase } = makeChainSupabaseMock({ error: { message: "DB 障害" } });
    const repo = createProfileWriteRepository(supabase);

    const result = await repo.update(USER_ID, { displayName: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe("LegacyConsentRepository (Supabase実装).recordConsentVersion", () => {
  it("正常系: consent_versions へ upsert する", async () => {
    const { supabase, upsertMock, fromMock } = makeChainSupabaseMock({ error: null });
    const repo = createLegacyConsentRepository(supabase);

    const result = await repo.recordConsentVersion(USER_ID, "v1.0");

    expect(result.ok).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("consent_versions");
    const [payload, opts] = upsertMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ user_id: USER_ID, consent_version: "v1.0" });
    expect(opts).toEqual({ onConflict: "user_id" });
  });

  it("DB エラー時は INTERNAL_ERROR (retryable) を返す", async () => {
    const { supabase } = makeChainSupabaseMock({ error: { message: "DB 障害" } });
    const repo = createLegacyConsentRepository(supabase);

    const result = await repo.recordConsentVersion(USER_ID, "v1.0");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe("ProfileDeletionRepository (Supabase実装)", () => {
  function makeFindStatusMock(data: unknown, error: { message: string } | null) {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data, error });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock, update: updateMock });
    const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
    const supabase = { schema: schemaMock } as unknown as SupabaseClient;
    return { supabase, updateMock, updateEqMock };
  }

  it("findStatus: 行が存在すれば deletedAt を返す", async () => {
    const { supabase } = makeFindStatusMock({ deleted_at: "2026-06-01T00:00:00.000Z" }, null);
    const repo = createProfileDeletionRepository(supabase);

    const result = await repo.findStatus(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.deletedAt).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("findStatus: 行が存在しない場合は ok(null) を返す (エラーにしない)", async () => {
    const { supabase } = makeFindStatusMock(null, null);
    const repo = createProfileDeletionRepository(supabase);

    const result = await repo.findStatus(USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it("findStatus: DB エラー時は INTERNAL_ERROR を返す", async () => {
    const { supabase } = makeFindStatusMock(null, { message: "DB 障害" });
    const repo = createProfileDeletionRepository(supabase);

    const result = await repo.findStatus(USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("setDeletedAt: null を渡すと deleted_at=null で update する", async () => {
    const { supabase, updateMock, updateEqMock } = makeFindStatusMock(null, null);
    const repo = createProfileDeletionRepository(supabase);

    const result = await repo.setDeletedAt(USER_ID, null);

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ deleted_at: null });
    expect(updateEqMock).toHaveBeenCalledWith("user_id", USER_ID);
  });
});
