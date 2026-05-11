/**
 * Agent Event Handler
 *
 * Server 側の POST /internal/agent/events ハンドラから呼ばれる。
 * イベント type で分岐し、適切なリポジトリに処理を委譲する。
 *
 * 責務:
 * - Agent Event の Zod バリデーション
 * - translation.session_started → TranslationSessionRepository.insert
 * - translation.session_ended   → TranslationSessionRepository.updateEnded
 * - transcript.delta            → (outbox へ転送 or transcript モジュールへ委譲)
 * - agent.metrics               → AgentMetricsRepository.insert
 * - 不明な type → VALIDATION_ERROR
 */

import { randomUUID } from "node:crypto";

import { validate, type Result, type AppError } from "@trancall/shared-kernel";
import { OutputLanguage, RoomIdSchema, ParticipantIdSchema } from "@trancall/shared-kernel";

import {
  AgentEventSchema,
  type SessionStartedPayload,
  type SessionEndedPayload,
  type AgentMetricsPayload,
} from "../schemas.js";
import type { TranslationSessionRepository } from "../repositories/translation-session-repository.js";
import type { AgentMetricsRepository } from "../repositories/agent-metrics-repository.js";

export interface AgentEventHandlerDeps {
  sessionRepo: TranslationSessionRepository;
  metricsRepo: AgentMetricsRepository;
}

/**
 * 生の unknown ペイロードを受け取り、型別にリポジトリへ委譲する。
 */
export async function handleAgentEvent(
  rawEvent: unknown,
  deps: AgentEventHandlerDeps,
): Promise<Result<true, AppError>> {
  const parsed = validate(AgentEventSchema, rawEvent);
  if (!parsed.ok) {
    return parsed;
  }

  const event = parsed.data;

  switch (event.type) {
    case "translation.session_started":
      return handleSessionStarted(event, deps.sessionRepo);

    case "translation.session_ended":
      return handleSessionEnded(event, deps.sessionRepo);

    case "transcript.delta":
      // transcript.delta は transcript モジュールに委譲するが、
      // translation パッケージはそのモジュールを依存しない。
      // Server 側ハンドラがこの戻り値を見て transcript モジュールを呼ぶ。
      return { ok: true, data: true };

    case "agent.metrics":
      return handleAgentMetrics(event, deps.metricsRepo);

    default: {
      // exhaustive check — TypeScript が未処理 type を検出する
      const _never: never = event;
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `未知のイベント type: ${String((_never as { type: string }).type)}`,
          retryable: false,
        },
      };
    }
  }
}

// --- ハンドラ個別実装 ---

async function handleSessionStarted(
  event: SessionStartedPayload,
  repo: TranslationSessionRepository,
): Promise<Result<true, AppError>> {
  // outputLanguage は共有型として OutputLanguage enum で検証
  const langResult = OutputLanguage.safeParse(event.outputLanguage);
  if (!langResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `outputLanguage が不正: ${event.outputLanguage}`,
        retryable: false,
      },
    };
  }

  const roomResult = RoomIdSchema.safeParse(event.roomId);
  if (!roomResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `roomId が不正: ${event.roomId}`,
        retryable: false,
      },
    };
  }

  const sourceResult = ParticipantIdSchema.safeParse(event.sourceParticipantId);
  if (!sourceResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `sourceParticipantId が不正`,
        retryable: false,
      },
    };
  }

  const targetResult = ParticipantIdSchema.safeParse(event.targetParticipantId);
  if (!targetResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `targetParticipantId が不正`,
        retryable: false,
      },
    };
  }

  const result = await repo.insert({
    id: randomUUID(),
    agentJobId: event.agentJobId,
    roomId: roomResult.data,
    sourceParticipantId: sourceResult.data,
    targetParticipantId: targetResult.data,
    outputLanguage: langResult.data,
    startedAt: event.startedAt,
    endedAt: null,
    durationMs: null,
    billableSeconds: null,
    reason: null,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: true };
}

async function handleSessionEnded(
  event: SessionEndedPayload,
  repo: TranslationSessionRepository,
): Promise<Result<true, AppError>> {
  const result = await repo.updateEnded(event.agentJobId, {
    endedAt: event.endedAt,
    durationMs: event.durationMs,
    billableSeconds: event.billableSeconds,
    reason: event.reason,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: true };
}

async function handleAgentMetrics(
  event: AgentMetricsPayload,
  repo: AgentMetricsRepository,
): Promise<Result<true, AppError>> {
  const roomResult = RoomIdSchema.safeParse(event.roomId);
  if (!roomResult.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `roomId が不正: ${event.roomId}`,
        retryable: false,
      },
    };
  }

  const result = await repo.insert({
    agentJobId: event.agentJobId,
    roomId: roomResult.data,
    latencyMs: event.latencyMs,
    memoryRssBytes: event.memoryRssBytes,
    collectedAt: event.collectedAt,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: true };
}
