/**
 * Push 通知ペイロードビルダー
 *
 * docs/notification-detail.md の仕様に従い、APNs / FCM 向けペイロードを生成する。
 */

import type { ApnsVoipPayload, FcmDataPayload, IncomingCallNotification, MissedCallPayload } from "../schemas.js";

// ---------------------------------------------------------------------------
// iOS APNs VoIP Push payload
// ---------------------------------------------------------------------------

/**
 * 着信通知用 APNs VoIP payload を組み立てる。
 *
 * docs/notification-detail.md に記載の形式に厳密に従う:
 * - aps は空オブジェクト
 * - trancall.type = "incoming_call"
 * - callerTrancallId / callerLanguage を含む
 */
export function buildApnsIncomingCallPayload(
  notification: IncomingCallNotification,
): ApnsVoipPayload {
  return {
    aps: {},
    trancall: {
      type: "incoming_call",
      roomId: notification.roomId,
      callerName: notification.callerName,
      callerAvatarUrl: notification.callerAvatarUrl,
      callerTrancallId: notification.callerTrancallId,
      roomType: notification.roomType,
      translationEnabled: notification.translationEnabled,
      languagePair: notification.languagePair,
      callerLanguage: notification.callerLanguage,
      timestamp: notification.timestamp,
    },
  };
}

/**
 * 不在着信通知用 APNs payload を組み立てる。
 * 通常通知として notification + data を両方含む形式。
 */
export function buildApnsMissedCallPayload(missed: MissedCallPayload): Record<string, unknown> {
  return {
    aps: {
      alert: {
        title: "Missed call",
        body: missed.callerName,
      },
      "content-available": 1,
    },
    trancall: {
      type: "missed_call",
      roomId: missed.roomId,
      callerName: missed.callerName,
      callerAvatarUrl: missed.callerAvatarUrl,
      timestamp: missed.timestamp,
    },
  };
}

// ---------------------------------------------------------------------------
// Android FCM data payload
// ---------------------------------------------------------------------------

/**
 * 着信通知用 FCM data payload を組み立てる。
 *
 * FCM data はすべて文字列値でなければならないため、
 * boolean は文字列 "true"/"false" に変換する。
 */
export function buildFcmIncomingCallPayload(
  notification: IncomingCallNotification,
): FcmDataPayload {
  return {
    type: "incoming_call",
    roomId: notification.roomId,
    callerName: notification.callerName,
    callerAvatarUrl: notification.callerAvatarUrl,
    callerTrancallId: notification.callerTrancallId,
    roomType: notification.roomType,
    translationEnabled: String(notification.translationEnabled),
    languagePair: notification.languagePair,
    timestamp: notification.timestamp,
  };
}

/**
 * 不在着信通知用 FCM data payload を組み立てる。
 */
export function buildFcmMissedCallPayload(missed: MissedCallPayload): FcmDataPayload {
  return {
    type: "missed_call",
    roomId: missed.roomId,
    callerName: missed.callerName,
    callerAvatarUrl: missed.callerAvatarUrl,
    timestamp: missed.timestamp,
  };
}
