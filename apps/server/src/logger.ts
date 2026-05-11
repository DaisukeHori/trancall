/**
 * JSON Lines 構造化ロガー
 *
 * apps/translation-agent/src/logger.ts と同等の形式。
 * 本番では stdout に JSON Lines を出力し、Cloud Logging 等で収集する。
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
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
