/**
 * ConsentRepository (Supabase 実装) テスト (Issue #34)
 *
 * recordConsent の upsert が同一 (user_id, scope, version) への再同意のたびに
 * 既存行の recorded_at / revoked_at を上書きしていた問題の修正確認。
 * 修正後は「アクティブ行があれば返す (書き換えない)、無ければ INSERT で追記する」。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConsentRepository } from "../adapters/repositories/auth/consent-repository.supabase.js";
import type { UserId, ConsentScope } from "@trancall/shared-kernel";

const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_ID,
    scope: "voice_to_openai" as ConsentScope,
    version: "2026-05-12",
    recorded_at: "2026-05-12T00:00:00.000Z",
    revoked_at: null,
    ip_address: null,
    user_agent: null,
    source: "onboarding",
    ...overrides,
  };
}

function makeSupabaseMock(params: {
  existingActiveRow: ReturnType<typeof makeRecord> | null;
  insertResult?: { data: unknown; error: { code?: string; message: string } | null };
}) {
  const insertMock = vi.fn();
  const selectAfterInsertMock = vi.fn();
  const singleMock = vi.fn().mockResolvedValue(
    params.insertResult ?? { data: makeRecord({ id: "33333333-3333-4333-8333-333333333333" }), error: null },
  );

  const selectMock = vi.fn();
  const eqUserMock = vi.fn();
  const eqScopeMock = vi.fn();
  const eqVersionMock = vi.fn();
  const isMock = vi.fn();
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: params.existingActiveRow, error: null });

  // select().eq().eq().eq().is().maybeSingle() チェーン (アクティブ行検索)
  isMock.mockReturnValue({ maybeSingle: maybeSingleMock });
  eqVersionMock.mockReturnValue({ is: isMock });
  eqScopeMock.mockReturnValue({ eq: eqVersionMock });
  eqUserMock.mockReturnValue({ eq: eqScopeMock });
  selectMock.mockReturnValue({ eq: eqUserMock });

  // insert().select().single() チェーン (新規追記)
  selectAfterInsertMock.mockReturnValue({ single: singleMock });
  insertMock.mockReturnValue({ select: selectAfterInsertMock });

  const fromMock = vi.fn().mockReturnValue({ select: selectMock, insert: insertMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;

  return { supabase, insertMock, selectMock, maybeSingleMock };
}

describe("ConsentRepository.upsert — 監査証跡保護 (#34)", () => {
  it("既存のアクティブ行 (revoked_at IS NULL) があれば、それをそのまま返し INSERT しない (recorded_at/revoked_at を上書きしない)", async () => {
    const existingRow = makeRecord({
      recorded_at: "2025-01-01T00:00:00.000Z", // 古い初回同意日時
      revoked_at: null,
    });
    const { supabase, insertMock } = makeSupabaseMock({ existingActiveRow: existingRow });
    const repo = createConsentRepository(supabase);

    const result = await repo.upsert({
      userId: USER_ID,
      scope: "voice_to_openai",
      version: "2026-05-12",
      recordedAt: "2026-06-01T00:00:00.000Z", // 新しい呼び出し時刻 (これで上書きされてはいけない)
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      source: "settings_screen",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 既存の recorded_at (2025-01-01) が保持されており、新しい呼び出し時刻に上書きされていない
    expect(result.data.recordedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("アクティブ行が無ければ (取消済み、または未同意) 新規 INSERT で追記する", async () => {
    const { supabase, insertMock } = makeSupabaseMock({ existingActiveRow: null });
    const repo = createConsentRepository(supabase);

    const result = await repo.upsert({
      userId: USER_ID,
      scope: "voice_to_openai",
      version: "2026-05-12",
      recordedAt: "2026-06-01T00:00:00.000Z",
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      source: "settings_screen",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    const insertedRow = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow["recorded_at"]).toBe("2026-06-01T00:00:00.000Z");
    expect(insertedRow["revoked_at"]).toBeNull();
  });

  it("取消 (revoke) 後に再同意すると、取消済みの旧行を書き換えず新しい行として追記する", async () => {
    // revoke() 済み (revoked_at != null) の行は「アクティブ行検索」に該当しないため
    // existingActiveRow=null として扱われる (findActive のクエリは revoked_at IS NULL でフィルタする)。
    const { supabase, insertMock } = makeSupabaseMock({ existingActiveRow: null });
    const repo = createConsentRepository(supabase);

    const result = await repo.upsert({
      userId: USER_ID,
      scope: "voice_to_openai",
      version: "2026-05-12", // 取消前と同一バージョンへの再同意
      recordedAt: "2026-07-01T00:00:00.000Z",
      revokedAt: null,
      ipAddress: null,
      userAgent: null,
      source: "settings_screen",
    });

    expect(result.ok).toBe(true);
    // INSERT で新規行として追記される (旧・取消済み行の revoked_at は別レコードなので影響を受けない)
    expect(insertMock).toHaveBeenCalledOnce();
  });
});
