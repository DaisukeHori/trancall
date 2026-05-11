/**
 * SegmentService テスト
 *
 * 1. 冪等 INSERT: 同 sequence_no 重複は更新せず ok(true) を返す
 * 2. 正常 INSERT: 異なる sequence_no は挿入される
 * 3. retention_until が正しく設定されている
 * 4. sequenceNo 採番: レコードなしは 0 を返す
 * 5. sequenceNo 採番: 既存レコードがある場合は max+1 を返す
 * 6. バリデーションエラー: 不正な input は VALIDATION_ERROR を返す
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSegmentService, calcRetentionUntil, RETENTION_DAYS } from "../src/services/segment-service.js";
import {
  InMemorySegmentRepository,
} from "./helpers/stubs.js";
import {
  makeSegment,
  ROOM_ID,
  PARTICIPANT_A,
} from "./helpers/fixtures.js";

describe("SegmentService", () => {
  let repo: InMemorySegmentRepository;
  let service: ReturnType<typeof createSegmentService>;

  beforeEach(() => {
    repo = new InMemorySegmentRepository();
    service = createSegmentService(repo);
  });

  it("test-1: 正常な segment を INSERT できる", async () => {
    const seg = makeSegment();
    const result = await service.appendFinalSegment(seg);
    expect(result.ok).toBe(true);
    expect(repo.getAll()).toHaveLength(1);
  });

  it("test-2: 同一 sequence_no の重複は INSERT をスキップして ok を返す（冪等）", async () => {
    const seg = makeSegment({ sequenceNo: 0 });
    await service.appendFinalSegment(seg);

    // 同じ sequenceNo で再度 INSERT
    const dup = makeSegment({ sequenceNo: 0, originalText: "重複テスト" });
    const result = await service.appendFinalSegment(dup);

    expect(result.ok).toBe(true);
    // レコードは 1 件のまま
    expect(repo.getAll()).toHaveLength(1);
    // 元のデータが維持されている
    expect(repo.getAll()[0]?.originalText).toBe("こんにちは");
  });

  it("test-3: 異なる sequence_no は別レコードとして挿入される", async () => {
    const seg0 = makeSegment({ sequenceNo: 0 });
    const seg1 = makeSegment({
      sequenceNo: 1,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d410",
    });
    await service.appendFinalSegment(seg0);
    await service.appendFinalSegment(seg1);
    expect(repo.getAll()).toHaveLength(2);
  });

  it("test-4: retention_until がセットされている", async () => {
    const seg = makeSegment();
    await service.appendFinalSegment(seg);
    const stored = repo.getAll()[0];
    expect(stored?.retentionUntil).toBeTruthy();
    // 未来日時であること
    expect(new Date(stored!.retentionUntil) > new Date()).toBe(true);
  });

  it("test-5: 無効な input は VALIDATION_ERROR を返す", async () => {
    const result = await service.appendFinalSegment({ invalid: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("test-6: calcRetentionUntil は指定日数後の日時を返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const result = calcRetentionUntil(RETENTION_DAYS.free, now);
    expect(result).toBe("2026-01-08T00:00:00.000Z");
  });

  describe("getNextSequenceNo", () => {
    it("test-7: レコードなしは 0 を返す", async () => {
      const result = await repo.getNextSequenceNo(ROOM_ID, PARTICIPANT_A);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(0);
      }
    });

    it("test-8: 既存レコードがある場合は max+1 を返す", async () => {
      await repo.upsert(makeSegment({ sequenceNo: 0 }));
      await repo.upsert(makeSegment({
        sequenceNo: 1,
        segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d411",
      }));
      const result = await repo.getNextSequenceNo(ROOM_ID, PARTICIPANT_A);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(2);
      }
    });
  });
});
