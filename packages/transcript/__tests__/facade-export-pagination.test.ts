/**
 * TranscriptFacade.exportTranscript — 分割エクスポート (M-3)
 *
 * 1000 セグメント超のエクスポートが TRANSCRIPT_EXPORT_TOO_LARGE ハードエラーになっていた
 * (packages/transcript/src/facade.ts:248 旧実装) のを、パート分割エクスポートに置き換えた。
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createTranscriptFacade } from "../src/facade.js";
import { InMemorySegmentRepository, InMemoryAccessRepository } from "./helpers/stubs.js";
import { makeAccessRecord, ROOM_ID, PARTICIPANT_A, USER_A } from "./helpers/fixtures.js";
import type { TranscriptSegment } from "../src/schemas.js";

async function seedSegments(
  segmentRepo: InMemorySegmentRepository,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const segment: TranscriptSegment = {
      segmentId: randomUUID(),
      roomId: ROOM_ID,
      participantId: PARTICIPANT_A,
      speakerName: "Alice",
      originalText: `segment ${i}`,
      translatedText: `translated ${i}`,
      languagePair: "ja-en",
      startTimeMs: i * 1000,
      endTimeMs: i * 1000 + 500,
      sequenceNo: i,
      sourceEventId: randomUUID(),
      agentSessionId: null,
      retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await segmentRepo.upsert(segment);
  }
}

function makeFacade() {
  const segmentRepo = new InMemorySegmentRepository();
  const accessRepo = new InMemoryAccessRepository();
  accessRepo.addRecord(makeAccessRecord(USER_A));
  const facade = createTranscriptFacade(segmentRepo, accessRepo);
  return { facade, segmentRepo, accessRepo };
}

describe("TranscriptFacade.exportTranscript — 1000 セグメント以下 (後方互換)", () => {
  it("partIndex を省略した場合、totalParts=1 / hasMore=false / partIndex=0 を返す", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 10);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalParts).toBe(1);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.partIndex).toBe(0);
    expect(result.data.totalSegments).toBe(10);
  });

  it("ファイル名にパート番号のサフィックスが付かない (既存の命名規則を維持)", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 10);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filename).not.toContain("-part");
    expect(result.data.filename).toMatch(/^trancall-transcript-\d{8}-\d{4}-[0-9a-f]{8}\.txt$/);
  });

  it("ちょうど 1000 セグメントでも 1 パートに収まる", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1000);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalParts).toBe(1);
    expect(result.data.hasMore).toBe(false);
  });
});

describe("TranscriptFacade.exportTranscript — 1000 セグメント超 (M-3 分割エクスポート)", () => {
  it("1500 セグメントは 2 パートに分割される (旧: TOO_LARGE エラー)", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalParts).toBe(2);
    expect(result.data.partIndex).toBe(0);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.totalSegments).toBe(1500);
  });

  it("part 1 目のファイル名は '-part1of2' サフィックスを含む", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filename).toContain("-part1of2");
  });

  it("part 2 目 (partIndex=1) は残り 500 セグメントを含み hasMore=false", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.partIndex).toBe(1);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.filename).toContain("-part2of2");

    // part 2 (0-based index 1000-1499) の本文には segment 1000 (2 パート目の最初) が含まれ、
    // segment 999 (1 パート目最後) は含まれない
    const buf = Buffer.from(result.data.contentBase64, "base64");
    const text = buf.slice(3).toString("utf8"); // BOM 除去
    expect(text).toContain("segment 1000");
    expect(text).toContain("segment 1499");
    expect(text).not.toContain("原文: segment 999\n");
  });

  it("part 1 の本文には最初の 1000 セグメントのみ含まれる (1001 個目は含まれない)", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buf = Buffer.from(result.data.contentBase64, "base64");
    const text = buf.slice(3).toString("utf8");
    expect(text).toContain("segment 0");
    expect(text).toContain("segment 999");
    expect(text).not.toContain("segment 1000\n");
  });

  it(
    "PDF 形式でも分割エクスポートが成功する",
    async () => {
      const { facade, segmentRepo } = makeFacade();
      await seedSegments(segmentRepo, 1200);

      const result = await facade.exportTranscript(ROOM_ID, USER_A, "pdf", 1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const buf = Buffer.from(result.data.contentBase64, "base64");
      expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      expect(result.data.totalParts).toBe(2);
      expect(result.data.partIndex).toBe(1);
    },
    // 200 segments 分の PDF フォント埋め込み処理は CI ランナー (低速環境) では
    // vitest デフォルトの 5000ms を超える (実測 ~5.8s)。ローカルでは収まるが CI
    // 固有の実行速度差のため、この重い1テストのみ明示的にタイムアウトを延長する
    // (vitest 自身のエラーメッセージが推奨する対処)。
    15000,
  );

  it("負の partIndex は TRANSCRIPT_EXPORT_INVALID_PART (400) を返す", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", -1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_INVALID_PART");
    expect(result.error.httpStatus).toBe(400);
  });

  it("範囲外 (totalParts 以上) の partIndex は TRANSCRIPT_EXPORT_INVALID_PART を返す", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500); // totalParts=2 (0, 1 のみ有効)

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_INVALID_PART");
  });

  it("非整数の partIndex は TRANSCRIPT_EXPORT_INVALID_PART を返す", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 1500);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 0.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_INVALID_PART");
  });

  it("1000 セグメント以下では partIndex=0 のみ有効 (1 は無効)", async () => {
    const { facade, segmentRepo } = makeFacade();
    await seedSegments(segmentRepo, 10);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_INVALID_PART");
  });
});

describe("TranscriptFacade.exportTranscript — 分割エクスポートでも既存のガードは維持される", () => {
  it("アクセス権がない場合 TRANSCRIPT_EXPORT_FORBIDDEN を返す (partIndex 未指定でも)", async () => {
    const segmentRepo = new InMemorySegmentRepository();
    const accessRepo = new InMemoryAccessRepository();
    // access record を追加しない = 権限なし
    const facade = createTranscriptFacade(segmentRepo, accessRepo);

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_FORBIDDEN");
  });

  it("segments が 0 件の場合 TRANSCRIPT_EXPORT_EMPTY を返す", async () => {
    const { facade } = makeFacade();

    const result = await facade.exportTranscript(ROOM_ID, USER_A, "txt");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSCRIPT_EXPORT_EMPTY");
  });
});
