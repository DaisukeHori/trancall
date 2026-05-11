/**
 * シナリオ 4: transcript + translation 結合テスト (3 件)
 *
 * - Agent から session_started event → translation_session 永続化 →
 *   同 sequence_no の segment 2 回 append で 1 件のみ INSERT (冪等)
 * - A が自分の transcript_access を deleteAccess → A の getTranscript は空、
 *   B の getTranscript はまだ全 segment
 * - session_ended event → billable_seconds = ceil(durationMs/1000)
 */

import { describe, it, expect } from "vitest";
import {
  brandUserId,
  brandRoomId,
  brandParticipantId,
} from "@trancall/shared-kernel";
import type { UserId, RoomId, ParticipantId } from "@trancall/shared-kernel";
import type { Profile } from "@trancall/auth";
import { buildFacades } from "../src/mocks/build-facades.js";

// ---- helpers ----

function uid(n: number): UserId {
  const r = brandUserId(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandUserId failed`);
  return r.data;
}

function rid(n: number): RoomId {
  const r = brandRoomId(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandRoomId failed`);
  return r.data;
}

function pid(n: number): ParticipantId {
  const r = brandParticipantId(`30000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandParticipantId failed`);
  return r.data;
}

function makeProfile(userId: UserId): Profile {
  return {
    userId,
    email: `user-${userId.slice(0, 8)}@example.com`,
    displayName: `User`,
    nativeLanguage: "ja",
    trancallId: `user_${userId.slice(0, 8)}`,
    updatedAt: new Date().toISOString(),
  };
}

describe("シナリオ 4: transcript + translation", () => {
  const userA = uid(1);
  const userB = uid(2);
  const roomId = rid(1);
  const participantA = pid(1);
  const participantB = pid(2);
  const agentJobId = "a0000000-0000-4000-8000-000000000001";

  it("4-1: session_started event → translation_session 永続化 → 同 sequence_no の segment 2 回 append で 1 件のみ (冪等)", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA), makeProfile(userB)],
    });

    // translation.session_started イベントを送信
    const sessionStartedEvent = {
      type: "translation.session_started" as const,
      agentJobId,
      roomId: roomId as string,
      sourceParticipantId: participantA as string,
      targetParticipantId: participantB as string,
      outputLanguage: "en",
      startedAt: new Date().toISOString(),
    };

    const startResult = await facades.translation.handleAgentEvent(sessionStartedEvent);
    expect(startResult.ok).toBe(true);

    // セッションが永続化されているか確認
    const sessions = repos.translationSessionRepo._getAll();
    expect(sessions.length).toBe(1);
    const session = sessions[0];
    expect(session).toBeDefined();
    if (session === undefined) return;
    expect(session.agentJobId).toBe(agentJobId);

    // A と B に transcript access を付与
    repos.accessRepo._grantAccess(roomId, userA);
    repos.accessRepo._grantAccess(roomId, userB);

    // 同じ sequence_no のセグメントを 2 回 append (冪等性テスト)
    const segment = {
      segmentId: crypto.randomUUID(),
      roomId,
      participantId: participantA,
      speakerName: "UserA",
      originalText: "こんにちは",
      translatedText: "Hello",
      languagePair: "ja-en",
      startTimeMs: 0,
      endTimeMs: 1000,
      sequenceNo: 0,
      sourceEventId: crypto.randomUUID(),
      agentSessionId: null,
      retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const append1 = await facades.transcript.appendFinalSegment(segment);
    expect(append1.ok).toBe(true);

    const append2 = await facades.transcript.appendFinalSegment(segment);
    expect(append2.ok).toBe(true);

    // segments は 1 件のみ (冪等)
    const allSegments = repos.segmentRepo._getAll();
    expect(allSegments.filter(
      (s) => s.roomId === roomId && s.participantId === participantA && s.sequenceNo === 0,
    ).length).toBe(1);
  });

  it("4-2: A が deleteAccess → A の getTranscript は空 (FORBIDDEN)、B の getTranscript は segment を返す", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA), makeProfile(userB)],
    });

    // A と B に transcript access を付与
    repos.accessRepo._grantAccess(roomId, userA);
    repos.accessRepo._grantAccess(roomId, userB);

    // segment を追加
    const segment = {
      segmentId: crypto.randomUUID(),
      roomId,
      participantId: participantA,
      speakerName: "UserA",
      originalText: "テスト",
      translatedText: "Test",
      languagePair: "ja-en",
      startTimeMs: 0,
      endTimeMs: 500,
      sequenceNo: 0,
      sourceEventId: crypto.randomUUID(),
      agentSessionId: null,
      retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await facades.transcript.appendFinalSegment(segment);

    // B は先に getTranscript できることを確認
    const bBefore = await facades.transcript.getTranscript(roomId, userB);
    expect(bBefore.ok).toBe(true);
    if (!bBefore.ok) return;
    expect(bBefore.data.segments.length).toBeGreaterThan(0);

    // A が自分の access を削除
    const deleteResult = await facades.transcript.deleteAccess(roomId, userA);
    expect(deleteResult.ok).toBe(true);

    // A は getTranscript できなくなる (FORBIDDEN)
    const aAfter = await facades.transcript.getTranscript(roomId, userA);
    expect(aAfter.ok).toBe(false);
    if (aAfter.ok) return;
    expect(aAfter.error.code).toBe("FORBIDDEN");

    // B はまだ getTranscript できる
    const bAfter = await facades.transcript.getTranscript(roomId, userB);
    expect(bAfter.ok).toBe(true);
    if (!bAfter.ok) return;
    expect(bAfter.data.segments.length).toBeGreaterThan(0);
  });

  it("4-3: session_ended event → billable_seconds = ceil(durationMs / 1000)", async () => {
    const { facades, repos } = buildFacades({
      profiles: [makeProfile(userA)],
    });

    // まず session_started
    const startEvent = {
      type: "translation.session_started" as const,
      agentJobId,
      roomId: roomId as string,
      sourceParticipantId: participantA as string,
      targetParticipantId: participantB as string,
      outputLanguage: "en",
      startedAt: new Date().toISOString(),
    };
    await facades.translation.handleAgentEvent(startEvent);

    // session_ended: durationMs = 7300 ms → billable_seconds = ceil(7300/1000) = 8
    const durationMs = 7300;
    const expectedBillableSeconds = Math.ceil(durationMs / 1000); // 8

    const endEvent = {
      type: "translation.session_ended" as const,
      agentJobId,
      roomId: roomId as string,
      sourceParticipantId: participantA as string,
      outputLanguage: "en",
      endedAt: new Date().toISOString(),
      durationMs,
      billableSeconds: expectedBillableSeconds,
      reason: "participant_left" as const,
    };

    const endResult = await facades.translation.handleAgentEvent(endEvent);
    expect(endResult.ok).toBe(true);

    // translation_session に billable_seconds が記録されているか確認
    const sessions = repos.translationSessionRepo._getAll();
    const session = sessions.find((s) => s.agentJobId === agentJobId);
    expect(session).toBeDefined();
    if (session === undefined) return;
    expect(session.billableSeconds).toBe(expectedBillableSeconds);
    expect(session.durationMs).toBe(durationMs);
    // billableSeconds = ceil(durationMs / 1000)
    const actualDurationMs = session.durationMs;
    const actualBillableSeconds = session.billableSeconds;
    if (actualDurationMs !== null && actualBillableSeconds !== null) {
      expect(actualBillableSeconds).toBe(Math.ceil(actualDurationMs / 1000));
    }
  });
});
