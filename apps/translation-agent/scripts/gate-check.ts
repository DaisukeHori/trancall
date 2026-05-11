/**
 * TranCall Translation Agent — Phase 1a Gate Check
 *
 * Translation Agent の本番採用可否を判定するための測定スクリプト。
 * 以下のゲート基準を全て満たすことが Phase 1a 完了の必須条件:
 *
 * 1. 30 分連続翻訳セッションが安定動作する（crash/hang/エラー率 1% 未満）
 * 2. メモリ使用量がピーク時 512MB 未満を維持する
 * 3. 翻訳レイテンシが p50 1.5s / p95 3.0s / p99 5.0s を満たす
 * 4. Agent crash 時に通話が原音 fallback で継続する
 * 5. WebSocket 再接続が 10 秒以内に完了する
 *
 * 使い方:
 *   pnpm gate-check
 *   または
 *   tsx apps/translation-agent/scripts/gate-check.ts
 *
 * 必要な環境変数:
 *   LIVEKIT_URL        - LiveKit Server URL (wss://xxx.livekit.cloud)
 *   LIVEKIT_API_KEY    - LiveKit API key
 *   LIVEKIT_API_SECRET - LiveKit API secret
 *   OPENAI_API_KEY     - OpenAI API key
 *
 * 任意:
 *   TEST_DURATION_MIN  - テスト時間（デフォルト: 30）
 *   LANGUAGE_PAIRS     - テスト言語ペア（デフォルト: "ja-en,en-ja,ja-zh"）
 *   TEST_WAV_PATH      - 模擬音声 WAV ファイル（PCM16 24kHz mono 推奨、デフォルト: テストトーン生成）
 *
 * Phase 1a Sprint 0 のスコープ:
 *   - LiveKit Cloud / セルフホスト LiveKit Server に Room を作成
 *   - 模擬音声 (WAV / 合成サイン波) を Publish する Publisher を 1 名作成
 *   - Translation Agent が Subscribe → OpenAI WS → 翻訳音声 Publish するまでの
 *     各ホップの **時刻のみを stdout に JSON Lines で記録**
 *   - レイテンシの分位値計算は別スクリプト（分析側）に任せる
 *
 * Phase 1a Sprint 1 以降のスコープ:
 *   - 30 分連続実行
 *   - メモリ計測の精密化（heap dump 連携）
 *   - Crash recovery シミュレーション
 *   - WebSocket 強制切断による再接続計測
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";

// --- 設定 ---

interface GateCheckEnv {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  openaiApiKey: string;
  durationMinutes: number;
  languagePairs: string[];
  testWavPath: string | null;
}

function loadEnv(): GateCheckEnv {
  const required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "OPENAI_API_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[gate-check] 必須環境変数が不足: ${missing.join(", ")}`);
    process.exit(1);
  }

  return {
    livekitUrl: process.env["LIVEKIT_URL"] ?? "",
    livekitApiKey: process.env["LIVEKIT_API_KEY"] ?? "",
    livekitApiSecret: process.env["LIVEKIT_API_SECRET"] ?? "",
    openaiApiKey: process.env["OPENAI_API_KEY"] ?? "",
    durationMinutes: Number(process.env["TEST_DURATION_MIN"] ?? "30"),
    languagePairs: (process.env["LANGUAGE_PAIRS"] ?? "ja-en,en-ja,ja-zh").split(","),
    testWavPath: process.env["TEST_WAV_PATH"] ?? null,
  };
}

// --- 構造化ログ（stdout JSON Lines） ---

interface LogEvent {
  ts: string;
  monotonicMs: number;
  event: string;
  context?: Record<string, unknown>;
}

const startMonotonicMs = performance.now();

function logEvent(event: string, context?: Record<string, unknown>): void {
  const entry: LogEvent = {
    ts: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() - startMonotonicMs),
    event,
    ...(context ? { context } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

// --- 模擬音声生成 ---
//
// 24kHz mono PCM16、1 秒 = 24000 samples = 48000 bytes
//
// WAV ファイルが指定されればそれを読み込み、なければ 440Hz サイン波を生成する。
// LiveKit AudioFrame は 16-bit PCM の Int16Array を受け取る。

interface SyntheticAudio {
  samplesPerFrame: number;
  sampleRateHz: number;
  channels: number;
  /** 1 フレーム分の PCM16 (Int16Array) を生成する関数 */
  nextFrame: () => Int16Array;
  totalDurationMs: number;
}

