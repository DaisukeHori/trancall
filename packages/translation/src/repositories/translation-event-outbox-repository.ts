/**
 * Translation Event Outbox リポジトリ インターフェース
 *
 * translation_events テーブル（outbox パターン）への操作。
 * translation.started / translation.ended などのドメインイベントを
 * EventBus に投げる前に永続化し、AT-LEAST-ONCE 配信を保証する。
 */

import type { Result, AppError } from "@trancall/shared-kernel";

export interface OutboxRecord {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  processedAt: string | null;
}

export interface TranslationEventOutboxRepository {
  /**
   * outbox にイベントを追加する。
   */
  insert: (
    record: Omit<OutboxRecord, "id" | "createdAt" | "processedAt">,
  ) => Promise<Result<OutboxRecord, AppError>>;

  /**
   * 未処理イベントを取得する。
   * outbox worker が定期的にポーリングして EventBus に投げる。
   */
  findUnprocessed: (limit: number) => Promise<Result<OutboxRecord[], AppError>>;

  /**
   * 処理済みにマークする。
   */
  markProcessed: (id: string) => Promise<Result<void, AppError>>;
}
