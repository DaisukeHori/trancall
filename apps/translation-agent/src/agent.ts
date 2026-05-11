/**
 * LiveKit Agent エントリポイント
 *
 * `defineAgent({ entry })` パターン（agents-js 1.0 公式）。
 * Worker が Job を受け取ったときに `entry(ctx)` が呼ばれ、
 * このプロセスが対象 Room に Agent として参加する。
 *
 * 設計書 docs/agent-flow.md の "Agent Lifecycle" 節を参照。
 *
 * 翻訳パイプライン:
 * - Participant 参加時に metadata から nativeLanguage を取得
 * - 他 Participant の nativeLanguage 向けに TranslationSession を開始
 * - 同言語ペアはセッションをスキップ（shouldStartSession）
 * - LiveKit Audio Track を subscribe して PCM フレームを OpenAI に流す
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
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteAudioTrack,
  TrackKind,
  TrackPublishOptions,
} from "@livekit/rtc-node";

import { OutputLanguage } from "@trancall/shared-kernel";

import { type Config } from "./config.js";
import {
  InternalApiClient,
} from "./internal-api-client.js";
import { type Logger } from "./logger.js";
import { parseParticipantMetadata } from "./participant-metadata.js";
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

// --- shouldStartSession (同言語ペアをスキップ) ---

/**
 * 翻訳セッションを開始すべきかどうかを判定する。
 * sourceLang と targetLang が同じ場合は翻訳不要なので false を返す。
 * docs/module-contracts.md Section 2.7 の `shouldStartSession` 仕様に相当する
 * Agent-side の同等実装（Server の TranslationFacade は別プロセスのため直接呼べない）。
 */
