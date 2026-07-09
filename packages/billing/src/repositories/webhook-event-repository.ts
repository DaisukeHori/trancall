/**
 * WebhookEventRepository インターフェース
 *
 * webhook_events テーブルへのアクセス。
 * 冪等 INSERT で重複処理を防ぐ。
 * 実装は apps/server 側（Supabase）。
 */

import type { Result} from "@trancall/shared-kernel";
import type { WebhookEvent, WebhookProvider } from "../schemas.js";

export interface WebhookEventRepository {
  /**
   * Webhook イベントを冪等 INSERT する。
   * (provider, external_event_id) が既存の場合は既存行を返す (INSERT は 23505 で衝突する)。
   *
   * 戻り値:
   * - `isNew`: INSERT が新規行として成功したか (23505 衝突なしなら true)。
   * - `alreadyProcessed`: 既存行 (または新規行) の `processedAt` が非 null、つまり
   *   markProcessed 済みで実処理 (updatePlan 等) が完了しているかどうか。
   *
   * [#42 確定1] `isNew` のみで「重複だから再処理不要」と判定してはならない。
   * 一過性エラーで markFailed (processedAt は null のまま) された行に Stripe 等が再送した場合、
   * INSERT は 23505 で衝突し isNew=false になるが、実処理は未完了 (alreadyProcessed=false) のため
   * 呼び出し元は再処理を行う必要がある。「重複だから短絡してよい」のは alreadyProcessed=true の
   * ときのみ。
   */
  insertIdempotent(params: {
    provider: WebhookProvider;
    externalEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<Result<{ event: WebhookEvent; isNew: boolean; alreadyProcessed: boolean }>>;

  /**
   * 処理完了を記録する。
   */
  markProcessed(id: string): Promise<Result<void>>;

  /**
   * 処理エラーを記録する。
   */
  markFailed(id: string, error: string): Promise<Result<void>>;
}
