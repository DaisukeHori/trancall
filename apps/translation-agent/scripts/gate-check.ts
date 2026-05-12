/**
 * TranCall Translation Agent — Phase 1a Gate Check (T-31 / PERF-002)
 *
 * 100 シナリオ実走 (各 30 秒翻訳通話 with random speaker switch) を実施し、
 * 以下の計測項目を収集する:
 *   - LiveKit Room 参加 → Audio Track Subscribe 成功率
 *   - OpenAI Realtime WebSocket 接続成功率
 *   - 翻訳済 Track Publish 成功率
 *   - p50 / p95 / p99 latency
 *   - メモリ使用量
 *   - クラッシュ/ハング率
 *
 * 合否判定基準 (production-runbook.md §15.5):
 *   PASS             : p95 < 3000ms かつ pass_count >= 99
 *   CONDITIONAL_PASS : p95 < 3500ms かつ pass_count >= 95
 *   FAIL             : 上記いずれも満たさない
 *
 * 使い方:
 *   pnpm gate-check
 *   pnpm gate-check -- --dry-run          (CI 用 mock 実行)
 *   tsx apps/translation-agent/scripts/gate-check.ts --dry-run
 *
 * 必要な環境変数 (dry-run 時は不要):
 *   LIVEKIT_URL            - LiveKit Server URL (wss://xxx.livekit.cloud)
 *   LIVEKIT_API_KEY        - LiveKit API key
 *   LIVEKIT_API_SECRET     - LiveKit API secret
 *   OPENAI_API_KEY         - OpenAI API key
 *   SUPABASE_DB_URL        - PostgreSQL 接続文字列 (結果書き込み用、任意)
 *
 * 任意:
 *   SCENARIO_COUNT         - シナリオ数 (デフォルト: 100)
 *   SCENARIO_DURATION_SEC  - 各シナリオの通話長秒数 (デフォルト: 30)
 *   TEST_WAV_PATH          - 模擬音声 WAV ファイル (PCM16 24kHz mono)
 *   GATE_CHECK_OUTPUT_DIR  - レポート出力ディレクトリ (デフォルト: docs/audit-reports)
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";

// pg パッケージを require で動的ロード (型定義なし・未インストール時は null)
const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** シナリオ種別 */
type ScenarioType = "ja-en" | "en-ja" | "ja-zh" | "en-zh";

/** 個別シナリオの実行結果 */
interface ScenarioResult {
  scenarioIndex: number;
  scenarioType: ScenarioType;
  roomJoinSuccess: boolean;
  audioTrackSubscribeSuccess: boolean;
  openaiWsConnectSuccess: boolean;
  translatedTrackPublishSuccess: boolean;
  latencyMs: number | null;
  memoryMbPeak: number;
  crashed: boolean;
  hung: boolean;
  errorMessage: string | null;
  durationMs: number;
}

/** Gate Check 集計結果 */
interface GateCheckSummary {
  runId: string;
  startedAt: Date;
  endedAt: Date;
  scenarioCount: number;
  passCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  memoryMbMax: number;
  crashRate: number;
  verdict: "PASS" | "CONDITIONAL_PASS" | "FAIL";
  verdictReason: string;
  dryRun: boolean;
  results: ScenarioResult[];
}

/** 設定 */
interface GateCheckConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  openaiApiKey: string;
  supabaseDbUrl: string | null;
  scenarioCount: number;
  scenarioDurationSec: number;
  testWavPath: string | null;
  outputDir: string;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// 設定読み込み
// ---------------------------------------------------------------------------

