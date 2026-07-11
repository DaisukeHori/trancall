/**
 * billing-heartbeat.ts — payload parsing ユニットテスト
 *
 * M-10 仕様:
 *  - billing.heartbeat ペイロード → updateRemainingMinutes(remainingMinutes) 呼び出し
 *  - 不正 JSON → null 返却、updateRemainingMinutes は呼ばれない
 *  - スキーマ不一致 → null 返却、updateRemainingMinutes は呼ばれない
 *  - topic が BILLING_HEARTBEAT_CHANNEL_TOPIC 以外 → ハンドラは何もしない
 */
import { describe, it, expect, vi } from "vitest";
import {
  handleBillingHeartbeatPayload,
  makeBillingHeartbeatDataChannelHandler,
  BILLING_HEARTBEAT_CHANNEL_TOPIC,
} from "../src/lib/livekit/billing-heartbeat.js";
import type { BillingHeartbeatActions } from "../src/lib/livekit/billing-heartbeat.js";

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function makeActions(): BillingHeartbeatActions & {
  updateRemainingMinutes: ReturnType<typeof vi.fn>;
} {
  return {
    updateRemainingMinutes: vi.fn(),
  };
}

describe("handleBillingHeartbeatPayload — billing.heartbeat", () => {
  it("calls updateRemainingMinutes with the remainingMinutes value", () => {
    const actions = makeActions();
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: true,
      remainingMinutes: 12,
    };
    const result = handleBillingHeartbeatPayload(encode(payload), actions);
    expect(result).toBe("billing.heartbeat");
    expect(actions.updateRemainingMinutes).toHaveBeenCalledWith(12);
  });

  it("shouldContinue=false / remainingMinutes=0 (残高不足) でも remainingMinutes は更新される", () => {
    const actions = makeActions();
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: false,
      remainingMinutes: 0,
    };
    handleBillingHeartbeatPayload(encode(payload), actions);
    expect(actions.updateRemainingMinutes).toHaveBeenCalledWith(0);
  });
});

describe("handleBillingHeartbeatPayload — error cases", () => {
  it("returns null for invalid JSON", () => {
    const actions = makeActions();
    const badData = new TextEncoder().encode("not-valid-json{{{");
    const result = handleBillingHeartbeatPayload(badData, actions);
    expect(result).toBeNull();
    expect(actions.updateRemainingMinutes).not.toHaveBeenCalled();
  });

  it("returns null for schema mismatch (missing remainingMinutes)", () => {
    const actions = makeActions();
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: true,
      // remainingMinutes フィールドなし
    };
    const result = handleBillingHeartbeatPayload(encode(payload), actions);
    expect(result).toBeNull();
    expect(actions.updateRemainingMinutes).not.toHaveBeenCalled();
  });

  it("returns null for schema mismatch (unknown type)", () => {
    const actions = makeActions();
    const payload = { type: "unknown.event" };
    const result = handleBillingHeartbeatPayload(encode(payload), actions);
    expect(result).toBeNull();
  });

  it("returns null for empty object", () => {
    const actions = makeActions();
    const result = handleBillingHeartbeatPayload(encode({}), actions);
    expect(result).toBeNull();
  });
});

describe("makeBillingHeartbeatDataChannelHandler", () => {
  it("calls handleBillingHeartbeatPayload when topic matches", () => {
    const actions = makeActions();
    const handler = makeBillingHeartbeatDataChannelHandler(actions);
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: true,
      remainingMinutes: 25,
    };
    handler(encode(payload), BILLING_HEARTBEAT_CHANNEL_TOPIC);
    expect(actions.updateRemainingMinutes).toHaveBeenCalledWith(25);
  });

  it("ignores messages with a different topic (e.g. translation.status)", () => {
    const actions = makeActions();
    const handler = makeBillingHeartbeatDataChannelHandler(actions);
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: true,
      remainingMinutes: 25,
    };
    handler(encode(payload), "translation.status");
    expect(actions.updateRemainingMinutes).not.toHaveBeenCalled();
  });

  it("ignores messages with no topic", () => {
    const actions = makeActions();
    const handler = makeBillingHeartbeatDataChannelHandler(actions);
    const payload = {
      type: "billing.heartbeat",
      shouldContinue: true,
      remainingMinutes: 25,
    };
    handler(encode(payload));
    expect(actions.updateRemainingMinutes).not.toHaveBeenCalled();
  });
});
