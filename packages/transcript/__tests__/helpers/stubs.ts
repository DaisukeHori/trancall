/**
 * テスト用 in-memory stub 実装
 */

import { ok, err, type Result } from "@trancall/shared-kernel";
import type { AppError, RoomId, UserId, ParticipantId } from "@trancall/shared-kernel";
import type { TranscriptSegment, TranscriptAccess } from "../../src/schemas.js";
import type { SegmentRepository } from "../../src/repositories/segment-repository.js";
import type { AccessRepository } from "../../src/repositories/access-repository.js";

// ---------------------------------------------------------------------------
// InMemorySegmentRepository
// ---------------------------------------------------------------------------

export class InMemorySegmentRepository implements SegmentRepository {
  private segments: TranscriptSegment[] = [];

  async upsert(segment: TranscriptSegment): Promise<Result<true, AppError>> {
    // UNIQUE(room_id, participant_id, sequence_no) 制約チェック
    const exists = this.segments.some(
      (s) =>
        s.roomId === segment.roomId &&
        s.participantId === segment.participantId &&
        s.sequenceNo === segment.sequenceNo,
    );
    if (exists) {
      // 冪等: 既存なら何もせず ok を返す
      return ok(true);
    }
    this.segments.push(segment);
    return ok(true);
  }

  async findByRoomId(
    roomId: RoomId,
  ): Promise<Result<TranscriptSegment[], AppError>> {
    const result = this.segments
      .filter((s) => s.roomId === roomId)
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
    return ok(result);
  }

  async getNextSequenceNo(
    roomId: RoomId,
    participantId: ParticipantId,
  ): Promise<Result<number, AppError>> {
    const existing = this.segments.filter(
      (s) => s.roomId === roomId && s.participantId === participantId,
    );
    if (existing.length === 0) {
      return ok(0);
    }
    const maxSeq = Math.max(...existing.map((s) => s.sequenceNo));
    return ok(maxSeq + 1);
  }

  async searchByFts(
    roomId: RoomId,
    query: string,
  ): Promise<Result<TranscriptSegment[], AppError>> {
    const lowerQuery = query.toLowerCase();
    const result = this.segments.filter(
      (s) =>
        s.roomId === roomId &&
        (s.originalText.toLowerCase().includes(lowerQuery) ||
          (s.translatedText ?? "").toLowerCase().includes(lowerQuery)),
    );
    return ok(result);
  }

  // テスト補助
  getAll(): TranscriptSegment[] {
    return [...this.segments];
  }

  clear(): void {
    this.segments = [];
  }
}

// ---------------------------------------------------------------------------
// InMemoryAccessRepository
// ---------------------------------------------------------------------------

export class InMemoryAccessRepository implements AccessRepository {
  private records: TranscriptAccess[] = [];

  addRecord(record: TranscriptAccess): void {
    this.records.push(record);
  }

  async canView(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<boolean, AppError>> {
    const found = this.records.find(
      (r) => r.roomId === roomId && r.userId === userId,
    );
    if (!found) {
      return ok(false);
    }
    return ok(found.canView && found.deletedAt === null);
  }

  async softDelete(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<true, AppError>> {
    const idx = this.records.findIndex(
      (r) => r.roomId === roomId && r.userId === userId,
    );
    if (idx === -1) {
      return err({
        code: "NOT_FOUND",
        message: "transcript_access が見つかりません",
        retryable: false,
        httpStatus: 404,
      });
    }
    const record = this.records[idx];
    if (record !== undefined) {
      this.records[idx] = { ...record, deletedAt: new Date().toISOString() };
    }
    return ok(true);
  }

  async findOne(
    roomId: RoomId,
    userId: UserId,
  ): Promise<Result<TranscriptAccess, AppError>> {
    const found = this.records.find(
      (r) => r.roomId === roomId && r.userId === userId,
    );
    if (!found) {
      return err({
        code: "NOT_FOUND",
        message: "transcript_access が見つかりません",
        retryable: false,
        httpStatus: 404,
      });
    }
    return ok(found);
  }

  clear(): void {
    this.records = [];
  }
}