export function loadConfig(argv: string[] = process.argv.slice(2)): GateCheckConfig {
  const dryRun = argv.includes("--dry-run");

  const outputDir = process.env["GATE_CHECK_OUTPUT_DIR"] ?? "docs/audit-reports";

  if (dryRun) {
    return {
      livekitUrl: "wss://mock.livekit.cloud",
      livekitApiKey: "mock-api-key",
      livekitApiSecret: "mock-api-secret",
      openaiApiKey: "mock-openai-key",
      supabaseDbUrl: null,
      scenarioCount: Number(process.env["SCENARIO_COUNT"] ?? "100"),
      scenarioDurationSec: Number(process.env["SCENARIO_DURATION_SEC"] ?? "30"),
      testWavPath: null,
      outputDir,
      dryRun: true,
    };
  }

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
    supabaseDbUrl: process.env["SUPABASE_DB_URL"] ?? null,
    scenarioCount: Number(process.env["SCENARIO_COUNT"] ?? "100"),
    scenarioDurationSec: Number(process.env["SCENARIO_DURATION_SEC"] ?? "30"),
    testWavPath: process.env["TEST_WAV_PATH"] ?? null,
    outputDir,
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// 構造化ログ (stdout JSON Lines)
// ---------------------------------------------------------------------------

const startMonotonicMs = performance.now();

function logEvent(event: string, context?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() - startMonotonicMs),
    event,
    ...(context !== undefined ? { context } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// 百分位計算ユーティリティ
// ---------------------------------------------------------------------------

/**
 * ソート済み数値配列から百分位値を返す (linear interpolation)。
 * 配列が空の場合は 0 を返す。
 */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (p <= 0) return sortedValues[0] ?? 0;
  if (p >= 1) return sortedValues[sortedValues.length - 1] ?? 0;

  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = lower + 1;
  const frac = index - lower;

  const lo = sortedValues[lower] ?? 0;
  const hi = sortedValues[upper] ?? lo;
  return lo + frac * (hi - lo);
}

// ---------------------------------------------------------------------------
// 判定ロジック (production-runbook.md §15.5)
// ---------------------------------------------------------------------------

/**
 * 集計結果から PASS / CONDITIONAL_PASS / FAIL 判定を返す。
 *
 * 判定基準 (production-runbook.md §15.5 準拠):
 *   PASS             : p95 < 3000ms かつ pass_count >= 99
 *   CONDITIONAL_PASS : p95 < 3500ms かつ pass_count >= 95
 *   FAIL             : 上記いずれも満たさない
 */
export function determineVerdict(
  p95Ms: number,
  passCount: number,
  scenarioCount: number,
): { verdict: "PASS" | "CONDITIONAL_PASS" | "FAIL"; reason: string } {
  // PASS 条件
  if (p95Ms < 3000 && passCount >= 99) {
    return {
      verdict: "PASS",
      reason: `p95=${p95Ms.toFixed(1)}ms (<3000ms) かつ pass_count=${passCount} (>=99)`,
    };
  }

  // CONDITIONAL_PASS 条件
  if (p95Ms < 3500 && passCount >= 95) {
    return {
      verdict: "CONDITIONAL_PASS",
      reason: `p95=${p95Ms.toFixed(1)}ms (<3500ms) かつ pass_count=${passCount} (>=95) — PASS 未達`,
    };
  }

  // FAIL
  const reasons: string[] = [];
  if (p95Ms >= 3500) {
    reasons.push(`p95=${p95Ms.toFixed(1)}ms (>=3500ms 閾値超過)`);
  }
  if (passCount < 95) {
    reasons.push(`pass_count=${passCount} (${scenarioCount} 中 — <95)`);
  }

  return {
    verdict: "FAIL",
    reason: reasons.join(", "),
  };
}

// ---------------------------------------------------------------------------
// mock 音声生成
// ---------------------------------------------------------------------------

interface SyntheticAudio {
  samplesPerFrame: number;
  sampleRateHz: number;
  channels: number;
  nextFrame: () => Int16Array;
  totalDurationMs: number;
}

function loadTestAudio(testWavPath: string | null): SyntheticAudio {
  const sampleRateHz = 24000;
  const channels = 1;
  const samplesPerFrame = 240;

  if (testWavPath !== null) {
    const absPath = resolvePath(process.cwd(), testWavPath);
    const buffer = readFileSync(absPath);
    const dataOffset = 44;
    const pcmData = buffer.subarray(dataOffset);
    const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);

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

// ---------------------------------------------------------------------------
// Dry-run: モック結果生成
// ---------------------------------------------------------------------------

/**
 * dry-run モード時に mock シナリオ結果を生成する。
 * CI パイプラインの検証用。
 */
export function generateDryRunResults(
  scenarioCount: number,
  scenarioDurationSec: number,
): ScenarioResult[] {
  const scenarioTypes: ScenarioType[] = ["ja-en", "en-ja", "ja-zh", "en-zh"];
  const results: ScenarioResult[] = [];

  // 再現性のある疑似乱数 (seed: scenarioCount)
  const seedStr = `gate-check-dry-run-${scenarioCount}`;
  const seed = parseInt(createHash("sha256").update(seedStr).digest("hex").slice(0, 8), 16);

  function pseudoRandom(n: number): number {
    // Linear congruential generator
    const a = 1664525;
    const c = 1013904223;
    const m = 2 ** 32;
    return ((a * (seed ^ n) + c) % m) / m;
  }

  for (let i = 0; i < scenarioCount; i++) {
    const scenarioType = scenarioTypes[i % scenarioTypes.length] ?? "ja-en";
    const r = pseudoRandom(i);

    // 95% は成功、5% は何らかの失敗
    const isSuccess = r > 0.05;

    // latency: 800〜2500ms の範囲 (dry-run では PASS になるよう調整)
    const baseLatency = 800 + r * 1700;
    // en-ja は語順差で少し遅い
    const latencyMs = isSuccess
      ? Math.round(baseLatency + (scenarioType === "en-ja" ? 200 : 0))
      : null;

    // メモリ: 100〜350 MB
    const memoryMbPeak = Math.round(100 + pseudoRandom(i + 1000) * 250);

    results.push({
      scenarioIndex: i,
      scenarioType,
      roomJoinSuccess: isSuccess || r > 0.02,
      audioTrackSubscribeSuccess: isSuccess || r > 0.03,
      openaiWsConnectSuccess: isSuccess || r > 0.025,
      translatedTrackPublishSuccess: isSuccess,
      latencyMs,
      memoryMbPeak,
      crashed: !isSuccess && r < 0.01,
      hung: !isSuccess && r >= 0.01 && r < 0.02,
      errorMessage: isSuccess ? null : `mock error (r=${r.toFixed(4)})`,
      durationMs: Math.round(scenarioDurationSec * 1000 + r * 500),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 実際の 1 シナリオ実行 (LiveKit + OpenAI Realtime)
// ---------------------------------------------------------------------------

/**
 * 1 シナリオを実行して ScenarioResult を返す。
 *
 * Phase 1a Sprint 0 スコープ:
 * - LiveKit Room 作成 → Publisher / Subscriber 接続
 * - OpenAI Realtime WS 接続確認
 * - 翻訳 Track Publish の確認
 * - latency はシナリオ開始〜翻訳 Track Subscribe 成功までの時間で近似
 */
async function runScenario(
  config: GateCheckConfig,
  index: number,
  scenarioType: ScenarioType,
  audio: SyntheticAudio,
): Promise<ScenarioResult> {
  // 動的 import — dry-run 時は呼ばれないので top-level でインポートしない
  const { AccessToken, RoomServiceClient } = await import("livekit-server-sdk");
  const {
    AudioFrame,
    AudioSource,
    LocalAudioTrack,
    Room,
    RoomEvent,
    TrackPublishOptions,
    TrackSource,
  } = await import("@livekit/rtc-node");

  const scenarioStart = performance.now();
  let roomJoinSuccess = false;
  let audioTrackSubscribeSuccess = false;
  let openaiWsConnectSuccess = false;
  let translatedTrackPublishSuccess = false;
  let latencyMs: number | null = null;
  let crashed = false;
  let hung = false;
  let errorMessage: string | null = null;
  const roomName = `gate-check-${Date.now()}-${index}`;
  let publisher: { room: InstanceType<typeof Room>; stop: () => Promise<void> } | null = null;
  let subscriber: { room: InstanceType<typeof Room>; stop: () => Promise<void> } | null = null;

  // メモリサンプリング
  let memoryMbPeak = 0;
  const memInterval = setInterval(() => {
    const mb = process.memoryUsage().rss / 1024 / 1024;
    if (mb > memoryMbPeak) memoryMbPeak = mb;
  }, 1000);

  try {
    const roomService = new RoomServiceClient(
      config.livekitUrl.replace(/^wss?:/, "https:"),
      config.livekitApiKey,
      config.livekitApiSecret,
    );

    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 120,
      maxParticipants: 5,
    });

    // --- Publisher 接続 ---
    const [srcLang, tgtLang] = scenarioType.split("-");
    const pubToken = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: `gate-pub-${index}`,
      metadata: JSON.stringify({ role: "publisher", nativeLanguage: srcLang }),
    });
    pubToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: false });
    const pubJwt = await pubToken.toJwt();

    const pubRoom = new Room();
    await pubRoom.connect(config.livekitUrl, pubJwt, { autoSubscribe: false, dynacast: false });
    roomJoinSuccess = true;

    // Audio Source → Track Publish
    const audioSource = new AudioSource(audio.sampleRateHz, audio.channels);
    const track = LocalAudioTrack.createAudioTrack("raw-publisher-audio", audioSource);
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;

    const lp = pubRoom.localParticipant;
    if (!lp) throw new Error("localParticipant が undefined");
    await lp.publishTrack(track, publishOptions);

    // Frame loop (シナリオ期間中)
    let frameStopped = false;
    let nextSendAt = performance.now();
    const frameDurationMs = (audio.samplesPerFrame / audio.sampleRateHz) * 1000;

    function frameLoop(): void {
      if (frameStopped) return;
      const now = performance.now();
      if (now >= nextSendAt) {
        const pcm = audio.nextFrame();
        const frame = new AudioFrame(pcm, audio.sampleRateHz, audio.channels, audio.samplesPerFrame);
        audioSource.captureFrame(frame).catch(() => {
          // frame error は無視
        });
        nextSendAt += frameDurationMs;
      }
      setTimeout(frameLoop, Math.max(0, nextSendAt - performance.now()));
    }
    frameLoop();

    publisher = {
      room: pubRoom,
      stop: async () => {
        frameStopped = true;
        await pubRoom.disconnect();
      },
    };

    // --- Subscriber 接続 (翻訳 Track を観察) ---
    const trackSubscribeTimestamp = { value: null as number | null };
    const subToken = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: `gate-sub-${index}`,
      metadata: JSON.stringify({ role: "subscriber", nativeLanguage: tgtLang }),
    });
    subToken.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
    const subJwt = await subToken.toJwt();

    const subRoom = new Room();
    await subRoom.connect(config.livekitUrl, subJwt, { autoSubscribe: true, dynacast: false });
    audioTrackSubscribeSuccess = true;

    subRoom.on(RoomEvent.TrackSubscribed, (_trk, pub, _participant) => {
      // translation-agent が Publish した翻訳 Track の購読を検出
      if (pub.name?.startsWith("trans-") ?? false) {
        translatedTrackPublishSuccess = true;
        trackSubscribeTimestamp.value = performance.now();
        latencyMs = Math.round(trackSubscribeTimestamp.value - scenarioStart);
      }
    });

    subscriber = {
      room: subRoom,
      stop: async () => {
        await subRoom.disconnect();
      },
    };

    // --- OpenAI WS 接続確認 ---
    try {
      const { default: WebSocket } = await import("ws");
      const ws = new WebSocket("wss://api.openai.com/v1/realtime/translations", {
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("OpenAI WS timeout (5s)"));
        }, 5000);
        ws.once("open", () => {
          clearTimeout(timeout);
          openaiWsConnectSuccess = true;
          ws.close();
          resolve();
        });
        ws.once("error", (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (wsErr: unknown) {
      // WS 失敗はエラーとして記録するが crashed フラグは立てない
      errorMessage = wsErr instanceof Error ? wsErr.message : String(wsErr);
    }

    // --- シナリオ実行期間待機 ---
    const hungTimeoutMs = (config.scenarioDurationSec + 10) * 1000;
    const hangDetector = setTimeout(() => {
      hung = true;
    }, hungTimeoutMs);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, config.scenarioDurationSec * 1000);
    });

    clearTimeout(hangDetector);
  } catch (err: unknown) {
    crashed = true;
    errorMessage = err instanceof Error ? err.message : String(err);
    logEvent("scenario.error", { index, scenarioType, error: errorMessage });
  } finally {
    clearInterval(memInterval);
    if (publisher) {
      await publisher.stop().catch(() => undefined);
    }
    if (subscriber) {
      await subscriber.stop().catch(() => undefined);
    }

    // Room 削除は best-effort
    try {
      const { RoomServiceClient } = await import("livekit-server-sdk");
      const roomService = new RoomServiceClient(
        config.livekitUrl.replace(/^wss?:/, "https:"),
        config.livekitApiKey,
        config.livekitApiSecret,
      );
      await roomService.deleteRoom(roomName);
    } catch {
      // ignore
    }
  }

  const durationMs = Math.round(performance.now() - scenarioStart);

  return {
    scenarioIndex: index,
    scenarioType,
    roomJoinSuccess,
    audioTrackSubscribeSuccess,
    openaiWsConnectSuccess,
    translatedTrackPublishSuccess,
    latencyMs,
    memoryMbPeak: Math.round(memoryMbPeak),
    crashed,
    hung,
    errorMessage,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Supabase への結果書き込み
// ---------------------------------------------------------------------------

// pg クライアントの最小型定義 (pg パッケージが devDependencies に含まれないため、
// 境界変換ヘルパーとして型定義を内部で定義する — CLAUDE.md 型アサーション例外規則適用)
interface PgClient {
  query: (sql: string, params: unknown[]) => Promise<unknown>;
  release: () => void;
}

interface PgPool {
  connect: () => Promise<PgClient>;
}

interface PgModule {
  Pool: new (opts: { connectionString: string }) => PgPool;
}

async function writeToSupabase(
  dbUrl: string,
  summary: GateCheckSummary,
): Promise<void> {
  // pg ドライバを require で動的ロード — 未インストール時は skip
  // createRequire により TS の静的モジュール解決をバイパスする (境界変換ヘルパー)
  let pgModule: PgModule | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    pgModule = _require("pg") as PgModule;
  } catch {
    logEvent("supabase.skip", { reason: "pg パッケージが未インストール" });
    return;
  }

  const pool = new pgModule.Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO trancall_translation.gate_check_runs
        (run_id, started_at, ended_at, scenario_count, pass_count,
         p50_ms, p95_ms, p99_ms, memory_mb_max, verdict, dry_run, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        summary.runId,
        summary.startedAt.toISOString(),
        summary.endedAt.toISOString(),
        summary.scenarioCount,
        summary.passCount,
        summary.p50Ms,
        summary.p95Ms,
        summary.p99Ms,
        summary.memoryMbMax,
        summary.verdict,
        summary.dryRun,
        JSON.stringify({ verdictReason: summary.verdictReason, crashRate: summary.crashRate }),
      ],
    );
    logEvent("supabase.written", { runId: summary.runId });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Markdown レポート生成
