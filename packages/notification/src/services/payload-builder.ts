/**
 * Push 通知ペイロードビルダー
 *
 * docs/notification-detail.md の仕様に従い、APNs / FCM 向けペイロードを生成する。
 * T-8: uuid / callerId / issuedAt / expiresAt / signature を canonical payload に追加。
 * HMAC 署名は docs/notification-detail.md §3 仕様に厳密に従う。
 */

import type { ApnsVoipPayload, FcmDataPayload, IncomingCallNotification, MissedCallPayload } from "../schemas";
import { signCallPayload, buildCallTimestamps } from "../signing/hmac";

// ---------------------------------------------------------------------------
// iOS APNs VoIP Push payload
// ---------------------------------------------------------------------------

/**
 * 着信通知用 APNs VoIP payload を組み立てる。
 *
 * docs/notification-detail.md §1 / §3 に記載の形式に厳密に従う:
 * - aps は空オブジェクト
 * - trancall.type = "incoming_call"
 * - uuid / callerId / issuedAt / expiresAt / signature を含む
 * - signature は §3.2 canonical string に従った HMAC-SHA256 hex
 *
 * @param notification - 着信通知データ（uuid / callerId を含む）
 * @param hmacSecret - TRANCALL_PUSH_HMAC_SECRET
 * @param now - issuedAt の基準時刻（省略時は現在時刻）
 */
export function buildApnsIncomingCallPayload(
  notification: IncomingCallNotification,
  hmacSecret: string,
  now: Date = new Date(),
): ApnsVoipPayload {
  const { issuedAt, expiresAt } = buildCallTimestamps(now);

  const signable = {
    type: "incoming_call",
    uuid: notification.uuid,
    roomId: notification.roomId,
    callerId: notification.callerId,
    callerTrancallId: notification.callerTrancallId,
    issuedAt,
    expiresAt,
  };

  const signature = signCallPayload(signable, hmacSecret);

  return {
    aps: {},
    trancall: {
      type: "incoming_call",
      uuid: notification.uuid,
      roomId: notification.roomId,
      callerId: notification.callerId,
      callerName: notification.callerName,
      callerAvatarUrl: notification.callerAvatarUrl,
      callerTrancallId: notification.callerTrancallId,
      roomType: notification.roomType,
      translationEnabled: notification.translationEnabled,
      languagePair: notification.languagePair,
      callerLanguage: notification.callerLanguage,
      timestamp: notification.timestamp,
      issuedAt,
      expiresAt,
      signature,
    },
  };
}

/**
 * 不在着信通知用 APNs payload を組み立てる。
 * 通常通知として notification + data を両方含む形式。
 * 不在着信通知には HMAC 署名を付けない（docs/notification-detail.md §4 参照）。
 */
export function buildApnsMissedCallPayload(missed: MissedCallPayload): Record<string, unknown> {
  return {
    aps: {
      alert: {
        title: "Missed call",
        body: `${missed.callerName} (${missed.callerTrancallId})`,
      },
      "content-available": 1,
    },
    trancall: {
      type: "missed_call",
      roomId: missed.roomId,
      callerName: missed.callerName,
      callerTrancallId: missed.callerTrancallId,
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
 * uuid / callerId / issuedAt / expiresAt / signature を含む。
 *
 * @param notification - 着信通知データ（uuid / callerId を含む）
 * @param hmacSecret - TRANCALL_PUSH_HMAC_SECRET
 * @param now - issuedAt の基準時刻（省略時は現在時刻）
 */
export function buildFcmIncomingCallPayload(
  notification: IncomingCallNotification,
  hmacSecret: string,
  now: Date = new Date(),
): FcmDataPayload {
  const { issuedAt, expiresAt } = buildCallTimestamps(now);

  const signable = {
    type: "incoming_call",
    uuid: notification.uuid,
    roomId: notification.roomId,
    callerId: notification.callerId,
    callerTrancallId: notification.callerTrancallId,
    issuedAt,
    expiresAt,
  };

  const signature = signCallPayload(signable, hmacSecret);

  return {
    type: "incoming_call",
    uuid: notification.uuid,
    roomId: notification.roomId,
    callerId: notification.callerId,
    callerName: notification.callerName,
    callerAvatarUrl: notification.callerAvatarUrl,
    callerTrancallId: notification.callerTrancallId,
    roomType: notification.roomType,
    translationEnabled: String(notification.translationEnabled),
    languagePair: notification.languagePair,
    callerLanguage: notification.callerLanguage,
    timestamp: notification.timestamp,
    issuedAt,
    expiresAt,
    signature,
  };
}

/**
 * 不在着信通知用 FCM data payload を組み立てる。
 * 不在着信通知には HMAC 署名を付けない（docs/notification-detail.md §4 参照）。
 */
export function buildFcmMissedCallPayload(missed: MissedCallPayload): FcmDataPayload {
  return {
    type: "missed_call",
    roomId: missed.roomId,
    callerName: missed.callerName,
    callerTrancallId: missed.callerTrancallId,
    callerAvatarUrl: missed.callerAvatarUrl,
    timestamp: missed.timestamp,
  };
}
