/**
 * APNs/FCM payload HMAC-SHA256 署名
 *
 * docs/notification-detail.md §3.2 §3.3 に厳密に従う。
 *
 * canonical string の組み立て:
 *   type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
 *
 * 計算式:
 *   HMAC-SHA256(key = TRANCALL_PUSH_HMAC_SECRET, message = canonical)
 *     .digest("hex")   // 小文字 64 文字
 *
 * Node 標準 crypto のみ使用する。
 */

import { createHmac } from "node:crypto";

/**
 * HMAC-SHA256 署名の対象フィールドを定義する型。
 * 順序は docs/notification-detail.md §3.2 で確定している。
 */
export interface CallPayloadSignable {
  /** incoming_call 固定 */
  type: string;
  /** CallKit 用 UUID（小文字 hex、roomId とは独立） */
  uuid: string;
  /** LiveKit room 識別子 */
  roomId: string;
  /** 発信者の内部ユーザー ID */
  callerId: string;
  /** 発信者の TranCall ID */
  callerTrancallId: string;
  /** 発行時刻（ISO8601 .000Z 形式） */
  issuedAt: string;
  /** 有効期限（ISO8601 .000Z 形式、30 秒 TTL） */
  expiresAt: string;
}

/**
 * canonical string を組み立てる（docs/notification-detail.md §3.2）。
 *
 * フィールド順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
 * 値はプレーン文字列（JSON エンコード前）、UUID は小文字 hex、datetime は ISO8601 .000Z 形式。
 */
export function buildCanonicalString(payload: CallPayloadSignable): string {
  return [
    payload.type,
    payload.uuid,
    payload.roomId,
    payload.callerId,
    payload.callerTrancallId,
    payload.issuedAt,
    payload.expiresAt,
  ].join("|");
}

/**
 * payload に HMAC-SHA256 署名を付与する（docs/notification-detail.md §3.3）。
 *
 * @param payload - 署名対象フィールドを含むオブジェクト
 * @param secret - 環境変数 TRANCALL_PUSH_HMAC_SECRET（32 文字以上推奨）
 * @returns 小文字 hex 文字列 64 文字（HMAC-SHA256 digest）
 */
export function signCallPayload(payload: CallPayloadSignable, secret: string): string {
  const canonical = buildCanonicalString(payload);
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

/**
 * 着信通知用の issuedAt / expiresAt を生成する。
 *
 * docs/notification-detail.md §1 仕様: 30 秒 TTL
 * 値は ISO8601 `.000Z` 形式で返す。
 */
export function buildCallTimestamps(now: Date = new Date()): {
  issuedAt: string;
  expiresAt: string;
} {
  const issuedAt = toIso8601WithMs(now);
  const expiresAt = toIso8601WithMs(new Date(now.getTime() + 30_000));
  return { issuedAt, expiresAt };
}

/**
 * Date を ISO8601 `.000Z` 形式に変換する。
 * ex: "2026-05-11T10:00:00.000Z"
 */
function toIso8601WithMs(date: Date): string {
  return date.toISOString();
}
