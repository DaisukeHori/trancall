/**
 * TranCall Translation Agent — エントリポイント
 *
 * 起動方法:
 *   pnpm dev          # tsx watch（開発）
 *   pnpm build && pnpm start  # 本番
 *
 * 動作:
 *   1. .env / 環境変数を読み込み、Zod バリデーション
 *   2. logger / internalApiClient を生成
 *   3. agent.ts の defineAgent に依存を注入
 *   4. @livekit/agents の cli.runApp() で Worker を起動
 *   5. LiveKit Server へ WebSocket 接続 → Job 受信待ち
 */

import { fileURLToPath } from "node:url";

import { WorkerOptions, cli } from "@livekit/agents";

import { loadConfig } from "./config.js";
import { InternalApiClient } from "./internal-api-client.js";
import { createLogger } from "./logger.js";
import { injectDependencies } from "./agent.js";

const config = loadConfig();

const logger = createLogger(config.LOG_LEVEL, {
  service: "trancall-translation-agent",
  agentName: config.AGENT_NAME,
  env: config.NODE_ENV,
});

const internalApiClient = new InternalApiClient({
  serverUrl: config.TRANCALL_SERVER_URL,
  hmacSecret: config.TRANCALL_AGENT_HMAC_SECRET,
  agentName: config.AGENT_NAME,
  maxRetries: 3,
  logger: logger.child({ component: "InternalApiClient" }),
});

injectDependencies({
  config,
  logger,
  internalApiClient,
});

logger.info("Worker 起動", {
  livekitUrl: config.LIVEKIT_URL,
});

// agents-js 1.0 公式パターン: cli.runApp(new WorkerOptions(...))
// 第 2 引数の agent エントリは fileURLToPath で渡す必要がある
cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(new URL("./agent.js", import.meta.url)),
    // agentName を指定すると LiveKit Server 側で named agent として登録され、
    // Server SDK の `agents.dispatch(agentName)` で明示的に dispatch できる
    agentName: config.AGENT_NAME,
  }),
);
