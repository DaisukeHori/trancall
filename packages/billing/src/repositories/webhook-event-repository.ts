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
   * (provider, external_event_id) が既存の場合は既存行を返す。
   * 戻り値の isNew で新規 / 重複を判別できる。
   */
  insertIdempotent(params: {
    provider: WebhookProvider;
    externalEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<Result<{ event: WebhookEvent; isNew: boolean }>>;

  /**
   * 処理完了を記録する。
   */
  markProcessed(id: string): Promise<Result<void>>;

  /**
   * 処理エラーを記録する。
   */
  markFailed(id: string, error: string): Promise<Result<void>>;
}
