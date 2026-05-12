import { describe, it, expect, vi, type Mock } from "vitest";

import { handleAgentEvent } from "../src/services/agent-event-handler.js";
import type { TranslationSessionRepository } from "../src/repositories/translation-session-repository.js";
import type { AgentMetricsRepository } from "../src/repositories/agent-metrics-repository.js";
import type { TranslationSessionRecord, AgentMetricsRecord } from "../src/schemas.js";
import type { Result, AppError } from "@trancall/shared-kernel";

// --- モック ---

function makeSessionRepo(overrides?: Partial<TranslationSessionRepository>): TranslationSessionRepository {
  const defaultRecord: TranslationSessionRecord = {
    id: "00000000-0000-4000-8000-000000000010",
    agentJobId: "00000000-0000-4000-8000-000000000011",
    roomId: "00000000-0000-4000-8000-000000000012" as TranslationSessionRecord["roomId"],
    sourceParticipantId: "00000000-0000-4000-8000-000000000013" as TranslationSessionRecord["sourceParticipantId"],
    targetParticipantId: "00000000-0000-4000-8000-000000000014" as TranslationSessionRecord["targetParticipantId"],
    outputLanguage: "en",
    startedAt: "2026-05-12T00:00:00.000Z",
    endedAt: null,
    durationMs: null,
    billableSeconds: null,
    reason: null,
    createdAt: "2026-05-12T00:00:00.000Z",
  };

  return {
    insert: vi.fn<TranslationSessionRepository["insert"]>().mockResolvedValue({
      ok: true,
      data: defaultRecord,
    }),
    updateEnded: vi.fn<TranslationSessionRepository["updateEnded"]>().mockResolvedValue({
      ok: true,
      data: { ...defaultRecord, endedAt: "2026-05-12T00:01:00.000Z", durationMs: 60000, billableSeconds: 60, reason: "participant_left" },
    }),
    findByAgentJobId: vi.fn<TranslationSessionRepository["findByAgentJobId"]>().mockResolvedValue({
      ok: true,
      data: defaultRecord,
    }),
    ...overrides,
  };
}

function makeMetricsRepo(overrides?: Partial<AgentMetricsRepository>): AgentMetricsRepository {
  const defaultRecord: AgentMetricsRecord = {
    id: "00000000-0000-4000-8000-000000000020",
    agentJobId: "00000000-0000-4000-8000-000000000011",
    roomId: "00000000-0000-4000-8000-000000000012" as AgentMetricsRecord["roomId"],
    latencyMs: {
      captureToAgent: [],
      agentToOpenAI: [],
      openAIFirstDelta: [],
      agentPublish: [],
      totalEndToEnd: [],
    },
    memoryRssBytes: 100000000,
    collectedAt: "2026-05-12T00:00:30.000Z",
    createdAt: "2026-05-12T00:00:30.000Z",
  };

  return {
    insert: vi.fn<AgentMetricsRepository["insert"]>().mockResolvedValue({
      ok: true,
      data: defaultRecord,
    }),
    ...overrides,
  };
}

// --- テスト ---

const roomId = "00000000-0000-4000-8000-000000000012";
const sourceParticipantId = "00000000-0000-4000-8000-000000000013";
const targetParticipantId = "00000000-0000-4000-8000-000000000014";
const agentJobId = "00000000-0000-4000-8000-000000000011";
const sessionId = "00000000-0000-4000-8000-000000000015";

