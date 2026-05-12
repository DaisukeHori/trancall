/**
 * billing モジュール — DomainEvent 発行ヘルパー
 *
 * docs/billing-ui-flow.md v1.2 §4.8 canonical 定義準拠。
 * billing.subscription_upgraded / billing.subscription_canceled を EventBus に発行する。
 *
 * EventBus は DI で受け取る (shared-kernel の EventBus インターフェース)。
 * Phase 1a では EventBus が未実装の場合に備えてコンソールログにフォールバックする。
 */

import crypto from "crypto";
import type { UserId } from "@trancall/shared-kernel";
import type {
  BillingSubscriptionUpgradedEvent,
  BillingSubscriptionCanceledEvent,
} from "./view-models/index.js";
import type { PlanTier, PurchaseChannel } from "./schemas.js";

// =============================================================================
// EventBus インターフェース (shared-kernel 公開 or DI 注入)
// =============================================================================

export interface EventBus {
  publish(event: BillingSubscriptionUpgradedEvent | BillingSubscriptionCanceledEvent): void | Promise<void>;
}

/** EventBus が注入されない場合のフォールバック (ログのみ) */
const consoleEventBus: EventBus = {
  publish(event) {
    // PII 除外: aggregateId (userId) は UUID のみ可
    console.log(`[EventBus] ${event.type} published: aggregateId=${event.aggregateId}`);
  },
};

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * billing.subscription_upgraded DomainEvent を発行する。
 */
export async function publishSubscriptionUpgraded(
  bus: EventBus | undefined,
  params: {
    userId: UserId;
    fromTier: PlanTier;
    toTier: PlanTier;
    channel: PurchaseChannel;
  },
): Promise<void> {
  const event: BillingSubscriptionUpgradedEvent = {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: params.userId as string,
    type: "billing.subscription_upgraded",
    payload: {
      userId: params.userId,
      fromTier: params.fromTier,
      toTier: params.toTier,
      channel: params.channel,
      effectiveAt: new Date().toISOString(),
    },
  };
  await (bus ?? consoleEventBus).publish(event);
}

/**
 * billing.subscription_canceled DomainEvent を発行する。
 */
export async function publishSubscriptionCanceled(
  bus: EventBus | undefined,
  params: {
    userId: UserId;
    fromTier: PlanTier;
    channel: PurchaseChannel;
    cancelAtPeriodEnd: boolean;
  },
): Promise<void> {
  const event: BillingSubscriptionCanceledEvent = {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    aggregateId: params.userId as string,
    type: "billing.subscription_canceled",
    payload: {
      userId: params.userId,
      fromTier: params.fromTier,
      channel: params.channel,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
      effectiveAt: new Date().toISOString(),
    },
  };
  await (bus ?? consoleEventBus).publish(event);
}
