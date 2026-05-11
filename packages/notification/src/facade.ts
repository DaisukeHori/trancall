/**
 * @trancall/notification 公開ファサード
 *
 * 他モジュール (room など) はこのファサード経由でしか notification に触れない。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import { err } from "@trancall/shared-kernel";

import type {
  NotificationTarget,
  IncomingCallNotification,
  MissedCallPayload,
} from "./schemas.js";
import {
  NotificationTargetSchema,
  IncomingCallNotificationSchema,
  MissedCallPayloadSchema,
} from "./schemas.js";
import type { DeviceTokenService } from "./services/device-token-service.js";
import type { PushDispatcher } from "./services/push-dispatcher.js";

export interface NotificationFacade {
  /**
   * デバイストークンを登録する。
   * iOS: voipToken + bundleId
   * Android: fcmToken
   */
  registerDevice(
    userId: UserId,
    target: NotificationTarget,
  ): Promise<Result<true>>;

  /**
   * デバイストークンを削除する（ログアウト時）。
   */
  unregisterDevice(
    userId: UserId,
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true>>;

  /**
   * 着信通知を送信する。
   */
  sendIncomingCall(
    targetUserId: UserId,
    notification: IncomingCallNotification,
  ): Promise<Result<true>>;

  /**
   * 不在着信通知を送信する。
   */
  sendMissedCall(
    targetUserId: UserId,
    payload: MissedCallPayload,
  ): Promise<Result<true>>;
}

export interface NotificationFacadeDeps {
  tokenService: DeviceTokenService;
  dispatcher: PushDispatcher;
}

export function createNotificationFacade(deps: NotificationFacadeDeps): NotificationFacade {
  return {
    registerDevice: async (userId, target) => {
      // NotificationTarget は外部入力として再バリデーション
      const parsed = NotificationTargetSchema.safeParse(target);
      if (!parsed.success) {
        return err({
          code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          retryable: false,
        });
      }
      const result = await deps.tokenService.register(userId, parsed.data);
      if (!result.ok) {
        return result;
      }
      return { ok: true, data: true as const };
    },

    unregisterDevice: async (userId, platform, token) => {
      return deps.tokenService.delete(userId, platform, token);
    },

    sendIncomingCall: async (targetUserId, notification) => {
      // バリデーション
      const parsed = IncomingCallNotificationSchema.safeParse(notification);
      if (!parsed.success) {
        return err({
          code: "VALIDATION_ERROR",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          retryable: false,
        });
      }

      // 対象ユーザーのデバイストークンを取得
      const tokensResult = await deps.tokenService.getActiveTokens(targetUserId);
      if (!tokensResult.ok) {
        return tokensResult;
      }

      return deps.dispatcher.sendIncomingCall(targetUserId, parsed.data, tokensResult.data);
    },

    sendMissedCall: async (targetUserId, payload) => {
      const parsed = MissedCallPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return err({
          code: "VALIDATION_ERROR",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          retryable: false,
        });
      }

      const tokensResult = await deps.tokenService.getActiveTokens(targetUserId);
      if (!tokensResult.ok) {
        return tokensResult;
      }

      return deps.dispatcher.sendMissedCall(targetUserId, parsed.data, tokensResult.data);
    },
  };
}