describe("handleAgentEvent", () => {
  describe("translation.session_started", () => {
    it("正常イベントで sessionRepo.insert が呼ばれる", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.session_started",
          agentJobId,
          roomId,
          sourceParticipantId,
          targetParticipantId,
          outputLanguage: "en",
          startedAt: "2026-05-12T00:00:00.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(sessionRepo.insert).toHaveBeenCalledOnce();
      expect(metricsRepo.insert).not.toHaveBeenCalled();
    });
  });

  describe("translation.session_ended", () => {
    it("正常イベントで sessionRepo.updateEnded が呼ばれる", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.session_ended",
          agentJobId,
          roomId,
          sourceParticipantId,
          outputLanguage: "en",
          endedAt: "2026-05-12T00:01:00.000Z",
          durationMs: 60000,
          billableSeconds: 60,
          reason: "participant_left",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(sessionRepo.updateEnded).toHaveBeenCalledOnce();
      expect(sessionRepo.insert).not.toHaveBeenCalled();
    });
  });

  describe("transcript.delta", () => {
    it("正常イベントで ok: true を返す（transcript モジュールへは委譲しない）", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "transcript.delta",
          agentJobId,
          roomId,
          sourceParticipantId,
          outputLanguage: "en",
          sequenceNo: 1,
          text: "Hello world",
          isFinal: false,
          spokenAt: "2026-05-12T00:00:05.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(sessionRepo.insert).not.toHaveBeenCalled();
      expect(metricsRepo.insert).not.toHaveBeenCalled();
    });
  });

  describe("agent.metrics", () => {
    it("正常イベントで metricsRepo.insert が呼ばれる", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "agent.metrics",
          agentJobId,
          roomId,
          latencyMs: {
            captureToAgent: [10, 12, 11],
            agentToOpenAI: [5, 6],
            openAIFirstDelta: [200, 220],
            agentPublish: [3, 4],
            totalEndToEnd: [218, 242],
          },
          memoryRssBytes: 104857600,
          collectedAt: "2026-05-12T00:00:30.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(metricsRepo.insert).toHaveBeenCalledOnce();
    });

    it("空の配列でも valid", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "agent.metrics",
          agentJobId,
          roomId,
          latencyMs: {
            captureToAgent: [],
            agentToOpenAI: [],
            openAIFirstDelta: [],
            agentPublish: [],
            totalEndToEnd: [],
          },
          memoryRssBytes: 0,
          collectedAt: "2026-05-12T00:00:30.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
    });

    it("負のレイテンシ値はバリデーションエラー", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "agent.metrics",
          agentJobId,
          roomId,
          latencyMs: {
            captureToAgent: [-1],
            agentToOpenAI: [],
            openAIFirstDelta: [],
            agentPublish: [],
            totalEndToEnd: [],
          },
          memoryRssBytes: 0,
          collectedAt: "2026-05-12T00:00:30.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("translation.degraded", () => {
    it("正常イベントで ok: true を返す", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.degraded",
          agentJobId,
          roomId,
          sessionId,
          sourceLang: "ja",
          targetLang: "en",
          reason: "openai_ws_reconnecting",
          occurredAt: "2026-05-12T00:00:05.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(sessionRepo.insert).not.toHaveBeenCalled();
      expect(metricsRepo.insert).not.toHaveBeenCalled();
    });

    it("不正な reason でバリデーションエラー", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.degraded",
          agentJobId,
          roomId,
          sessionId,
          sourceLang: "ja",
          targetLang: "en",
          reason: "bad_reason",
          occurredAt: "2026-05-12T00:00:05.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("translation.recovered", () => {
    it("正常イベントで ok: true を返す", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.recovered",
          agentJobId,
          roomId,
          sessionId,
          sourceLang: "ja",
          targetLang: "en",
          degradedDurationMs: 3000,
          occurredAt: "2026-05-12T00:00:10.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(true);
      expect(sessionRepo.insert).not.toHaveBeenCalled();
      expect(metricsRepo.insert).not.toHaveBeenCalled();
    });

    it("degradedDurationMs が負でバリデーションエラー", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "translation.recovered",
          agentJobId,
          roomId,
          sessionId,
          sourceLang: "ja",
          targetLang: "en",
          degradedDurationMs: -100,
          occurredAt: "2026-05-12T00:00:10.000Z",
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("不明な type", () => {
    it("未知の type で VALIDATION_ERROR を返す", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        {
          type: "unknown.event_type",
          agentJobId,
          roomId,
        },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("type フィールドが欠如している場合も VALIDATION_ERROR", async () => {
      const sessionRepo = makeSessionRepo();
      const metricsRepo = makeMetricsRepo();

      const result = await handleAgentEvent(
        { agentJobId, roomId },
        { sessionRepo, metricsRepo },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });
});
