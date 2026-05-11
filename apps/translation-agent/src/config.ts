/**
 * 環境変数バリデーション
 *
 * Translation Agent が起動時に必要とする環境変数を Zod で検証する。
 * 1つでも不足/不正があれば即 fail-fast し、worker が起動しないようにする。
 */

import { z } from "zod";

const ConfigSchema = z.object({
  // --- LiveKit ---
  LIVEKIT_URL: z.string().url().describe("LiveKit Server WSS URL (e.g. wss://xxx.livekit.cloud)"),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  // --- OpenAI ---
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_REALTIME_TRANSLATE_URL: z
    .string()
    .url()
    .default("wss://api.openai.com/v1/realtime/translations"),

  // --- TranCall Server 内部 API ---
  // Server → Agent / Agent → Server 双方向の HMAC-SHA256 認証用共有鍵
  // 設計書 docs/security-detail.md の section "Agent 内部 API" を参照
  TRANCALL_AGENT_HMAC_SECRET: z.string().min(32).describe("32文字以上の HMAC 共有鍵"),
  TRANCALL_SERVER_URL: z
    .string()
    .url()
    .describe("Agent → Server コールバック先 (https://api.trancall.app)"),

  // --- Worker ---
  AGENT_NAME: z.string().min(1).default("trancall-translation-agent"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // --- 任意 ---
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SENTRY_DSN: z.string().url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * 環境変数を読み込み、バリデーション失敗時はプロセスを終了する。
 *
 * テスト用に env をオーバーライドできるよう、引数に `process.env` を受け取る。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("[config] 環境変数バリデーション失敗:");
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}
