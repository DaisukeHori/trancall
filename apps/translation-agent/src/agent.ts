/**
 * LiveKit Agent エントリポイント
 *
 * `defineAgent({ entry })` パターン（agents-js 1.0 公式）。
 * Worker が Job を受け取ったときに `entry(ctx)` が呼ばれ、
 * このプロセスが対象 Room に Agent として参加する。
 *
 * 設計書 docs/agent-flow.md の "Agent Lifecycle" 節を参照。
 *
 * Phase 1a Sprint 0 のスコープ:
 * - Room 参加と Participant 監視まで実装（ステップ 1-3）
 * - 実際の音声トラック処理は Sprint 1 以降（gate-check.ts で並行検証）
 *
 * 同一 Room に Agent が複数 attach されないようにする戦略:
 *   - LiveKit Server の Job Assignment 機構に従い、Worker は agentName を含む
 *     Job のみを accept する。複数 Worker が同じ Job を取りに行った場合は
 *     LiveKit Server が片方だけに割り当てるため、Worker 側で追加処理は不要。
 *   - Room metadata に agentJobId を書き込み、もし「先客」がいたら graceful shutdown。
 *     ただしこれは Phase 1b 以降（複数 Worker をスケールアウトする段階で必要）。
 */

import type { JobContext, JobProcess } from "@livekit/agents";
import { defineAgent } from "@livekit/agents";

import { type Config } from "./config.js";
import {
  InternalApiClient,
} from "./internal-api-client.js";
import { type Logger } from "./logger.js";
import {
  TranslationSession,
} from "./translation-session.js";

// --- DI コンテナ的なもの ---
//
// Worker プロセス全体で 1 つだけ生成する依存（config, logger, internalApiClient）と、
// Job ごとに生成する依存（TranslationSession）を分離する。

interface AgentDependencies {
  config: Config;
  logger: Logger;
  internalApiClient: InternalApiClient;
}

let dependencies: AgentDependencies | null = null;

export function injectDependencies(deps: AgentDependencies): void {
  dependencies = deps;
}

export function getDependencies(): AgentDependencies {
  if (!dependencies) {
    throw new Error(
      "Agent dependencies が未注入。index.ts で injectDependencies() を呼び出してください。",
    );
  }
  return dependencies;
}

// --- defineAgent ---

export default defineAgent({
  prewarm: async (_proc: JobProcess) => {
    // Worker プロセス起動時、最初の Job 受信前に呼ばれる。
    // 重いリソース（VAD モデルなど）の事前ロードに使う。
    // 現状 TranCall では LLM/STT/TTS を使わないため特に処理なし。
    const deps = getDependencies();
    deps.logger.info("Agent: prewarm 完了");
    await Promise.resolve();
  },

  entry: async (ctx: JobContext) => {
    const deps = getDependencies();
    const logger = deps.logger.child({
      jobId: ctx.job.id,
      roomName: ctx.room.name,
    });

    logger.info("Agent: Job 受信", {
      jobType: String(ctx.job.type),
    });

    // 1. Room に参加
    await ctx.connect();
    logger.info("Agent: Room 接続成功");

    // 2. アクティブな翻訳セッションの管理
    //
    //   Key: `${sourceParticipantId}-${outputLanguage}`
    //   Value: TranslationSession
    //
    //   N対N通話の場合、1 participant あたり (n-1) セッション生成される
    //   （他参加者の数だけ翻訳セッションが必要）。
    //   Phase 1a は 1対1 のみなので最大 2 セッション。
    const sessions = new Map<string, TranslationSession>();

    function sessionKey(sourceParticipantId: string, outputLanguage: string): string {
      return `${sourceParticipantId}-${outputLanguage}`;
    }

    // 3. 既存参加者および新規参加者をハンドリング
    //
    //   各 Participant の metadata から nativeLanguage を読み取り、
    //   他の Participant に向けて翻訳セッションを開く。
    //
    //   metadata は **Server-side token 発行時に焼き込まれる**（C-005 対応）。
    //   Client は metadata を書き換えできない（grant: canUpdateMetadata=false）。

    function handleParticipantConnected(
      participantIdentity: string,
      participantMetadata: string | undefined,
    ): void {
      logger.info("Agent: Participant 参加", {
        identity: participantIdentity,
        hasMetadata: participantMetadata !== undefined,
      });

      // TODO Sprint 1: metadata から nativeLanguage を読み取り、
      //   他 Participant 全員に対して TranslationSession を開く。
      //   - 自分が話した音声を、他者の nativeLanguage に翻訳して返す
      //
      //   実装スケッチ:
      //     const meta = parseParticipantMetadata(participantMetadata);
      //     for (const other of ctx.room.remoteParticipants.values()) {
      //       const otherMeta = parseParticipantMetadata(other.metadata);
      //       const sess = new TranslationSession({...});
      //       sessions.set(sessionKey(other.sid, meta.nativeLanguage), sess);
      //       await sess.start();
      //     }
    }

    function handleParticipantDisconnected(participantIdentity: string): void {
      logger.info("Agent: Participant 退出", { identity: participantIdentity });

      // 当該 Participant が source/target になっているセッションを全て終了
      for (const [key, sess] of sessions.entries()) {
        if (key.startsWith(`${participantIdentity}-`)) {
          void sess.end("participant_left");
          sessions.delete(key);
        }
      }

      // Room に残り 1 名 以下になったら Agent も退出
      // remoteParticipants は自分（Agent）以外の参加者数
      if (ctx.room.remoteParticipants.size <= 1) {
        logger.info("Agent: 残り参加者 1 名以下、Agent 退出");
        for (const [key, sess] of sessions.entries()) {
          void sess.end("agent_shutdown");
          sessions.delete(key);
        }
        ctx.shutdown();
      }
    }

    // LiveKit Room イベント listener 登録
    // agents-js 1.0 では ctx.room は LiveKit Room SDK のインスタンスをラップしている
    ctx.room.on("participantConnected", (participant) => {
      handleParticipantConnected(participant.identity, participant.metadata);
    });

    ctx.room.on("participantDisconnected", (participant) => {
      handleParticipantDisconnected(participant.identity);
    });

    // 既に Room にいる Participant についても処理
    for (const participant of ctx.room.remoteParticipants.values()) {
      handleParticipantConnected(participant.identity, participant.metadata);
    }

    // 4. Shutdown フック
    //
    //   ctx.shutdown() が呼ばれた、または LiveKit Server から disconnect された場合に
    //   全てのセッションを cleanup する。
    ctx.addShutdownCallback(async () => {
      logger.info("Agent: Shutdown 開始");
      const endPromises: Promise<void>[] = [];
      for (const [, sess] of sessions.entries()) {
        endPromises.push(sess.end("agent_shutdown"));
      }
      sessions.clear();
      await Promise.all(endPromises);
      logger.info("Agent: Shutdown 完了");
    });

    logger.info("Agent: 起動完了、Participant を待機中");
  },
});