function shouldStartSession(
  sourceLang: OutputLanguage,
  targetLang: OutputLanguage,
): boolean {
  return sourceLang !== targetLang;
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
    //   Key: `${sourceParticipantIdentity}-${outputLanguage}`
    //   Value: TranslationSession
    //
    //   N対N通話の場合、1 participant あたり (n-1) セッション生成される
    //   （他参加者の数だけ翻訳セッションが必要）。
    //   Phase 1a は 1対1 のみなので最大 2 セッション。
    const sessions = new Map<string, TranslationSession>();

    // 各 Participant の nativeLanguage を記憶（再参加時の参照に使う）
    const participantLanguages = new Map<string, OutputLanguage>();

    function sessionKey(sourceIdentity: string, outputLanguage: string): string {
      return `${sourceIdentity}-${outputLanguage}`;
    }

    /**
     * 参加者 A の音声を参加者 B 向けに翻訳するセッションを開始する。
     * - sourceIdentity: 音声発話者 (A)
     * - sourceParticipantId: A の LiveKit SID
     * - sourceLang: A の母国語
     * - targetIdentity: 翻訳受信者 (B)
     * - targetParticipantId: B の LiveKit SID
     * - targetLang: B の母国語 = A の発話を翻訳する先の言語
     */
    async function startSession(
      sourceIdentity: string,
      sourceParticipantId: string,
      sourceLang: OutputLanguage,
      targetIdentity: string,
      targetParticipantId: string,
      targetLang: OutputLanguage,
    ): Promise<void> {
      const key = sessionKey(sourceIdentity, targetLang);
      if (sessions.has(key)) {
        logger.debug("Agent: セッション既存、スキップ", { key });
        return;
      }

      if (!shouldStartSession(sourceLang, targetLang)) {
        logger.info("Agent: 同言語ペア、セッションスキップ", {
          sourceLang,
          targetLang,
          sourceIdentity,
          targetIdentity,
        });
        return;
      }

      logger.info("Agent: TranslationSession 開始", {
        sourceIdentity,
        targetIdentity,
        sourceLang,
        targetLang,
        key,
      });

      // Room name を roomId として使用（未設定の場合は空文字列でフォールバック）
      const roomId = ctx.room.name ?? "";

      const session = new TranslationSession({
        roomId,
        sourceParticipantId,
        targetParticipantId,
        outputLanguage: targetLang,
        openaiApiKey: deps.config.OPENAI_API_KEY,
        openaiUrl: deps.config.OPENAI_REALTIME_TRANSLATE_URL,
        sampleRateHz: 24000,
        internalApiClient: deps.internalApiClient,
        logger: logger.child({
          component: "TranslationSession",
          sourceIdentity,
          targetLang,
        }),
      });

      sessions.set(key, session);

      session.on("error", (error: Error) => {
        logger.error("TranslationSession エラー", {
          key,
          error: error.message,
        });
      });

      session.on("ended", (reason: string) => {
        logger.info("TranslationSession 終了", { key, reason });
        sessions.delete(key);
      });

      await session.start();

      // source Participant の Audio Track を subscribe して PCM フレームをパイプライン
      // AudioSource + LocalAudioTrack を使って翻訳済み音声を Publish する
      const audioSource = new AudioSource(24000, 1);
      const publishTrack = LocalAudioTrack.createAudioTrack(
        `trans-${sourceIdentity}-to-${targetLang}`,
        audioSource,
      );

      // 翻訳済み音声 (Base64 PCM16) → AudioSource → LiveKit Track へ流す
      session.on("translated-audio", (pcm16Base64: string) => {
        const pcmBuffer = Buffer.from(pcm16Base64, "base64");
        const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
        const samplesPerChannel = int16.length;
        const frame = new AudioFrame(int16, 24000, 1, samplesPerChannel);
        void audioSource.captureFrame(frame);
      });

      // LocalParticipant として翻訳音声 Track を Publish
      if (ctx.agent) {
        await ctx.agent.publishTrack(publishTrack, new TrackPublishOptions());
        logger.info("Agent: 翻訳 Track Publish 完了", {
          trackName: `trans-${sourceIdentity}-to-${targetLang}`,
        });
      }

      // source Participant の既存 audio track を購読してパイプライン開始
      const sourceParticipant = ctx.room.remoteParticipants.get(sourceIdentity);
      if (sourceParticipant) {
        for (const pub of sourceParticipant.trackPublications.values()) {
          if (pub.kind === TrackKind.KIND_AUDIO && pub.track instanceof RemoteAudioTrack) {
            void pipeAudioTrack(pub.track, session);
          }
        }
      }
    }

    /**
     * RemoteAudioTrack → TranslationSession.pushAudioFrame() パイプライン。
     * AudioStream (ReadableStream<AudioFrame>) から reader API で非同期に読み取る。
     */
    async function pipeAudioTrack(
      track: RemoteAudioTrack,
      session: TranslationSession,
    ): Promise<void> {
      const stream = new AudioStream(track, 24000, 1);
      const reader = stream.getReader();
      logger.debug("Agent: AudioStream パイプライン開始", {
        trackSid: track.sid,
        sessionJobId: session.getAgentJobId(),
      });
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const frame = result.value;
          // PCM16 Int16Array を Base64 に変換して OpenAI に送信
          const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
          const pcm16Base64 = pcmBuffer.toString("base64");
          session.pushAudioFrame(pcm16Base64);
        }
      } catch (e: unknown) {
        logger.warn("Agent: AudioStream パイプライン終了", {
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        reader.releaseLock();
      }
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
      participantSid: string | undefined,
      participantMetadata: string | undefined,
    ): void {
      logger.info("Agent: Participant 参加", {
        identity: participantIdentity,
        sid: participantSid,
        hasMetadata: participantMetadata !== undefined,
      });

      // metadata から nativeLanguage を取得
      const metaResult = parseParticipantMetadata(participantMetadata);
      if (!metaResult.ok) {
        logger.warn("Agent: metadata パース失敗", {
          identity: participantIdentity,
          error: metaResult.error,
        });
        return;
      }

      const sourceLang = metaResult.data.nativeLanguage;
      participantLanguages.set(participantIdentity, sourceLang);

      // 他の全 Participant に対してセッションを開始
      for (const [otherIdentity, otherParticipant] of ctx.room.remoteParticipants.entries()) {
        if (otherIdentity === participantIdentity) continue;

        const otherLangResult = participantLanguages.get(otherIdentity);
        if (!otherLangResult) {
          // 相手の言語がまだわからない場合はスキップ（相手が参加した時にこちら向けを開始する）
          continue;
        }

        const sourceParticipantId = participantSid ?? participantIdentity;
        const targetParticipantId = otherParticipant.sid ?? otherIdentity;

        // 新参加者が話す音声を他の参加者の言語に翻訳するセッション
        void startSession(
          participantIdentity,
          sourceParticipantId,
          sourceLang,
          otherIdentity,
          targetParticipantId,
          otherLangResult,
        );

        // 逆方向: 既存参加者の音声を新参加者の言語に翻訳するセッション
        // （既存参加者がすでに到達しているなら）
        void startSession(
          otherIdentity,
          targetParticipantId,
          otherLangResult,
          participantIdentity,
          sourceParticipantId,
          sourceLang,
        );
      }
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

      // 言語情報をクリア
      participantLanguages.delete(participantIdentity);

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
      handleParticipantConnected(participant.identity, participant.sid, participant.metadata);
    });

    ctx.room.on("participantDisconnected", (participant) => {
      handleParticipantDisconnected(participant.identity);
    });

    // trackSubscribed イベント: 新しい音声トラックが subscribe されたらパイプラインに追加
    ctx.room.on("trackSubscribed", (track, _publication, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      if (!(track instanceof RemoteAudioTrack)) return;

      const sourceLang = participantLanguages.get(participant.identity);
      if (!sourceLang) return;

      // この track を使っているすべてのセッションにパイプライン接続
      for (const [, targetParticipant] of ctx.room.remoteParticipants.entries()) {
        if (targetParticipant.identity === participant.identity) continue;
        const targetLang = participantLanguages.get(targetParticipant.identity);
        if (!targetLang) continue;

        const key = sessionKey(participant.identity, targetLang);
        const session = sessions.get(key);
        if (session) {
          void pipeAudioTrack(track, session);
        }
      }
    });

    // 既に Room にいる Participant についても処理
    for (const participant of ctx.room.remoteParticipants.values()) {
      handleParticipantConnected(participant.identity, participant.sid, participant.metadata);
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
