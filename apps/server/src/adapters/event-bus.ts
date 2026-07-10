/**
 * in-process EventBus 実装
 *
 * docs/module-contracts.md Section 3.2 の EventBus 契約を実装する。
 * 各モジュールの narrowed EventBus interface を満たす統合実装。
 *
 * 本実装はシングルプロセス内 pub/sub のみ対応する。
 * Phase 2 で Redis/Kafka 等の外部 MQ に移行する際はここを差し替える。
 */

import type { ConsentScope } from "@trancall/shared-kernel";
import type { RoomDomainEvent } from "@trancall/room";
import type {
  TranslationStartedEvent,
  TranslationEndedEvent,
  TranslationDegradedEvent,
  TranslationRecoveredEvent,
} from "@trancall/translation";
import type {
  BillingSubscriptionUpgradedEvent,
  BillingSubscriptionCanceledEvent,
} from "@trancall/billing";

// ---------------------------------------------------------------------------
// Auth ドメインイベント (docs/module-contracts.md v1.3 §3.1)
// ---------------------------------------------------------------------------

export interface AuthConsentRecordedEvent {
  type: "auth.consent_recorded";
  payload: {
    userId: string;
    scope: ConsentScope;
    version?: string;
    recordedAt?: string;
  };
}

export interface AuthConsentRevokedEvent {
  type: "auth.consent_revoked";
  payload: {
    userId: string;
    scope: ConsentScope;
    revokedAt?: string;
  };
}

export interface AuthAccountDeletionRequestedEvent {
  type: "auth.account_deletion_requested";
  payload: {
    userId: string;
    requestedAt: string;
    gracePeriodEndsAt: string;
  };
}

export type AuthDomainEvent =
  | AuthConsentRecordedEvent
  | AuthConsentRevokedEvent
  | AuthAccountDeletionRequestedEvent;

// ---------------------------------------------------------------------------
// DomainEvent 統合 union
// ---------------------------------------------------------------------------

export type DomainEvent =
  | RoomDomainEvent
  | TranslationStartedEvent
  | TranslationEndedEvent
  | TranslationDegradedEvent
  | TranslationRecoveredEvent
  | AuthDomainEvent
  // #29: billing facade に eventBus を注入したことで publishSubscriptionUpgraded /
  // publishSubscriptionCanceled がこの eventBus 経由で publish されるようになったため、
  // DomainEvent union にも billing イベントを含めて型を正しくする。
  | BillingSubscriptionUpgradedEvent
  | BillingSubscriptionCanceledEvent;

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