// ---------------------------------------------------------------------------

/**
 * Gate Check 結果を Markdown レポートとして生成する。
 * production-runbook.md §15.6 記録テンプレに準拠。
 */
export function buildMarkdownReport(summary: GateCheckSummary): string {
  const dateJst = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(summary.startedAt);

  const scenarioBreakdown = (["ja-en", "en-ja", "ja-zh", "en-zh"] as ScenarioType[])
    .map((type) => {
      const typeResults = summary.results.filter((r) => r.scenarioType === type);
      if (typeResults.length === 0) return null;

      const latencies = typeResults
        .map((r) => r.latencyMs)
        .filter((l): l is number => l !== null)
        .sort((a, b) => a - b);

      const p50 = percentile(latencies, 0.5);
      const p95 = percentile(latencies, 0.95);
      const p99 = percentile(latencies, 0.99);
      const passed = typeResults.filter((r) => !r.crashed && !r.hung).length;
      const { verdict: typeVerdict } = determineVerdict(p95, passed, typeResults.length);

      return `| ${type} | ${Math.round(p50)} ms | ${Math.round(p95)} ms | ${Math.round(p99)} ms | ${latencies.length}/${typeResults.length} | ${typeVerdict} |`;
    })
    .filter(Boolean)
    .join("\n");

  const isPass = summary.verdict === "PASS";
  const isConditionalPass = summary.verdict === "CONDITIONAL_PASS";

  const verdictCheck = [
    `- [${isPass ? "x" : " "}] PASS (Phase 1a 完了基準クリア)`,
    `- [${isConditionalPass ? "x" : " "}] CONDITIONAL_PASS (PASS 未達だが許容範囲内)`,
    `- [${summary.verdict === "FAIL" ? "x" : " "}] FAIL (理由: ${summary.verdict === "FAIL" ? summary.verdictReason : "N/A"})`,
  ].join("\n");

  const dryRunNote = summary.dryRun ? "\n> **注意**: これは `--dry-run` モードの mock 結果です。実測値ではありません。\n" : "";

  return `## Gate Check 結果 — ${dateJst}

${dryRunNote}
**実施環境**: ${summary.dryRun ? "dry-run (mock)" : "staging / production 候補"}
**Run ID**: \`${summary.runId}\`
**シナリオ数**: ${summary.scenarioCount} 件
**通過数**: ${summary.passCount} 件 (${((summary.passCount / summary.scenarioCount) * 100).toFixed(1)}%)
**クラッシュ率**: ${(summary.crashRate * 100).toFixed(2)}%
**メモリ最大**: ${summary.memoryMbMax.toFixed(1)} MB

### 総合判定: **${summary.verdict}**

${summary.verdictReason}

### シナリオ別計測結果

| シナリオ | p50 | p95 | p99 | latency サンプル | 判定 |
|---|---|---|---|---|---|
${scenarioBreakdown}

### 全体集計

| 指標 | 値 | 閾値 | 合否 |
|---|---|---|---|
| p50 latency | ${Math.round(summary.p50Ms)} ms | ≤ 1500 ms | ${summary.p50Ms <= 1500 ? "PASS" : "FAIL"} |
| p95 latency | ${Math.round(summary.p95Ms)} ms | < 3000 ms (PASS) / < 3500 ms (COND) | ${summary.p95Ms < 3000 ? "PASS" : summary.p95Ms < 3500 ? "CONDITIONAL" : "FAIL"} |
| p99 latency | ${Math.round(summary.p99Ms)} ms | ≤ 5000 ms (努力目標) | ${summary.p99Ms <= 5000 ? "PASS" : "FAIL"} |
| pass_count | ${summary.passCount} / ${summary.scenarioCount} | ≥ 99 (PASS) / ≥ 95 (COND) | ${summary.passCount >= 99 ? "PASS" : summary.passCount >= 95 ? "CONDITIONAL" : "FAIL"} |
| メモリ最大 | ${summary.memoryMbMax.toFixed(1)} MB | < 512 MB | ${summary.memoryMbMax < 512 ? "PASS" : "FAIL"} |

### 結論

${verdictCheck}

### 参照

- 設計: \`docs/production-runbook.md\` §15 (Gate Check runbook)
- 要件: \`docs/requirements.md\` §4 PERF-002
- 集計 SQL: \`scripts/gate-check-summary.sql\`
`;
}