function loadTestAudio(testWavPath: string | null): SyntheticAudio {
  const sampleRateHz = 24000;
  const channels = 1;
  // 1 フレーム = 10ms = 240 samples（LiveKit のデフォルト）
  const samplesPerFrame = 240;

  if (testWavPath !== null) {
    const absPath = resolvePath(process.cwd(), testWavPath);
    const buffer = readFileSync(absPath);
    // 簡易 WAV ヘッダ skip（44 バイト固定、本来はちゃんとパースすべき）
    const dataOffset = 44;
    const pcmData = buffer.subarray(dataOffset);
    const samples = new Int16Array(
      pcmData.buffer,
      pcmData.byteOffset,
      pcmData.byteLength / 2,
    );

    let cursor = 0;
    return {
      samplesPerFrame,
      sampleRateHz,
      channels,
      nextFrame: () => {
        const chunk = new Int16Array(samplesPerFrame);
        for (let i = 0; i < samplesPerFrame; i += 1) {
          chunk[i] = samples[(cursor + i) % samples.length] ?? 0;
        }
        cursor = (cursor + samplesPerFrame) % samples.length;
        return chunk;
      },
      totalDurationMs: Math.round((samples.length / sampleRateHz) * 1000),
    };
  }

  // 合成: 440 Hz サイン波（A4）、振幅は Int16 の 30%
  const amplitude = Math.floor(32767 * 0.3);
  const frequencyHz = 440;
  let sampleIndex = 0;

  return {
    samplesPerFrame,
    sampleRateHz,
    channels,
    nextFrame: () => {
      const chunk = new Int16Array(samplesPerFrame);
      for (let i = 0; i < samplesPerFrame; i += 1) {
        const t = (sampleIndex + i) / sampleRateHz;
        const value = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude;
        chunk[i] = Math.round(value);
      }
      sampleIndex += samplesPerFrame;
      return chunk;
    },
    totalDurationMs: Number.POSITIVE_INFINITY,
  };
}

// --- LiveKit Room 作成と Publisher 接続 ---

interface PublisherHandle {
  room: Room;
  stop: () => Promise<void>;
}

async function createPublisher(
  env: GateCheckEnv,
  roomName: string,
  audio: SyntheticAudio,
): Promise<PublisherHandle> {
  // 1. Publisher 用のトークン発行
  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: "gate-check-publisher",
    metadata: JSON.stringify({ role: "publisher", nativeLanguage: "ja" }),
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const jwt = await token.toJwt();

  logEvent("publisher.token_issued", { roomName });

  // 2. Room 接続
  const room = new Room();
  await room.connect(env.livekitUrl, jwt, {
    autoSubscribe: true,
    dynacast: false,
  });
  logEvent("publisher.connected", { roomName });

  // 3. AudioSource を作成して Local Track として Publish
  //    AudioSource は LiveKit が用意するシンク。captureFrame() で PCM を流し込む
  const audioSource = new AudioSource(audio.sampleRateHz, audio.channels);
  const track = LocalAudioTrack.createAudioTrack("raw-publisher-audio", audioSource);

  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;

  // room.connect() 後は localParticipant が定義されているはずだが、型上は optional
  const localParticipant = room.localParticipant;
  if (!localParticipant) {
    throw new Error("Room 接続後も localParticipant が undefined");
  }
  await localParticipant.publishTrack(track, publishOptions);
  logEvent("publisher.track_published", { trackKind: TrackKind[TrackKind.KIND_AUDIO] });

  // 4. フレーム送信ループ
  //    10ms 周期で AudioFrame を生成して送信
  const frameDurationMs = (audio.samplesPerFrame / audio.sampleRateHz) * 1000;
  let stopped = false;
  let nextSendAt = performance.now();

  function loop(): void {
    if (stopped) return;
    const now = performance.now();
    if (now >= nextSendAt) {
      const pcm = audio.nextFrame();
      const frame = new AudioFrame(pcm, audio.sampleRateHz, audio.channels, audio.samplesPerFrame);
      audioSource.captureFrame(frame).catch((e: unknown) => {
        logEvent("publisher.capture_error", {
          error: e instanceof Error ? e.message : String(e),
        });
      });
      nextSendAt += frameDurationMs;
    }
    // 次フレームまでの実時間で setTimeout する（ドリフト最小化のため Math.max で 0 以上）
    const delay = Math.max(0, nextSendAt - performance.now());
    setTimeout(loop, delay);
  }

  loop();
  logEvent("publisher.frame_loop_started", { frameDurationMs });

  return {
    room,
    stop: async () => {
      stopped = true;
      await room.disconnect();
      logEvent("publisher.disconnected");
    },
  };
}

// --- Subscriber: Translation Agent が出力した翻訳音声を受信する観察用 client ---

interface SubscriberHandle {
  room: Room;
  stop: () => Promise<void>;
}

