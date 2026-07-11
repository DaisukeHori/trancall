/**
 * JSON Lines 構造化ロガー
 *
 * apps/translation-agent/src/logger.ts と同等の形式。
 * 本番では stdout に JSON Lines を出力し、Cloud Logging 等で収集する。
 *
 * L-15 (docs/deployment-render-dryrun.md §11.4): リクエスト単位の `correlation_id` と
 * `environment` (ENVIRONMENT 環境変数) を全ログ行に自動付与する。
 * - `environment`: `setLoggerEnvironment()` で起動時に一度設定するプロセスグローバル値
 *   (config.ts の ENVIRONMENT を反映)。
 * - `correlation_id`: リクエストごとに変わる値のため、呼び出しチェーンの全箇所に
 *   明示的にバケツリレーするのではなく Node の `AsyncLocalStorage` で伝搬する。
 *   `middleware/correlation-id-middleware.ts` の onRequest フックが
 *   `runWithCorrelationId()` / `enterCorrelationId()` でリクエストごとのコンテキストに
 *   correlation_id を設定し、そのリクエスト処理中に呼ばれる `logger.*()` は
 *   自動的にその値を拾う。
 */
import { AsyncLocalStorage } from "node:async_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

interface LogContext {
  correlationId: string;
}

const correlationIdStorage = new AsyncLocalStorage<LogContext>();

/** リクエスト処理の呼び出しチェーン全体で correlation_id を共有するコンテキストへ入る */
export function enterCorrelationId(correlationId: string): void {
  correlationIdStorage.enterWith({ correlationId });
}

/** 現在の非同期コンテキストに紐づく correlation_id (未設定なら undefined) */
export function getCorrelationId(): string | undefined {
  return correlationIdStorage.getStore()?.correlationId;
}

let environmentTag: string | undefined;

/** config.ts の ENVIRONMENT を起動時に一度設定する (index.ts から呼ぶ) */
export function setLoggerEnvironment(environment: string): void {
  environmentTag = environment;
}

/** テスト用: environment / correlation_id の状態をリセットする */
export function resetLoggerContextForTest(): void {
  environmentTag = undefined;
}

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const correlationId = getCorrelationId();
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(environmentTag !== undefined ? { environment: environmentTag } : {}),
    ...(correlationId !== undefined ? { correlation_id: correlationId } : {}),
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

export function createLogger(name: string): Logger {
  return {
    debug: (msg, meta) => write("debug", msg, { name, ...meta }),
    info: (msg, meta) => write("info", msg, { name, ...meta }),
    warn: (msg, meta) => write("warn", msg, { name, ...meta }),
    error: (msg, meta) => write("error", msg, { name, ...meta }),
  };
}

export const logger = createLogger("server");
