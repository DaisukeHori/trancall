/**
 * WebhookEventRepository (Supabase 実装) テスト [#42 確定1]
 *
 * insertIdempotent が 23505 (UNIQUE 制約違反) で衝突した際、`isNew` だけでなく
 * 既存行の `processed_at` を見て `alreadyProcessed` を正しく判定することを検証する。
 *
 * 旧実装は isNew (23505 の有無) のみで判定していたため、一過性エラーで markFailed
 * (processed_at は null のまま) された行に Stripe が再送すると、23505 で衝突して
 * isNew=false になり、facade が「重複だから再処理不要」と誤認して updatePlan を
 * 再実行しないまま 200 を返してしまい、課金済みプランが恒久的に反映されない不具合があった。
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWebhookEventRepository } from "../adapters/repositories/billing/webhook-event-repository.supabase.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    provider: "stripe",
    external_event_id: "evt_test_001",
    event_type: "checkout.session.completed",
    payload: {},
    processed_at: null,
    processing_error: null,
    received_at: "2026-05-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeSupabaseMock(params: {
  insertError: { code?: string; message: string } | null;
  selectRow: ReturnType<typeof makeRow>;
}) {
  const insertMock = vi.fn().mockResolvedValue({ error: params.insertError });

  const singleMock = vi.fn().mockResolvedValue({ data: params.selectRow, error: null });
  const eq2Mock = vi.fn().mockReturnValue({ single: singleMock });
  const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
  const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock });

  const fromMock = vi.fn().mockReturnValue({ insert: insertMock, select: selectMock });
  const schemaMock = vi.fn().mockReturnValue({ from: fromMock });
  const supabase = { schema: schemaMock } as unknown as SupabaseClient;

  return { supabase, insertMock, selectMock, singleMock };
}

const baseParams = {
  provider: "stripe" as const,
  externalEventId: "evt_test_001",
  eventType: "checkout.session.completed",
  payload: {},
};

describe("WebhookEventRepository (Supabase実装).insertIdempotent — [#42 確定1]", () => {
  it("新規 INSERT 成功時は isNew=true, alreadyProcessed=false を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: null,
      selectRow: makeRow({ processed_at: null }),
    });
    const repo = createWebhookEventRepository(supabase);

    const result = await repo.insertIdempotent(baseParams);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isNew).toBe(true);
      expect(result.data.alreadyProcessed).toBe(false);
    }
  });

  it(
    "23505 衝突・既存行が未処理 (processed_at IS NULL、markFailed のみ実行済み) の場合、" +
      "isNew=false かつ alreadyProcessed=false を返す (再処理が必要)",
    async () => {
      const { supabase } = makeSupabaseMock({
        insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        selectRow: makeRow({ processed_at: null, processing_error: "transient db error" }),
      });
      const repo = createWebhookEventRepository(supabase);

      const result = await repo.insertIdempotent(baseParams);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.isNew).toBe(false);
        // [#42] ここが旧実装のバグ箇所: 旧実装は isNew=false のみで alreadyProcessed 相当を
        // 決めていたため、この状態でも「重複だから処理不要」と誤判定していた。
        expect(result.data.alreadyProcessed).toBe(false);
      }
    },
  );

  it(
    "23505 衝突・既存行が処理完了済み (processed_at 非 null) の場合、alreadyProcessed=true を返す (冪等スキップ可)",
    async () => {
      const { supabase } = makeSupabaseMock({
        insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        selectRow: makeRow({ processed_at: "2026-05-10T10:00:05.000Z" }),
      });
      const repo = createWebhookEventRepository(supabase);

      const result = await repo.insertIdempotent(baseParams);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.isNew).toBe(false);
        expect(result.data.alreadyProcessed).toBe(true);
      }
    },
  );

  it("23505 以外の INSERT エラーは INTERNAL_ERROR (retryable) を返す", async () => {
    const { supabase } = makeSupabaseMock({
      insertError: { code: "08006", message: "connection failure" },
      selectRow: makeRow(),
    });
    const repo = createWebhookEventRepository(supabase);

    const result = await repo.insertIdempotent(baseParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });
});
