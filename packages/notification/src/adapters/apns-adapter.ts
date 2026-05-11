/**
 * APNs VoIP Push アダプタ
 *
 * @parse/node-apn をラップし、.p8 JWT 認証で APNs に HTTP/2 リクエストを送る。
 *
 * adapters/ 配下のため型アサーション (as) が許可されている。
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const apn = require("@parse/node-apn") as typeof import("@parse/node-apn");

import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { ApnsVoipPayload } from "../schemas.js";

export interface ApnsAdapterConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** .p8 ファイルのパス */
  keyPath: string;
  /** テスト用: true で APNs sandbox エンドポイントを使う */
  sandbox?: boolean;
}

export interface ApnsSendResult {
  /** HTTP/2 レスポンスの apns-id ヘッダー (存在する場合のみ) */
  apnsId: string | undefined;
}

export interface ApnsAdapter {
  sendVoipPush(
    deviceToken: string,
    payload: ApnsVoipPayload,
  ): Promise<Result<ApnsSendResult, AppError>>;

  /**
   * 通常通知 (missed_call 等) を送信する。
   * payload は任意の JSON オブジェクト。
   */
  sendNormalPush(
    deviceToken: string,
    payload: Record<string, unknown>,
  ): Promise<Result<ApnsSendResult, AppError>>;
}

/**
 * APNs からの既知エラーコードを AppError コードに変換する。
 * 410 = デバイストークン無効（NOTIFICATION_DEVICE_TOKEN_INVALID）
 */
function mapApnsError(
  reason: string | undefined,
  statusCode: number | undefined,
): AppError {
  if (statusCode === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
    return {
      code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
      message: `APNs: ${reason ?? "token invalid"} (${String(statusCode)})`,
      retryable: false,
      provider: "apns",
      details: { reason, statusCode },
    };
  }
  return {
    code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
    message: `APNs: ${reason ?? "unknown"} (${String(statusCode)})`,
    retryable: true,
    provider: "apns",
    details: { reason, statusCode },
  };
}

export function createApnsAdapter(config: ApnsAdapterConfig): ApnsAdapter {
  // node-apn の Provider を初期化
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const provider = new apn.Provider({
    token: {
      key: config.keyPath,
      keyId: config.keyId,
      teamId: config.teamId,
    },
    production: !(config.sandbox ?? false),
  });

  return {
    sendVoipPush: async (deviceToken, payload) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const notification = new apn.Notification();

      // VoIP Push 設定
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.topic = `${config.bundleId}.voip`;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.pushType = "voip";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.priority = 10;

      // aps は空 (VoIP Push では aps を空にする)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.aps = {};

      // trancall カスタムペイロード
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.payload = { trancall: payload.trancall };

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const result = await provider.send(notification, deviceToken);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const failed = result.failed as Array<{
          device: string;
          response?: { reason?: string; statusCode?: number };
          error?: Error;
        }>;

        if (failed.length > 0) {
          const failure = failed[0];
          if (!failure) {
            return err({
              code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
              message: "APNs: unknown failure",
              retryable: true,
              provider: "apns",
            });
          }

          if (failure.error) {
            return err({
              code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
              message: failure.error.message,
              retryable: true,
              provider: "apns",
            });
          }

          return err(mapApnsError(
            failure.response?.reason,
            failure.response?.statusCode,
          ));
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const sent = result.sent as Array<{ device: string }>;
        const firstSent = sent[0];
        return ok({ apnsId: firstSent?.device });
      } catch (e: unknown) {
        return err({
          code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
          message: e instanceof Error ? e.message : String(e),
          retryable: true,
          provider: "apns",
        });
      }
    },

    sendNormalPush: async (deviceToken, payload) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const notification = new apn.Notification();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.topic = config.bundleId;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.priority = 10;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      notification.payload = payload;

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const result = await provider.send(notification, deviceToken);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const failed = result.failed as Array<{
          device: string;
          response?: { reason?: string; statusCode?: number };
          error?: Error;
        }>;

        if (failed.length > 0) {
          const failure = failed[0];
          if (!failure) {
            return err({
              code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
              message: "APNs: unknown failure",
              retryable: true,
              provider: "apns",
            });
          }
          if (failure.error) {
            return err({
              code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
              message: failure.error.message,
              retryable: true,
              provider: "apns",
            });
          }
          return err(mapApnsError(failure.response?.reason, failure.response?.statusCode));
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const sent = result.sent as Array<{ device: string }>;
        const firstSent = sent[0];
        return ok({ apnsId: firstSent?.device });
      } catch (e: unknown) {
        return err({
          code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
          message: e instanceof Error ? e.message : String(e),
          retryable: true,
          provider: "apns",
        });
      }
    },
  };
}