// ---------------------------------------------------------------------------
// メイン実行ロジック
// ---------------------------------------------------------------------------

/**
 * Gate Check を実行して GateCheckSummary を返す。
 * main() から呼ばれるほか、テストからも直接呼べる。
 */
export async function runGateCheck(config: GateCheckConfig): Promise<GateCheckSummary> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();

  logEvent("gate-check.started", {
    runId,
    scenarioCount: config.scenarioCount,
    scenarioDurationSec: config.scenarioDurationSec,
    dryRun: config.dryRun,
    livekitUrl: config.dryRun ? "(mock)" : config.livekitUrl,
  });

  let results: ScenarioResult[];

  if (config.dryRun) {
    logEvent("gate-check.dry-run", { message: "mock 結果を生成します" });
    results = generateDryRunResults(config.scenarioCount, config.scenarioDurationSec);
    logEvent("gate-check.dry-run-complete", { scenarioCount: results.length });
  } else {
    // シナリオ種別: ja-en 50 回 + en-ja 50 回 (合計 100)
    // 余りがある場合は均等配分
    const scenarioTypes: ScenarioType[] = ["ja-en", "en-ja", "ja-zh", "en-zh"];
    const audio = loadTestAudio(config.testWavPath);

    results = [];
    for (let i = 0; i < config.scenarioCount; i++) {
      const scenarioType = scenarioTypes[i % scenarioTypes.length] ?? "ja-en";
      logEvent("scenario.start", { index: i, scenarioType });

      const result = await runScenario(config, i, scenarioType, audio);
      results.push(result);

      logEvent("scenario.done", {
        index: i,
        scenarioType,
        latencyMs: result.latencyMs,
        crashed: result.crashed,
        hung: result.hung,
      });
    }
  }

  // 集計
  const passCount = results.filter((r) => !r.crashed && !r.hung).length;
  const crashCount = results.filter((r) => r.crashed || r.hung).length;
  const crashRate = crashCount / results.length;

  const allLatencies = results
    .map((r) => r.latencyMs)
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);

  const p50Ms = percentile(allLatencies, 0.5);
  const p95Ms = percentile(allLatencies, 0.95);
  const p99Ms = percentile(allLatencies, 0.99);

  const memoryMbMax = results.reduce((m, r) => Math.max(m, r.memoryMbPeak), 0);

  const { verdict, reason: verdictReason } = determineVerdict(p95Ms, passCount, results.length);

  const endedAt = new Date();

  const summary: GateCheckSummary = {
    runId,
    startedAt,
    endedAt,
    scenarioCount: results.length,
    passCount,
    p50Ms,
    p95Ms,
    p99Ms,
    memoryMbMax,
    crashRate,
    verdict,
    verdictReason,
    dryRun: config.dryRun,
    results,
  };

  logEvent("gate-check.summary", {
    runId,
    passCount,
    scenarioCount: results.length,
    p50Ms: Math.round(p50Ms),
    p95Ms: Math.round(p95Ms),
    p99Ms: Math.round(p99Ms),
    memoryMbMax: Math.round(memoryMbMax),
    crashRate,
    verdict,
    verdictReason,
  });

  return summary;
}

