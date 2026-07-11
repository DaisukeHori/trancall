/**
 * LiveKit Agent エントリポイント
 *
 * `defineAgent({ entry })` パターン（agents-js 1.0 公式）。
 * Worker が Job を受け取ったときに `entry(ctx)` が呼ばれ、
 * このプロセスが対象 Room に Agent として参加する。
 *
 * 設計書 docs/translation-pipeline-design.md (D1) T1-T8 準拠。
 *
 * 翻訳パイプライン:
 * - Participant 参加時に metadata から nativeLanguage を取得
 * - 他 Participant の nativeLanguage 向けに TranslationSession を開始
 * - 同言語ペアはセッションをスキップ（shouldStartSession）
 * - LiveKit Audio Track を subscribe して PCM フレームを OpenAI に流す
 *
 * T3: captureToAgent 計測点を pipeAudioTrack に追加 (reader.read() 直後にタイムスタンプ採取)
 * T5: agentPublish 計測点を translated-audio ハンドラに追加 (captureFrame 前後)
 * T8: publish 失敗カウンタ管理 (連続 3 回で session.end("agent_publish_failed"))
 *
 * #51: Data Channel の topic を module-contracts.md §3.4 の canonical (`translation.status`) に
 * 明示統一。subtitle.delta / translation.degraded / translation.recovered の 3 種を
 * 同一 topic 上の discriminated union (TranslationStatusChannelPayloadSchema) として送信する。
 * 訂正 (2026-07 敵対的レビュー確定#6): 送信側 (本ファイル) の実装・topic 名は完了しているが、
 * apps/mobile 側の受信 consumer (`apps/mobile/src/lib/livekit/translation-status.ts` で
 * 同 topic・同 schema を受信し画面表示に配線する部分) は未着手・未配線。
 * mobile 側の字幕表示配線は別 Wave (#51 の続き) で対応する。
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
import type { LocalParticipant } from "@livekit/rtc-node";

import { OutputLanguage } from "@trancall/shared-kernel";

// #51: Data Channel の topic (module-contracts.md §3.4 canonical、apps/mobile 側の
// TRANSLATION_STATUS_CHANNEL_TOPIC (apps/mobile/src/lib/livekit/translation-status.ts) と一致させる)。
// @trancall/translation の直接 import は禁止のため、payload 型はここで手動ミラーする
// (T-14 の既存方針を踏襲)。export してテストから topic 一致を検証できるようにする。
export const TRANSLATION_STATUS_CHANNEL_TOPIC = "translation.status";

// T-14: Data Channel payload 型（module-contracts.md §3.4 に準拠）
export interface DegradedChannelPayload {
  type: "translation.degraded";
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  reason: "openai_ws_reconnecting" | "high_latency" | "output_silence";
  timestamp: string;
}

export interface RecoveredChannelPayload {
  type: "translation.recovered";
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  degradedDurationMs: number;
  timestamp: string;
}

// #51: subtitle.delta Data Channel payload 型（module-contracts.md §3.4 /
// packages/translation/src/schemas.ts の TranslationStatusChannelPayloadSchema と一致させる）
export interface SubtitleDeltaChannelPayload {
  type: "subtitle.delta";
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  text: string;
  elapsedMs: number;
  isFinal: boolean;
  timestamp: string;
}

export type TranslationStatusChannelPayload =
  | DegradedChannelPayload
  | RecoveredChannelPayload
  | SubtitleDeltaChannelPayload;

/**
 * #51: translation.status Data Channel へ payload を publish する共通ヘルパー。
 * RELIABLE モード + topic 明示で送信し、失敗は warn ログのみ（best-effort、通話は継続）。
 * export してテストから直接呼び出せるようにする (JobContext は private field を持つ実クラスのため
 * entry() 全体のユニットテストは困難、この関数単体を切り出してテスト可能にする)。
 */
export function publishStatusChannelData(
  localParticipant: LocalParticipant | undefined,
  payload: TranslationStatusChannelPayload,
  logger: Logger,
  logContext: Record<string, unknown>,
): void {
  if (!localParticipant) return;
  const data = Buffer.from(JSON.stringify(payload));
  void localParticipant
    .publishData(new Uint8Array(data), {
      reliable: true,
      topic: TRANSLATION_STATUS_CHANNEL_TOPIC,
    })
    .catch((e: unknown) => {
      logger.warn("Agent: translation.status Data Channel publish 失敗", {
        ...logContext,
        payloadType: payload.type,
        error: e instanceof Error ? e.message : String(e),
      });
    });
}

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

