/**
 * サーバーエントリポイント
 */

import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { buildApp } from "./app.js";
import { logger, setLoggerEnvironment } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  // L-15: 以降の全ログ行に environment (ENVIRONMENT 環境変数) を付与する
  setLoggerEnvironment(config.ENVIRONMENT);
  const container = buildContainer(config);
  const app = await buildApp(container, config);

  const host = "0.0.0.0";
  const port = config.PORT;

  try {
    await app.listen({ port, host });
    logger.info("server started", { port, host });
  } catch (err) {
    logger.error("server failed to start", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("fatal error", err);
  process.exit(1);
});
