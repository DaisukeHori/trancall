/**
 * in-process EventBus 実装
 *
 * docs/module-contracts.md Section 3.2 の EventBus 契約を実装する。
 * 各モジュールの narrowed EventBus interface を満たす統合実装。
 *
 * 本実装はシングルプロセス内 pub/sub のみ対応する。
 * Phase 2 で Redis/Kafka 等の外部 MQ に移行する際はここを差し替える。
 */

import type { RoomDomainEvent } from "@trancall/room";
import type { TranslationStartedEvent, TranslationEndedEvent } from "@trancall/translation";

// ---------------------------------------------------------------------------
// DomainEvent 統合 union
// ---------------------------------------------------------------------------

export type DomainEvent =
  | RoomDomainEvent
  | TranslationStartedEvent
  | TranslationEndedEvent;

// ---------------------------------------------------------------------------
// EventBus インターフェース (モジュール contracts Section 3.2)
// ---------------------------------------------------------------------------

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent["type"]>(
    eventType: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>,
  ): () => void;
}

// ---------------------------------------------------------------------------
// in-process 実装
// ---------------------------------------------------------------------------

type AnyHandler = (event: DomainEvent) => Promise<void>;

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<AnyHandler>>();

  return {
    async publish(event: DomainEvent): Promise<void> {
      const set = handlers.get(event.type);
      if (!set) return;

      const promises: Promise<void>[] = [];
      for (const handler of set) {
        promises.push(handler(event));
      }
      // 全ハンドラを並列実行。個別失敗は握り潰さず rethrow する。
      await Promise.all(promises);
    },

    subscribe<T extends DomainEvent["type"]>(
      eventType: T,
      handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>,
    ): () => void {
      let set = handlers.get(eventType);
      if (!set) {
        set = new Set();
        handlers.set(eventType, set);
      }
      // handler の型を AnyHandler にキャスト（境界: eventType で dispatch 済み）
      const anyHandler = handler as AnyHandler;
      set.add(anyHandler);
      // unsubscribe クロージャ: set をローカル変数として捕捉して optional chain を回避
      const capturedSet = set;
      return () => {
        capturedSet.delete(anyHandler);
      };
    },
  };
}
