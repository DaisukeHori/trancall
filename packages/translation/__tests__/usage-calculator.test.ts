import { describe, it, expect } from "vitest";

import { calcBillableSeconds, calcUsageFromRecord } from "../src/services/usage-calculator.js";
import type { TranslationSessionRecord } from "../src/schemas.js";

const validRecord: TranslationSessionRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  agentJobId: "00000000-0000-4000-8000-000000000011",
  roomId: "00000000-0000-4000-8000-000000000012" as TranslationSessionRecord["roomId"],
  sourceParticipantId: "00000000-0000-4000-8000-000000000013" as TranslationSessionRecord["sourceParticipantId"],
  targetParticipantId: "00000000-0000-4000-8000-000000000014" as TranslationSessionRecord["targetParticipantId"],
  outputLanguage: "en",
  startedAt: "2026-05-12T00:00:00.000Z",
  endedAt: "2026-05-12T00:01:00.000Z",
  durationMs: 60000,
  billableSeconds: 60,
  reason: "participant_left",
  createdAt: "2026-05-12T00:00:00.000Z",
};

describe("calcBillableSeconds", () => {
  it("0ms → 0秒", () => {
    expect(calcBillableSeconds(0)).toBe(0);
  });

  it("1000ms → 1秒", () => {
    expect(calcBillableSeconds(1000)).toBe(1);
  });

  it("1ms → 1秒（切り上げ）", () => {
    expect(calcBillableSeconds(1)).toBe(1);
  });

  it("1500ms → 2秒（切り上げ）", () => {
    expect(calcBillableSeconds(1500)).toBe(2);
  });

  it("60000ms → 60秒", () => {
    expect(calcBillableSeconds(60000)).toBe(60);
  });

  it("59999ms → 60秒（切り上げ）", () => {
    expect(calcBillableSeconds(59999)).toBe(60);
  });
});

describe("calcUsageFromRecord", () => {
  it("終了済みレコードから TranslationUsage を生成できる", () => {
    const result = calcUsageFromRecord(validRecord);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.billableSeconds).toBe(60);
      expect(result.data.durationMs).toBe(60000);
      expect(result.data.reason).toBe("participant_left");
    }
  });

  it("endedAt が null のレコードはエラー", () => {
    const record: TranslationSessionRecord = {
      ...validRecord,
      endedAt: null,
      durationMs: null,
      billableSeconds: null,
      reason: null,
    };
    const result = calcUsageFromRecord(record);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("billableSeconds は durationMs から正しく算出される", () => {
    const record: TranslationSessionRecord = {
      ...validRecord,
      durationMs: 1500,
      billableSeconds: calcBillableSeconds(1500),
    };
    const result = calcUsageFromRecord(record);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.billableSeconds).toBe(2);
    }
  });
});
