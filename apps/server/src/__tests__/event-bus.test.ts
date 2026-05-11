/**
 * EventBus テスト
 */

import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "../event-bus.js";
import type { RoomCreatedEvent } from "@trancall/room";

function makeRoomCreatedEvent(): RoomCreatedEvent {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    occurredAt: new Date().toISOString(),
    aggregateId: "22222222-2222-4222-8222-222222222222",
    type: "room.created",
    payload: {
      roomId: "22222222-2222-4222-8222-222222222222" as import("@trancall/shared-kernel").RoomId,
      creatorId: "33333333-3333-4333-8333-333333333333" as import("@trancall/shared-kernel").UserId,
      inviteeIds: [],
      translationEnabled: true,
      createdAt: new Date().toISOString(),
    },
  };
}

describe("EventBus", () => {
  it("subscribe したハンドラーが publish で呼ばれる", async () => {
    const bus = createEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    bus.subscribe("room.created", handler);
    await bus.publish(makeRoomCreatedEvent());

    expect(handler).toHaveBeenCalledOnce();
  });

  it("unsubscribe 後はハンドラーが呼ばれない", async () => {
    const bus = createEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    const unsubscribe = bus.subscribe("room.created", handler);
    unsubscribe();
    await bus.publish(makeRoomCreatedEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it("複数ハンドラーが全て呼ばれる", async () => {
    const bus = createEventBus();
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);

    bus.subscribe("room.created", handler1);
    bus.subscribe("room.created", handler2);
    await bus.publish(makeRoomCreatedEvent());

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("購読していないイベントタイプでは呼ばれない", async () => {
    const bus = createEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    bus.subscribe("room.participant_joined", handler);
    await bus.publish(makeRoomCreatedEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it("ハンドラーにイベントオブジェクトが渡される", async () => {
    const bus = createEventBus();
    const received: RoomCreatedEvent[] = [];

    bus.subscribe("room.created", async (event) => {
      received.push(event);
    });

    const event = makeRoomCreatedEvent();
    await bus.publish(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });
});
