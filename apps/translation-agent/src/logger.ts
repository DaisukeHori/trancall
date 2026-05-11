/**
 * 構造化ログ
 *
 * Phase 1a Sprint 0 では console.log ベースの軽量実装。
 * Phase 1b 以降で pino / winston への置き換え検討。
 *
 * 設計方針:
 * - JSON Lines 形式で stdout に出力（クラウドの log collector が拾いやすい）
 * - level / message / context を必ず含める
 * - 個人情報（音声 PCM、認証トークン、TranCall ID など）はログに出さない
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  child: (childContext: Record<string, unknown>) => Logger;
}

export function createLogger(
  minLevel: LogLevel = "info",
  baseContext: Record<string, unknown> = {},
): Logger {
  function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...baseContext, ...context },
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }

  return {
    debug: (message, context) => {
      emit("debug", message, context);
    },
    info: (message, context) => {
      emit("info", message, context);
    },
    warn: (message, context) => {
      emit("warn", message, context);
    },
    error: (message, context) => {
      emit("error", message, context);
    },
    child: (childContext) => createLogger(minLevel, { ...baseContext, ...childContext }),
  };
}
