/**
 * Push ディスパッチャー
 *
 * APNs / FCM への配信を担い、以下を実装する:
 * - exponential backoff retry (最大 3 回)
 * - 配信ログの書き込み (push_logs)
 * - トークン無効化時の自動 revoke (NOTIFICATION_DEVICE_TOKEN_INVALID)
 */

import type { Result, AppError, UserId } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { IncomingCallNotification, MissedCallPayload, DeviceTokenRow } from "../schemas.js";
import type { ApnsAdapter } from "../adapters/apns-adapter.js";
import type { FcmAdapter } from "../adapters/fcm-adapter.js";
import type { DeviceTokenRepository } from "../repositories/device-token-repository.js";
import type { PushLogRepository } from "../repositories/push-log-repository.js";
import {
  buildApnsIncomingCallPayload,
  buildApnsMissedCallPayload,
  buildFcmIncomingCallPayload,
  buildFcmMissedCallPayload,
} from "./payload-builder.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * exponential backoff で retry する。
 * retryable = false の場合は即座に失敗を返す。
 */
async function withRetry<T>(
  fn: () => Promise<Result<T>>,
  delayFn: (attempt: number) => Promise<void> = defaultDelay,
): Promise<Result<T>> {
  let lastError: AppError = {
    code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
    message: "未実行",
    retryable: true,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const result = await fn();
    if (result.ok) {
      return result;
    }
    lastError = result.error;

    // retryable でなければ即座に返す
    if (!result.error.retryable) {
      return result;
    }

    // 最後の試行後は待機しない
    if (attempt < MAX_RETRIES - 1) {
      await delayFn(attempt);
    }
  }

  return err(lastError);
}

async function defaultDelay(attempt: number): Promise<void> {
  const ms = Math.min(10000, BASE_DELAY_MS * 2 ** attempt);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export interface PushDispatcherDeps {
  apnsAdapter: ApnsAdapter;
  fcmAdapter: FcmAdapter;
  tokenRepo: DeviceTokenRepository;
  logRepo: PushLogRepository;
  /**
   * APNs/FCM payload HMAC-SHA256 署名用共有鍵。
   * 環境変数 TRANCALL_PUSH_HMAC_SECRET から渡す。
   * docs/notification-detail.md §3.1 参照。
   */
  hmacSecret: string;
  /** テスト用: デフォルト遅延関数を差し替える */
  delayFn?: (attempt: number) => Promise<void>;
}

export interface PushDispatcher {
  sendIncomingCall(
    targetUserId: UserId,
    notification: IncomingCallNotification,
    tokens: DeviceTokenRow[],
  ): Promise<Result<true>>;

  sendMissedCall(
    targetUserId: UserId,
    payload: MissedCallPayload,
    tokens: DeviceTokenRow[],
  ): Promise<Result<true>>;
}

export function createPushDispatcher(deps: PushDispatcherDeps): PushDispatcher {
  const delay = deps.delayFn ?? defaultDelay;

  async function dispatchToToken(
    token: DeviceTokenRow,
    sendFn: () => Promise<Result<unknown>>,
    notificationType: "incoming_call" | "missed_call",
    targetUserId: UserId,
    roomId: IncomingCallNotification["roomId"] | null,
  ): Promise<Result<true>> {
    const result = await withRetry(sendFn, delay);

    if (result.ok) {
      // 配信成功ログ
      await deps.logRepo.write({
        userId: targetUserId,
        notificationType,
        roomId: roomId ?? null,
        delivered: true,
        errorMessage: null,
      });
      return ok(true as const);
    }

    // トークン無効化
    if (result.error.code === "NOTIFICATION_DEVICE_TOKEN_INVALID") {
      await deps.tokenRepo.revoke(token.platform, token.token);
    }

    // 配信失敗ログ
    await deps.logRepo.write({
      userId: targetUserId,
      notificationType,
      roomId: roomId ?? null,
      delivered: false,
      errorMessage: result.error.message,
    });

    return err({
      code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
      message: result.error.message,
      retryable: false,
      details: { provider: result.error.provider },
    });
  }

  return {
    sendIncomingCall: async (targetUserId, notification, tokens) => {
      if (tokens.length === 0) {
        return err({
          code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
          message: "配信先デバイストークンが存在しない",
          retryable: false,
        });
      }

      // issuedAt / expiresAt を同一時刻として生成（全トークン共通）
      const now = new Date();

      const results = await Promise.allSettled(
        tokens.map((token) => {
          if (token.platform === "ios") {
            const payload = buildApnsIncomingCallPayload(notification, deps.hmacSecret, now);
            return dispatchToToken(
              token,
              () => deps.apnsAdapter.sendVoipPush(token.token, payload),
              "incoming_call",
              targetUserId,
              notification.roomId,
            );
          } else {
            const data = buildFcmIncomingCallPayload(notification, deps.hmacSecret, now);
            return dispatchToToken(
              token,
              () => deps.fcmAdapter.sendData(token.token, data),
              "incoming_call",
              targetUserId,
              notification.roomId,
            );
          }
        }),
      );

      // 1件でも成功すれば ok
      const hasSuccess = results.some(
        (r) => r.status === "fulfilled" && r.value.ok,
      );
      if (hasSuccess) {
        return ok(true as const);
      }

      return err({
        code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
        message: "すべてのデバイスへの配信が失敗した",
        retryable: false,
      });
    },

    sendMissedCall: async (targetUserId, payload, tokens) => {
      if (tokens.length === 0) {
        return err({
          code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
          message: "配信先デバイストークンが存在しない",
          retryable: false,
        });
      }

      const results = await Promise.allSettled(
        tokens.map((token) => {
          if (token.platform === "ios") {
            const apnsPayload = buildApnsMissedCallPayload(payload);
            return dispatchToToken(
              token,
              () => deps.apnsAdapter.sendNormalPush(token.token, apnsPayload),
              "missed_call",
              targetUserId,
              payload.roomId,
            );
          } else {
            const fcmData = buildFcmMissedCallPayload(payload);
            return dispatchToToken(
              token,
              () => deps.fcmAdapter.sendData(token.token, fcmData),
              "missed_call",
              targetUserId,
              payload.roomId,
            );
          }
        }),
      );

      const hasSuccess = results.some(
        (r) => r.status === "fulfilled" && r.value.ok,
      );
      if (hasSuccess) {
        return ok(true as const);
      }

      return err({
        code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
        message: "すべてのデバイスへの配信が失敗した",
        retryable: false,
      });
    },
  };
}
