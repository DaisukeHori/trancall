/**
 * デバイストークン管理サービス
 *
 * トークンの登録・取得・無効化ロジックを担う。
 * DB 操作は DeviceTokenRepository インターフェース経由で行う。
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import { err } from "@trancall/shared-kernel";

import type { DeviceTokenRow, NotificationTarget } from "../schemas";
import { NotificationTargetSchema } from "../schemas";
import type { DeviceTokenRepository } from "../repositories/device-token-repository";

export interface DeviceTokenService {
  /**
   * デバイストークンを登録する。
   * バリデーション失敗時は VALIDATION_ERROR を返す。
   * UNIQUE(platform, token) 制約により同じトークンは upsert になる。
   */
  register(
    userId: UserId,
    rawTarget: unknown,
  ): Promise<Result<DeviceTokenRow>>;

  /**
   * ユーザーの有効なデバイストークンを取得する。
   */
  getActiveTokens(
    userId: UserId,
    platform?: "ios" | "android",
  ): Promise<Result<DeviceTokenRow[]>>;

  /**
   * トークンを無効化する（APNs 410 / FCM UNREGISTERED 受信後に呼ぶ）。
   */
  revoke(
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true>>;

  /**
   * トークンを削除する（ログアウト時など）。
   */
  delete(
    userId: UserId,
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true>>;
}

export function createDeviceTokenService(repo: DeviceTokenRepository): DeviceTokenService {
  return {
    register: async (userId, rawTarget) => {
      // Zod バリデーション
      const parsed = NotificationTargetSchema.safeParse(rawTarget);
      if (!parsed.success) {
        return err({
          code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          retryable: false,
          details: { issues: parsed.error.issues },
        });
      }

      const target: NotificationTarget = parsed.data;
      return repo.upsert(userId, target);
    },

    getActiveTokens: (userId, platform) => {
      return repo.findActiveByUserId(userId, platform);
    },

    revoke: (platform, token) => {
      return repo.revoke(platform, token);
    },

    delete: (userId, platform, token) => {
      return repo.delete(userId, platform, token);
    },
  };
}
