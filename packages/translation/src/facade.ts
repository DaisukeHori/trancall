/**
 * Translation Facade — Server 側 Public API
 *
 * Server サイドの `apps/server` からのみ使用される。
 * Agent イベントを受信・永続化し、billing 連携のための利用量を提供する。
 *
 * 重要: 実際の翻訳処理（OpenAI WS 接続、音声フレーム送受信）は
 *        apps/translation-agent が担い、このモジュールは関与しない。
 */

import type { Result } from "@trancall/shared-kernel";
import { validate } from "@trancall/shared-kernel";

import type { TranslationUsage } from "./schemas";
import { LiveSubtitleDeltaSchema } from "./schemas";
import type { LiveSubtitleDelta } from "./schemas";
import { handleAgentEvent } from "./services/agent-event-handler";
import { calcUsageFromRecord } from "./services/usage-calculator";
import { shouldStartSession } from "./services/language-pair";
import type { TranslationSessionRepository } from "./repositories/translation-session-repository";
import type { AgentMetricsRepository } from "./repositories/agent-metrics-repository";
import type { OutputLanguage } from "@trancall/shared-kernel";

export interface TranslationFacadeDeps {
  sessionRepo: TranslationSessionRepository;
  metricsRepo: AgentMetricsRepository;
}

export interface TranslationFacade {
  /**
   * Agent からの event を Server 側で受け取り処理する。
   * HMAC 検証・冪等性チェックは呼び出し元（Server ハンドラ）が行う。
   */
  handleAgentEvent: (event: unknown) => Promise<Result<true>>;

  /**
   * 当該 session の利用量取得。
   * billing が translation.ended イベント購読時に使う。
   */
  getUsage: (agentJobId: string) => Promise<Result<TranslationUsage>>;

  /**
   * 同言語判定 utility。
   * sourceNativeLanguage === targetNativeLanguage なら翻訳セッション不要。
   */
  shouldStartSession: (
    sourceNativeLanguage: OutputLanguage,
    targetNativeLanguage: OutputLanguage,
  ) => boolean;

  /**
   * LiveSubtitleDelta バリデーション（data channel 受信時）。
   */
  validateLiveDelta: (rawDelta: unknown) => Result<LiveSubtitleDelta>;
}

export function createTranslationFacade(
  deps: TranslationFacadeDeps,
): TranslationFacade {
  return {
    handleAgentEvent: (event) =>
      handleAgentEvent(event, {
        sessionRepo: deps.sessionRepo,
        metricsRepo: deps.metricsRepo,
      }),

    getUsage: async (agentJobId) => {
      const found = await deps.sessionRepo.findByAgentJobId(agentJobId);
      if (!found.ok) {
        return found;
      }
      if (found.data === null) {
        return {
          ok: false,
          error: {
            code: "TRANSLATION_SESSION_NOT_FOUND",
            message: `agentJobId=${agentJobId} のセッションが見つかりません`,
            retryable: false,
            httpStatus: 404,
          },
        };
      }
      return calcUsageFromRecord(found.data);
    },

    shouldStartSession,

    validateLiveDelta: (rawDelta) => validate(LiveSubtitleDeltaSchema, rawDelta),
  };
}
