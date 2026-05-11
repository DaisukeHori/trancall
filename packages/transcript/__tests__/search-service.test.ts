/**
 * SearchService テスト
 *
 * 1. 自分が access 持つ Room のみ検索可
 * 2. access がない Room は FORBIDDEN
 * 3. FTS query のエスケープ（シングルクォート）
 * 4. 原文・訳文どちらでもヒットする
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSearchService, escapeFtsQuery } from "../src/services/search-service.js";
import {
  InMemorySegmentRepository,
  InMemoryAccessRepository,
} from "./helpers/stubs.js";
import {
  makeSegment,
  makeAccessRecord,
  ROOM_ID,
  USER_A,
} from "./helpers/fixtures.js";

describe("SearchService", () => {
  let segmentRepo: InMemorySegmentRepository;
  let accessRepo: InMemoryAccessRepository;
  let service: ReturnType<typeof createSearchService>;

  beforeEach(() => {
    segmentRepo = new InMemorySegmentRepository();
    accessRepo = new InMemoryAccessRepository();
    service = createSearchService(segmentRepo, accessRepo);
  });

  it("test-1: access がある Room の検索は結果を返す", async () => {
    accessRepo.addRecord(makeAccessRecord(USER_A));
    await segmentRepo.upsert(makeSegment({ originalText: "こんにちは" }));

    const result = await service.searchSegments(ROOM_ID, USER_A, "こんにちは");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("test-2: access がない Room は FORBIDDEN を返す", async () => {
    await segmentRepo.upsert(makeSegment());

    const result = await service.searchSegments(ROOM_ID, USER_A, "こんにちは");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("test-3: deleted_at がセット済みの場合は FORBIDDEN を返す", async () => {
    accessRepo.addRecord(
      makeAccessRecord(USER_A, { deletedAt: new Date().toISOString() }),
    );
    await segmentRepo.upsert(makeSegment());

    const result = await service.searchSegments(ROOM_ID, USER_A, "こんにちは");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("test-4: 訳文でもヒットする", async () => {
    accessRepo.addRecord(makeAccessRecord(USER_A));
    await segmentRepo.upsert(
      makeSegment({ originalText: "こんにちは", translatedText: "Hello" }),
    );

    const result = await service.searchSegments(ROOM_ID, USER_A, "Hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  describe("escapeFtsQuery", () => {
    it("test-5: シングルクォートをエスケープする", () => {
      expect(escapeFtsQuery("it's")).toBe("it''s");
    });

    it("test-6: エスケープ不要の文字列はそのまま返す", () => {
      expect(escapeFtsQuery("hello world")).toBe("hello world");
    });
  });
});