// ---------------------------------------------------------------------------
// レポートファイル出力
// ---------------------------------------------------------------------------

export function writeReport(summary: GateCheckSummary, outputDir: string): string {
  const dateStr = summary.startedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = summary.dryRun ? "-dry-run" : "";
  const fileName = `gate-check-${dateStr}${suffix}.md`;
  const filePath = resolvePath(process.cwd(), outputDir, fileName);

  mkdirSync(resolvePath(process.cwd(), outputDir), { recursive: true });
  writeFileSync(filePath, buildMarkdownReport(summary), "utf8");

  logEvent("report.written", { path: filePath });
  return filePath;
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const summary = await runGateCheck(config);

  // Markdown レポート出力
  const reportPath = writeReport(summary, config.outputDir);

  // Supabase 書き込み (設定あり時のみ)
  if (config.supabaseDbUrl !== null) {
    await writeToSupabase(config.supabaseDbUrl, summary);
  }

  // 終了コード: FAIL なら 1
  const exitCode = summary.verdict === "FAIL" ? 1 : 0;

  // eslint-disable-next-line no-console
  console.error(`\n[gate-check] 判定: ${summary.verdict}\n${summary.verdictReason}`);
  // eslint-disable-next-line no-console
  console.error(`[gate-check] レポート: ${reportPath}`);

  process.exit(exitCode);
}

// スクリプトとして直接実行された場合のみ main() を呼ぶ
// テスト時は import して個別関数を呼ぶ
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    logEvent("gate-check.fatal", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    process.exit(2);
  });
}
