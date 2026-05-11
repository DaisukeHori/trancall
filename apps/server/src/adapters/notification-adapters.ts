/**
 * Notification Adapters — APNs / FCM ファクトリ
 *
 * 環境変数から APNs / FCM アダプターを構築する。
 * APNs / FCM の設定が不完全な場合はスタブを返す（開発・テスト用）。
 */

import type { ApnsAdapter, FcmAdapter } from "@trancall/notification";
import { createApnsAdapter, createFcmAdapter } from "@trancall/notification";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import type { Result, AppError } from "@trancall/shared-kernel";
import { ok } from "@trancall/shared-kernel";

/** APNs 未設定時の no-op スタブ */
function createStubApnsAdapter(): ApnsAdapter {
  return {
    async sendVoipPush(): Promise<Result<{ apnsId: string | undefined }, AppError>> {
      logger.warn("APNs adapter is not configured (stub)");
      return ok({ apnsId: undefined });
    },
    async sendNormalPush(): Promise<Result<{ apnsId: string | undefined }, AppError>> {
      logger.warn("APNs adapter is not configured (stub)");
      return ok({ apnsId: undefined });
    },
  };
}

/** FCM 未設定時の no-op スタブ */
function createStubFcmAdapter(): FcmAdapter {
  return {
    async sendData(): Promise<Result<{ messageId: string }, AppError>> {
      logger.warn("FCM adapter is not configured (stub)");
      return ok({ messageId: "stub" });
    },
    async close(): Promise<void> {
      // no-op
    },
  };
}

export function buildApnsAdapter(config: Config): ApnsAdapter {
  if (!config.APNS_KEY_ID || !config.APNS_TEAM_ID || !config.APNS_KEY_PATH) {
    logger.warn("APNs 設定が不完全です。スタブを使用します。");
    return createStubApnsAdapter();
  }

  return createApnsAdapter({
    keyId: config.APNS_KEY_ID,
    teamId: config.APNS_TEAM_ID,
    bundleId: config.APNS_BUNDLE_ID,
    keyPath: config.APNS_KEY_PATH,
    sandbox: config.APNS_SANDBOX,
  });
}

export function buildFcmAdapter(config: Config): FcmAdapter {
  if (!config.FCM_SERVICE_ACCOUNT_JSON) {
    logger.warn("FCM_SERVICE_ACCOUNT_JSON が未設定です。スタブを使用します。");
    return createStubFcmAdapter();
  }

  return createFcmAdapter({
    projectId: "trancall",
    serviceAccountJsonPath: config.FCM_SERVICE_ACCOUNT_JSON,
  });
}
