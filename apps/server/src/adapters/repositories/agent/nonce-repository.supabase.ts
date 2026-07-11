/**
 * NonceRepository — Supabase 実装
 *
 * Issue #63: HMAC idempotencyKey 単位でのリクエスト重複排除 (replay 対策) 用ストア。
 * `trancall_event.agent_request_nonces` (migration 00023) を操作する。
 *
 * このテーブルは特定の packages/* モジュールが所有するものではなく、
 * apps/server の HMAC ミドルウェア (Agent ⇔ Server 内部 API の横断的関心事) が
 * 直接読み書きする。module-contracts.md §1.1 の「trancall_event.* は
 * translation モジュール所有だが Server の Agent event ハンドラから直接 write
 * される」という既存の例外パターンに倣う。
 *
 * 設計:
 * - idempotencyKey は PRIMARY KEY。初回は INSERT で新規登録し、後続処理を許可する。
 * - 2回目以降 (23505 unique_violation) は既存行を取得し、processed_at の有無で分岐する:
 *   - processed_at が設定済み (前回リクエストが正常完了済み) → alreadyProcessed: true
 *     を返す (呼び出し元はここで再処理せず 200 を返す)。
 *   - processed_at が NULL (前回リクエストが完了前に失敗、または処理中) →
 *     alreadyProcessed: false を返す (Agent 側の正当なリトライを妨げないため
 *     再処理を許可する)。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Result, err, ok } from "@trancall/shared-kernel";

export interface NonceRepository {
  /**
   * idempotencyKey を新規登録する。既存キーの場合は `alreadyProcessed` で
   * 「前回処理が完了済みかどうか」を返す (完了済みなら再処理不要、未完了ならリトライ許可)。
   */
  checkAndInsert(
    idempotencyKey: string,
    expiresAt: string,
  ): Promise<Result<{ isNew: boolean; alreadyProcessed: boolean }>>;

  /** 処理完了をマークする (以後の同一 idempotencyKey リクエストは再処理されない) */
  markProcessed(idempotencyKey: string): Promise<Result<void>>;
}

export function createNonceRepository(supabase: SupabaseClient): NonceRepository {
  return {
    async checkAndInsert(idempotencyKey, expiresAt) {
      const { error } = await supabase
        .schema("trancall_event")
        .from("agent_request_nonces")
        .insert({
          idempotency_key: idempotencyKey,
          expires_at: expiresAt,
          processed_at: null,
        });

      if (!error) {
        return ok({ isNew: true, alreadyProcessed: false });
      }

      if (error.code !== "23505") {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }

      // 重複: 既存行の processed_at を確認する
      const { data, error: fetchError } = await supabase
        .schema("trancall_event")
        .from("agent_request_nonces")
        .select("processed_at")
        .eq("idempotency_key", idempotencyKey)
        .single();

      if (fetchError) {
        return err({ code: "INTERNAL_ERROR", message: fetchError.message, retryable: true });
      }

      const row = data as Record<string, unknown>;
      return ok({ isNew: false, alreadyProcessed: row["processed_at"] !== null });
    },

    async markProcessed(idempotencyKey) {
      const { error } = await supabase
        .schema("trancall_event")
        .from("agent_request_nonces")
        .update({ processed_at: new Date().toISOString() })
        .eq("idempotency_key", idempotencyKey);

      if (error) {
        return err({ code: "INTERNAL_ERROR", message: error.message, retryable: true });
      }
      return ok(undefined);
    },
  };
}
