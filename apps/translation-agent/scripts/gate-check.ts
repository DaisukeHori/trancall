/**
 * TranCall Translation Agent — Phase 1a Gate Check
 *
 * Translation Agentの本番採用可否を判定するための測定スクリプト。
 * 以下のゲート基準を全て満たすことがPhase 1a完了の必須条件:
 *
 * 1. 30分連続翻訳セッションが安定動作する（crash/hang/エラー率1%未満）
 * 2. メモリ使用量がピーク時512MB未満を維持する
 * 3. 翻訳レイテンシーが p50 1.5s / p95 3.0s / p99 5.0s を満たす
 * 4. Agent crash時に通話が原音fallbackで継続する
 * 5. WebSocket再接続が10秒以内に完了する
 *
 * 使い方:
 *   npx tsx apps/translation-agent/scripts/gate-check.ts
 *
 * 環境変数:
 *   LIVEKIT_URL        - LiveKit server URL
 *   LIVEKIT_API_KEY    - LiveKit API key
 *   LIVEKIT_API_SECRET - LiveKit API secret
 *   OPENAI_API_KEY     - OpenAI API key
 *   TEST_DURATION_MIN  - テスト時間（デフォルト: 30）
 *   LANGUAGE_PAIRS     - テスト言語ペア（デフォルト: "ja-en,ja-zh,ja-ko"）
 */

interface GateResult {
  testName: string;
  passed: boolean;
  metric: string;
  threshold: string;
  actual: string;
  details?: string;
}

interface LatencyBucket {
  captureToAgentMs: number;
  agentToOpenAIMs: number;
  openAIFirstDeltaMs: number;
  agentPublishMs: number;
  totalEndToEndMs: number;
}

async function measureLatency(
  _languagePair: string,
  _durationMinutes: number,
): Promise<LatencyBucket[]> {
  // TODO: Phase 1a で実装
  // 1. LiveKit Room 作成
  // 2. 模擬音声（WAVファイル）を Publish
  // 3. Agent が Subscribe → OpenAI 送信 → 翻訳 Track Publish
  // 4. 各ホップのタイムスタンプを記録
  // 5. LatencyBucket[] を返す
  console.log(`[TODO] Latency measurement for ${_languagePair} over ${_durationMinutes} min`);
  return [];
}

async function measureMemory(
  _durationMinutes: number,
): Promise<{ peakRss: number; avgRss: number; heapUsedPeak: number }> {
  // TODO: Phase 1a で実装
  // 1. Agent プロセスを起動
  // 2. durationMinutes 間、5秒ごとに process.memoryUsage() を記録
  // 3. ピーク / 平均を返す
  console.log(`[TODO] Memory measurement over ${_durationMinutes} min`);
  return { peakRss: 0, avgRss: 0, heapUsedPeak: 0 };
}

async function measureCrashRecovery(): Promise<{
  fallbackActivatedMs: number;
  rawAudioContinued: boolean;
}> {
  // TODO: Phase 1a で実装
  // 1. 通話中に Agent プロセスを SIGKILL
  // 2. クライアント側で原音 fallback が有効化されるまでの時間を計測
  // 3. 通話自体が継続しているか確認
  console.log("[TODO] Crash recovery measurement");
  return { fallbackActivatedMs: 0, rawAudioContinued: false };
}

