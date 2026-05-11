/**
 * mock-facades — BillingFacade / MediaFacade / NotificationFacade / EventBus のモック
 */

import { vi } from "vitest";
import { ok } from "@trancall/shared-kernel";
import type { BillingFacade } from "@trancall/billing";
import type { MediaFacade } from "@trancall/media";
import type { NotificationFacade } from "@trancall/notification";
import type { EventBus } from "../../src/event-bus.js";

export function makeBillingFacade(canStart = true): BillingFacade {
  return {
    canStartCall: vi.fn().mockResolvedValue(canStart ? ok(true as const) : {
      ok: false,
      error: { code: "BILLING_INSUFFICIENT_BALANCE", message: "残高不足", retryable: false },
    }),
    reserveMinutes: vi.fn().mockResolvedValue(ok(true as const)),
    reconcile: vi.fn().mockResolvedValue(ok({} as never)),
    refundMinutes: vi.fn().mockResolvedValue(ok(true as const)),
    getSubscription: vi.fn().mockResolvedValue(ok({} as never)),
    recordUsage: vi.fn().mockResolvedValue(ok({} as never)),
    createCheckoutSession: vi.fn().mockResolvedValue(ok({ url: "https://example.com" })),
    handleStripeWebhook: vi.fn().mockResolvedValue(ok(true as const)),
    handleAppleIapWebhook: vi.fn().mockResolvedValue(ok(true as const)),
    handleGoogleIapWebhook: vi.fn().mockResolvedValue(ok(true as const)),
  };
}

export function makeMediaFacade(createRoomOk = true): MediaFacade {
  return {
    createRoom: vi.fn().mockResolvedValue(
      createRoomOk ? ok(undefined) : {
        ok: false,
        error: { code: "MEDIA_ROOM_CREATE_FAILED", message: "LiveKit error", retryable: true },
      },
    ),
    deleteRoom: vi.fn().mockResolvedValue(ok(undefined)),
    issueAccessToken: vi.fn().mockResolvedValue(ok({} as never)),
  };
}

export function makeNotificationFacade(): NotificationFacade {
  return {
    sendIncomingCall: vi.fn().mockResolvedValue(ok(true as const)),
    sendMissedCall: vi.fn().mockResolvedValue(ok(true as const)),
    registerDevice: vi.fn().mockResolvedValue(ok(true as const)),
    unregisterDevice: vi.fn().mockResolvedValue(ok(true as const)),
  };
}

export function makeEventBus(): EventBus & { published: unknown[] } {
  const published: unknown[] = [];
  return {
    published,
    publish: vi.fn().mockImplementation(async (event: unknown) => {
      published.push(event);
    }),
  };
}
