/**
 * livekit-transcript-capture.ts
 *
 * L-3: `runScenarioLive` のライブ収録処理で、LiveKit Room の Data Channel を
 * 購読して translation-agent が publish する `subtitle.delta` (isFinal=true) を
 * 自動でトランスクリプトとして取得する。
 *
 * schema/topic は docs/module-contracts.md §3.4
 * (TranslationStatusChannelPayloadSchema の subtitle.delta variant) をミラーする。
 * apps/translation-agent/src/agent.ts が `@trancall/translation` を直接 import せず
 * 手動ミラーしているのと同じ方針 (cron も server とは別プロセスのため)。
 *
 * 接続情報 (LIVEKIT_URL/API_KEY/API_SECRET) が無い、または `@livekit/rtc-node` の
 * ネイティブバインディング読み込み・実接続に失敗する環境では `null` を返し、
 * runner.ts 側で QA オペレータ手入力へフォールバックする (Phase 1a の既存運用を維持)。
 */

import { randomUUID } from "node:crypto";

import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

// #51 (apps/translation-agent/src/agent.ts) と揃えた canonical topic 名。
export const TRANSLATION_STATUS_CHANNEL_TOPIC = "translation.status";

// module-contracts.md §3.4 TranslationStatusChannelPayloadSchema の
// subtitle.delta variant のみをミラー (QA キャプチャに必要な部分のみ)。
const SubtitleDeltaChannelPayloadSchema = z.object({
  type: z.literal("subtitle.delta"),
  sessionId: z.string(),
  sourceLang: z.string(),
  targetLang: z.string(),
  text: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  isFinal: z.boolean(),
  timestamp: z.string(),
});

/**
 * Data Channel から受信した生バイト列を subtitle.delta (isFinal=true) の
 * テキストへパースする。topic 不一致・パース失敗・isFinal=false は null を返す
 * (呼び出し側は無視する)。
 */
export function parseFinalSubtitleText(
  payload: Uint8Array,
  topic: string | undefined
): string | null {
  if (topic !== TRANSLATION_STATUS_CHANNEL_TOPIC) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload).toString("utf-8"));
  } catch {
    return null;
  }

  const parsed = SubtitleDeltaChannelPayloadSchema.safeParse(json);
  if (!parsed.success || !parsed.data.isFinal) return null;
  return parsed.data.text;
}

/**
 * 到着順に subtitle.delta テキストをキューイングし、`next()` で FIFO に取り出す。
 * 待機中に `push()` された場合は即座に resolve、タイムアウトした場合は null。
 * LiveKit 接続に依存しない純粋なロジックなので単体テスト可能。
 */
export class SubtitleDeltaQueue {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(value: string | null) => void> = [];

  push(text: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(text);
      return;
    }
    this.queue.push(text);
  }

  async next(timeoutMs: number): Promise<string | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return queued;
    }
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export interface TranscriptCapture {
  /**
   * 次に届く isFinal=true の subtitle.delta テキストを最大 timeoutMs 待つ。無ければ null。
   * プロパティ (arrow function 型) で宣言する — method shorthand だと
   * `expect(capture.disconnect).toHaveBeenCalled()` のような bare 参照が
   * `@typescript-eslint/unbound-method` に抵触するため。
   */
  nextFinalSubtitle: (timeoutMs: number) => Promise<string | null>;
  disconnect: () => Promise<void>;
}

export interface ConnectCaptureParams {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  roomName: string;
}

export type ConnectTranscriptCapture = (
  params: ConnectCaptureParams
) => Promise<TranscriptCapture | null>;

/**
 * 実 LiveKit Room に非公開参加者 (hidden, publish 不可) として接続し、
 * Data Channel の subtitle.delta を購読する TranscriptCapture を生成する。
 *
 * `@livekit/rtc-node` の読み込み・接続に失敗した場合は例外を投げず null を返す
 * (呼び出し側の手入力フォールバックに委ねる)。
 */
export const connectLiveTranscriptCapture: ConnectTranscriptCapture = async (
  params
) => {
  let rtcNode: typeof import("@livekit/rtc-node");
  try {
    rtcNode = await import("@livekit/rtc-node");
  } catch {
    return null;
  }

  const { Room, RoomEvent } = rtcNode;
  const queue = new SubtitleDeltaQueue();
  const room = new Room();

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    const text = parseFinalSubtitleText(payload, topic);
    if (text !== null) {
      queue.push(text);
    }
  });

  try {
    const token = new AccessToken(params.livekitApiKey, params.livekitApiSecret, {
      identity: `qa-capture-${randomUUID()}`,
    });
    token.addGrant({
      roomJoin: true,
      room: params.roomName,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true,
    });
    const jwt = await token.toJwt();

    await room.connect(params.livekitUrl, jwt, {
      autoSubscribe: false,
      dynacast: false,
    });
  } catch {
    return null;
  }

  return {
    nextFinalSubtitle: (timeoutMs: number) => queue.next(timeoutMs),
    disconnect: () => room.disconnect(),
  };
};
