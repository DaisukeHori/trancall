/**
 * FCM (Firebase Cloud Messaging) アダプタ
 *
 * firebase-admin をラップし、サービスアカウント JSON で初期化して
 * Android 向け高優先度メッセージを送信する。
 *
 * adapters/ 配下のため型アサーション (as) が許可されている。
 */

import * as admin from "firebase-admin";

import type { Result, AppError } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

import type { FcmDataPayload } from "../schemas.js";

export interface FcmAdapterConfig {
  projectId: string;
  /** サービスアカウント JSON ファイルのパス */
  serviceAccountJsonPath: string;
  /** テスト用: モックした messaging インスタンスを渡す */
  messagingOverride?: admin.messaging.Messaging;
}

export interface FcmSendResult {
  messageId: string;
}

export interface FcmAdapter {
  sendData(
    fcmToken: string,
    data: FcmDataPayload,
  ): Promise<Result<FcmSendResult>>;

  /** リソース解放（テスト後のクリーンアップ用） */
  close(): Promise<void>;
}

/** FCM エラーコードを AppError に変換する */
function mapFcmError(errorCode: string | undefined, message: string): AppError {
  const invalidTokenCodes = [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
  ];
  if (errorCode !== undefined && invalidTokenCodes.includes(errorCode)) {
    return {
      code: "NOTIFICATION_DEVICE_TOKEN_INVALID",
      message: `FCM: ${message}`,
      retryable: false,
      provider: "fcm",
      details: { errorCode },
    };
  }
  return {
    code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
    message: `FCM: ${message}`,
    retryable: true,
    provider: "fcm",
    details: { errorCode },
  };
}

/** firebase-admin の FirebaseError ガード */
function isFirebaseError(e: unknown): e is admin.FirebaseError & Error {
  return (
    e instanceof Error &&
    "code" in e &&
    typeof (e as Record<string, unknown>)["code"] === "string"
  );
}

export function createFcmAdapter(config: FcmAdapterConfig): FcmAdapter {
  let messaging: admin.messaging.Messaging;

  if (config.messagingOverride !== undefined) {
    messaging = config.messagingOverride;
  } else {
    // firebase-admin のアプリを初期化（projectId を名前として使い重複を防ぐ）
    const appName = `trancall-notification-${config.projectId}`;
    let app: admin.app.App;
    try {
      app = admin.app(appName);
    } catch {
      // アプリがまだ初期化されていない場合
      const serviceAccount = require(config.serviceAccountJsonPath) as admin.ServiceAccount;
      app = admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
          projectId: config.projectId,
        },
        appName,
      );
    }
    messaging = app.messaging();
  }

  return {
    sendData: async (fcmToken, data) => {
      // FCM data payload は文字列値のみ許可
      const stringData: Record<string, string> = {
        type: data.type,
        roomId: data.roomId,
        callerName: data.callerName,
        callerAvatarUrl: data.callerAvatarUrl ?? "",
        timestamp: data.timestamp,
      };
      if (data.callerTrancallId !== undefined) {
        stringData["callerTrancallId"] = data.callerTrancallId;
      }
      if (data.roomType !== undefined) {
        stringData["roomType"] = data.roomType;
      }
      if (data.translationEnabled !== undefined) {
        stringData["translationEnabled"] = data.translationEnabled;
      }
      if (data.languagePair !== undefined) {
        stringData["languagePair"] = data.languagePair;
      }

      const message: admin.messaging.Message = {
        token: fcmToken,
        data: stringData,
        android: {
          priority: "high",
          ttl: 30 * 1000, // 30秒 (ms単位)
        },
      };

      try {
        const messageId = await messaging.send(message);
        return ok({ messageId });
      } catch (e: unknown) {
        if (isFirebaseError(e)) {
          return err(mapFcmError(e.code, e.message));
        }
        return err({
          code: "NOTIFICATION_PUSH_DELIVERY_FAILED",
          message: e instanceof Error ? e.message : String(e),
          retryable: true,
          provider: "fcm",
        });
      }
    },

    close: async () => {
      // firebase-admin アプリの明示的なクリーンアップは不要だが
      // テスト向けに空の実装を提供する
    },
  };
}
