/**
 * events.test.ts — DomainEventBase スキーマの単体テスト
 *
 * DomainEventBase の valid/invalid パターンを検証する。
 * Zod デフォルト設定でのストリップ (余分フィールドの扱い) も確認。
 */

import { describe, expect, it } from "vitest";

import { DomainEventBase } from "../src/schemas/events.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "10000000-0000-4000-8000-000000000001";
const VALID_DATETIME = "2026-05-12T00:00:00.000Z";

describe("DomainEventBase スキーマ", () => {
  it("eventId / occurredAt / aggregateId が揃っていれば success になる", () => {
    const result = DomainEventBase.safeParse({
      eventId: VALID_UUID,
      occurredAt: VALID_DATETIME,
      aggregateId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
  });

  it("parse 結果のフィールド値が正しい", () => {
    const result = DomainEventBase.safeParse({
      eventId: VALID_UUID,
      occurredAt: VALID_DATETIME,
      aggregateId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventId).toBe(VALID_UUID);
    expect(result.data.occurredAt).toBe(VALID_DATETIME);
    expect(result.data.aggregateId).toBe(VALID_UUID_2);
  });

  it("eventId が不正 UUID の場合は fail になる", () => {
    const result = DomainEventBase.safeParse({
      eventId: "not-a-uuid",
      occurredAt: VALID_DATETIME,
      aggregateId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
  });

  it("occurredAt が不正 datetime の場合は fail になる", () => {
    const result = DomainEventBase.safeParse({
      eventId: VALID_UUID,
      occurredAt: "2026-05-12",  // 日付のみ (時刻なし) は datetime() 不可
      aggregateId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
  });

  it("aggregateId が不正 UUID の場合は fail になる", () => {
    const result = DomainEventBase.safeParse({
      eventId: VALID_UUID,
      occurredAt: VALID_DATETIME,
      aggregateId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("必須フィールドが欠けている場合は fail になる (eventId なし)", () => {
    const result = DomainEventBase.safeParse({
      occurredAt: VALID_DATETIME,
      aggregateId: VALID_UUID_2,
    });
    expect(result.success).toBe(false);
  });

  it("余分なフィールドがあっても Zod デフォルト (strip) で success になる", () => {
    const result = DomainEventBase.safeParse({
      eventId: VALID_UUID,
      occurredAt: VALID_DATETIME,
      aggregateId: VALID_UUID_2,
      extraField: "should-be-stripped",
    });
    // Zod v4 のデフォルトは strip: 余分フィールドは除去して success
    expect(result.success).toBe(true);
  });
});