async function measureReconnect(): Promise<{
  reconnectMs: number;
  audioGapMs: number;
}> {
  // TODO: Phase 1a で実装
  // 1. Agent の OpenAI WebSocket を強制切断
  // 2. 再接続完了までの時間を計測
  // 3. 音声の途切れ時間を計測
  console.log("[TODO] Reconnect measurement");
  return { reconnectMs: 0, audioGapMs: 0 };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function runGateCheck(): Promise<void> {
  const durationMin = Number(process.env["TEST_DURATION_MIN"] ?? "30");
  const pairs = (process.env["LANGUAGE_PAIRS"] ?? "ja-en,en-ja,ja-zh,zh-ja,ja-ko,ko-ja").split(",");

  console.log("=== TranCall Translation Agent Gate Check ===");
  console.log(`Duration: ${String(durationMin)} min`);
  console.log(`Language pairs: ${pairs.join(", ")}`);
  console.log("");

  const results: GateResult[] = [];

  // Gate 1: 30分連続安定動作
  for (const pair of pairs) {
    const buckets = await measureLatency(pair, durationMin);
    const totals = buckets.map((b) => b.totalEndToEndMs);

    if (totals.length > 0) {
      const p50 = percentile(totals, 50);
      const p95 = percentile(totals, 95);
      const p99 = percentile(totals, 99);

      results.push({
        testName: `Latency p50 [${pair}]`,
        passed: p50 <= 1500,
        metric: "p50",
        threshold: "≤ 1500ms",
        actual: `${String(p50)}ms`,
      });
      results.push({
        testName: `Latency p95 [${pair}]`,
        passed: p95 <= 3000,
        metric: "p95",
        threshold: "≤ 3000ms",
        actual: `${String(p95)}ms`,
      });
      results.push({
        testName: `Latency p99 [${pair}]`,
        passed: p99 <= 5000,
        metric: "p99",
        threshold: "≤ 5000ms",
        actual: `${String(p99)}ms`,
      });

      // ホップ別内訳（ボトルネック特定用）
      const hopNames: (keyof LatencyBucket)[] = [
        "captureToAgentMs", "agentToOpenAIMs",
        "openAIFirstDeltaMs", "agentPublishMs",
      ];
      for (const hop of hopNames) {
        const vals = buckets.map((b) => b[hop]);
        const hp50 = percentile(vals, 50);
        const hp95 = percentile(vals, 95);
        results.push({
          testName: `  └ ${hop} p50/p95 [${pair}]`,
          passed: true, // ホップ別は情報提供のみ（pass/fail判定はend-to-endで）
          metric: "p50/p95",
          threshold: "info only",
          actual: `${String(hp50)}ms / ${String(hp95)}ms`,
          details: hp95 > 1000 ? "⚠ BOTTLENECK CANDIDATE" : undefined,
        });
      }
    } else {
      results.push({
        testName: `Latency [${pair}]`,
        passed: false,
        metric: "N/A",
        threshold: "measurement required",
        actual: "NOT IMPLEMENTED",
      });
    }
  }

  // Gate 2: メモリ使用量
  const mem = await measureMemory(durationMin);
  results.push({
    testName: "Memory peak RSS",
    passed: mem.peakRss < 512 * 1024 * 1024,
    metric: "peak RSS",
    threshold: "< 512MB",
    actual: `${String(Math.round(mem.peakRss / 1024 / 1024))}MB`,
  });

  // Gate 3: Crash recovery
  const crash = await measureCrashRecovery();
  results.push({
    testName: "Crash → raw audio fallback",
    passed: crash.rawAudioContinued,
    metric: "fallback activated",
    threshold: "true",
    actual: String(crash.rawAudioContinued),
  });

  // Gate 4: WebSocket reconnect
  const reconnect = await measureReconnect();
  results.push({
    testName: "WebSocket reconnect time",
    passed: reconnect.reconnectMs < 10000,
    metric: "reconnect",
    threshold: "< 10s",
    actual: `${String(reconnect.reconnectMs)}ms`,
  });

  // 結果出力
  console.log("\n=== Gate Check Results ===\n");
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}  ${r.testName}`);
    console.log(`       ${r.metric}: ${r.actual} (threshold: ${r.threshold})`);
    if (!r.passed) allPassed = false;
  }

  console.log("\n=== Summary ===");
  if (allPassed) {
    console.log("✅ ALL GATES PASSED — TypeScript Agent is production-ready");
  } else {
    console.log("❌ SOME GATES FAILED — Consider switching to Python livekit-agents");
    console.log("   See: apps/translation-agent/CLAUDE.md for fallback plan");
  }

  process.exit(allPassed ? 0 : 1);
}

runGateCheck().catch((e: unknown) => {
  console.error("Gate check failed with error:", e);
  process.exit(2);
});