// --- resolveParticipantId (#50) ---

/**
 * #50: Server (Internal API) に送る participantId を解決する。
 * Server は participantId に UUID を要求する (packages/room 等で UserIdSchema/ParticipantIdSchema
 * により UUID バリデーションされる)。LiveKit の participant.identity は
 * media/adapters/livekit.ts の AccessToken 発行時に profile.userId (UUID) を設定しているため
 * 常に identity を使う。participant.sid は LiveKit 内部 SID (非UUID、例: "PA_xxxxx") であり
 * Server 側の UUID バリデーションに失敗するため参照しない。
 */
export function resolveParticipantId(participantIdentity: string): string {
  return participantIdentity;
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
        sourceLang,
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

      // T-14/#51: degraded/recovered イベント購読 → LiveKit Data Channel publish
      // module-contracts.md §3.4 に準拠した payload を translation.status topic に RELIABLE モードで送信する
      session.on("degraded", (reason: string) => {
        const meta = session.getDegradedChannelMeta();
        const degradedReason: DegradedChannelPayload["reason"] =
          reason === "high_latency" || reason === "output_silence"
            ? reason
            : "openai_ws_reconnecting";
        const payload: DegradedChannelPayload = {
          type: "translation.degraded",
          sessionId: meta.sessionId,
          sourceLang: meta.sourceLang,
          targetLang: meta.targetLang,
          reason: degradedReason,
          timestamp: new Date().toISOString(),
        };
        publishStatusChannelData(ctx.room.localParticipant, payload, logger, { key });
        logger.info("Agent: degraded Data Channel publish", { key, reason });
      });

      session.on("recovered", () => {
        const meta = session.getDegradedChannelMeta();
        // degradedDurationMs は translation-session 側で計算済みだが
        // agent.ts では session に露出していないため 0 で送信し、
        // Internal API 経由の recovered イベント (postRecoveredEvent) が正確な値を持つ
        const payload: RecoveredChannelPayload = {
          type: "translation.recovered",
          sessionId: meta.sessionId,
          sourceLang: meta.sourceLang,
          targetLang: meta.targetLang,
          degradedDurationMs: 0,
          timestamp: new Date().toISOString(),
        };
        publishStatusChannelData(ctx.room.localParticipant, payload, logger, { key });
        logger.info("Agent: recovered Data Channel publish", { key });
      });

      // #51: transcript イベント購読 → subtitle.delta Data Channel publish
      // module-contracts.md §3.4 の subtitle.delta として translation.status topic に送信する
      // (isFinal=false/true 両方を送信)。
      // 訂正 (確定#6): mobile 側の受信・字幕表示への配線は本ファイルの責務範囲外であり、
      // 現時点では未配線 (apps/mobile 側の consumer 実装は #51 の続きとして別 Wave で対応)。
      session.on("transcript", (text: string, isFinal: boolean, elapsedMs: number) => {
        const meta = session.getDegradedChannelMeta();
        const payload: SubtitleDeltaChannelPayload = {
          type: "subtitle.delta",
          sessionId: meta.sessionId,
          sourceLang: meta.sourceLang,
          targetLang: meta.targetLang,
          text,
          elapsedMs,
          isFinal,
          timestamp: new Date().toISOString(),
        };
        publishStatusChannelData(ctx.room.localParticipant, payload, logger, { key });
      });

      await session.start();

      // source Participant の Audio Track を subscribe して PCM フレームをパイプライン
      // AudioSource + LocalAudioTrack を使って翻訳済み音声を Publish する
      // D1 §3.1: 24kHz mono (LiveKit SDK が 48kHz から自動リサンプル)
      const audioSource = new AudioSource(24000, 1);
      // D1 §8.1: Track 命名規約 trans-{sourceParticipantIdentity}-to-{targetLang}
      const publishTrack = LocalAudioTrack.createAudioTrack(
        `trans-${sourceIdentity}-to-${targetLang}`,
        audioSource,
      );

      // Issue #69 (3): Track/AudioSource 生成直後 (実際に publish するより前) に
      // cleanup コールバックを登録する。session.end() がこれを呼ぶことで
      // unpublishTrack + AudioSource.close (LocalAudioTrack.close(true) が
      // 紐づく AudioSource も併せて close する) が確実に実行され、リソースリークを防ぐ。
      // ctx.agent が未 publish (falsy) のままセッションが終了した場合も
      // publishTrack.close(true) で AudioSource は解放される。
      session.attachPublishedAudioResources({
        unpublish: async () => {
          const sid = publishTrack.sid;
          if (ctx.agent && sid !== undefined) {
            await ctx.agent.unpublishTrack(sid);
          }
        },
        closeSource: async () => {
          await publishTrack.close(true);
        },
      });

      // 翻訳済み音声 (Base64 PCM16) → AudioSource → LiveKit Track へ流す
      // T5: agentPublish 計測点 (captureFrame 前後の wallclock 差分)
      // T8: publish 失敗カウンタ管理
      session.on("translated-audio", (pcm16Base64: string) => {
        // D1 §4.7: AudioFrame への変換
        const pcmBuffer = Buffer.from(pcm16Base64, "base64");
        const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
        const samplesPerChannel = int16.length;
        const frame = new AudioFrame(int16, 24000, 1, samplesPerChannel);

        // T5: captureFrame 前後で agentPublish を計測
        const captureStart = Date.now();
        audioSource.captureFrame(frame).then(() => {
          const publishLatencyMs = Date.now() - captureStart;
          // T5/T6: agentPublish + totalEndToEnd を記録
          session.recordPublishMetrics(publishLatencyMs);
          // T8: publish 成功でカウンタリセット
          session.recordPublishSuccess();
        }).catch((e: unknown) => {
          logger.error("Agent: captureFrame 失敗", {
            key,
            error: e instanceof Error ? e.message : String(e),
          });
          // T8: publish 失敗カウンタ増加 (3 回連続で session.end)
          session.recordPublishFailure();
        });
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
     *
     * T3: reader.read() 直後にタイムスタンプ採取し captureToAgent を計測する。
     * D1 §3.2: LiveKit SDK が 48kHz → 24kHz を自動リサンプル (自前実装不要)。
     */
    async function pipeAudioTrack(
      track: RemoteAudioTrack,
      session: TranslationSession,
    ): Promise<void> {
      // D1 §3.2: 24kHz 1ch で AudioStream を生成 (SDK が 48→24kHz リサンプル)
      const stream = new AudioStream(track, 24000, 1);
      const reader = stream.getReader();
      logger.debug("Agent: AudioStream パイプライン開始", {
        trackSid: track.sid,
        sessionJobId: session.getAgentJobId(),
      });
      try {
        for (;;) {
          // T3: reader.read() 直後にタイムスタンプ採取して captureToAgent を計測
          const readStart = Date.now();
          const result = await reader.read();
          if (result.done) break;

          const agentReceivedAt = Date.now();
          // T3: D1 §5.3 参照 - captureToAgent = AudioStream.read() で受領時刻の差分
          // LiveKit SDK は AudioFrame に capture timestamp を持たないため
          // read() 呼び出し前後の wallclock 差分を proxy として使用
          // (最初の数フレームは SDK リサンプル初期化ノイズを含むため精度は参考値)
          const captureToAgent = agentReceivedAt - readStart;

          const frame = result.value;
          // PCM16 Int16Array を Base64 に変換して OpenAI に送信
          const pcmBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
          const pcm16Base64 = pcmBuffer.toString("base64");

          // T3: captureToAgent レイテンシを記録
          session.recordCaptureToAgent(captureToAgent);

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
      for (const otherIdentity of ctx.room.remoteParticipants.keys()) {
        if (otherIdentity === participantIdentity) continue;

        const otherLangResult = participantLanguages.get(otherIdentity);
        if (!otherLangResult) {
          // 相手の言語がまだわからない場合はスキップ（相手が参加した時にこちら向けを開始する）
          continue;
        }

        // #50: participantSid (LiveKit 内部 SID) ではなく participantIdentity (UUID) を使う
        const sourceParticipantId = resolveParticipantId(participantIdentity);
        const targetParticipantId = resolveParticipantId(otherIdentity);

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