async function createSubscriber(env: GateCheckEnv, roomName: string): Promise<SubscriberHandle> {
  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: "gate-check-subscriber",
    metadata: JSON.stringify({ role: "subscriber", nativeLanguage: "en" }),
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: false,
    canSubscribe: true,
  });
  const jwt = await token.toJwt();

  const room = new Room();
  await room.connect(env.livekitUrl, jwt, {
    autoSubscribe: true,
    dynacast: false,
  });
  logEvent("subscriber.connected", { roomName });

  // Translation Agent が Publish する Track を観察する
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    logEvent("subscriber.track_subscribed", {
      trackName: publication.name,
      kind: track.kind,
      participantIdentity: participant.identity,
    });
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    logEvent("subscriber.participant_connected", {
      identity: participant.identity,
      isAgent:
        participant.identity.startsWith("agent-") ||
        participant.identity === "trancall-translation-agent",
    });
  });

  return {
    room,
    stop: async () => {
      await room.disconnect();
      logEvent("subscriber.disconnected");
    },
  };
}

// --- メイン ---

async function runGateCheck(): Promise<void> {
  const env = loadEnv();

  logEvent("gate-check.started", {
    durationMinutes: env.durationMinutes,
    languagePairs: env.languagePairs,
    livekitUrl: env.livekitUrl,
  });

  const roomServiceClient = new RoomServiceClient(
    env.livekitUrl.replace(/^wss?:/, "https:"),
    env.livekitApiKey,
    env.livekitApiSecret,
  );

  const roomName = `gate-check-${Date.now().toString()}`;

  // Room 作成
  try {
    await roomServiceClient.createRoom({
      name: roomName,
      emptyTimeout: 600,
      maxParticipants: 10,
    });
    logEvent("room.created", { roomName });
  } catch (e: unknown) {
    // 既に存在する場合は OK
    logEvent("room.create_warn", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 模擬音声準備
  const audio = loadTestAudio(env.testWavPath);
  logEvent("audio.loaded", {
    source: env.testWavPath ?? "synthesized-440hz-sine",
    sampleRateHz: audio.sampleRateHz,
    samplesPerFrame: audio.samplesPerFrame,
    totalDurationMs: Number.isFinite(audio.totalDurationMs) ? audio.totalDurationMs : null,
  });

  // Subscriber を先に立ち上げ（Agent の Publish を観察するため）
  const subscriber = await createSubscriber(env, roomName);

  // Publisher を立ち上げ
  const publisher = await createPublisher(env, roomName, audio);

  // メモリサンプリング（5 秒ごと）
  const memorySamples: { ts: number; rssBytes: number; heapUsedBytes: number }[] = [];
  const memoryTimer = setInterval(() => {
    const usage = process.memoryUsage();
    memorySamples.push({
      ts: Date.now(),
      rssBytes: usage.rss,
      heapUsedBytes: usage.heapUsed,
    });
    logEvent("memory.sample", {
      rssMb: Math.round(usage.rss / 1024 / 1024),
      heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
    });
  }, 5000);

  // タイマーで停止
  const durationMs = env.durationMinutes * 60 * 1000;
  logEvent("gate-check.running", { durationMs });

  await new Promise<void>((resolve) => {
    const sigintHandler = (): void => {
      logEvent("gate-check.sigint");
      resolve();
    };
    process.once("SIGINT", sigintHandler);
    setTimeout(() => {
      process.off("SIGINT", sigintHandler);
      resolve();
    }, durationMs);
  });

  // クリーンアップ
  clearInterval(memoryTimer);
  await publisher.stop();
  await subscriber.stop();

  try {
    await roomServiceClient.deleteRoom(roomName);
    logEvent("room.deleted", { roomName });
  } catch (e: unknown) {
    logEvent("room.delete_warn", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // サマリ出力
  const peakRssBytes = memorySamples.reduce((m, s) => Math.max(m, s.rssBytes), 0);
  const avgRssBytes =
    memorySamples.length > 0
      ? Math.round(memorySamples.reduce((sum, s) => sum + s.rssBytes, 0) / memorySamples.length)
      : 0;

  logEvent("gate-check.summary", {
    memorySampleCount: memorySamples.length,
    peakRssMb: Math.round(peakRssBytes / 1024 / 1024),
    avgRssMb: Math.round(avgRssBytes / 1024 / 1024),
    memoryThresholdMb: 512,
    memoryGate: peakRssBytes < 512 * 1024 * 1024 ? "PASS" : "FAIL",
  });

  logEvent("gate-check.completed");
}

runGateCheck().catch((e: unknown) => {
  logEvent("gate-check.fatal", {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  });
  process.exit(2);
});
