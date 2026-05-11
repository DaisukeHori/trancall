/**
 * 環境変数バリデーション
 *
 * 起動時に失敗した場合は即 fail-fast する。
 * テスト用に env をオーバーライドできるよう引数に env を受け取る。
 */

import { z } from "zod";

const ConfigSchema = z.object({
  // --- APNs ---
  APNS_KEY_ID: z.string().min(1).describe("APNs .p8 キーの Key ID"),
  APNS_TEAM_ID: z.string().min(1).describe("Apple Developer Team ID"),
  APNS_BUNDLE_ID: z.string().min(1).describe("iOS アプリの Bundle ID (VoIP)"),
  APNS_KEY_PATH: z.string().min(1).describe("APNs .p8 秘密鍵ファイルのパス"),

  // --- FCM ---
  FCM_PROJECT_ID: z.string().min(1).describe("Firebase Project ID"),
  FCM_SERVICE_ACCOUNT_JSON_PATH: z
    .string()
    .min(1)
    .describe("Firebase Admin SDK サービスアカウント JSON のパス"),

  // --- 任意 ---
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type NotificationConfig = z.infer<typeof ConfigSchema>;

/**
 * 環境変数を読み込み、バリデーション失敗時はプロセスを終了する。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("[notification/config] 環境変数バリデーション失敗:");
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

/**
 * テスト用: バリデーションのみ行い、失敗時は Result を返す（プロセス終了しない）。
 */
export function parseConfig(
  env: NodeJS.ProcessEnv,
): { success: true; data: NotificationConfig } | { success: false; error: string } {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
