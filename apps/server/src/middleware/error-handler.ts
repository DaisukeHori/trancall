/**
 * エラーハンドラー
 *
 * AppError の code を HTTP status code にマッピングして返す。
 * docs/module-contracts.md Section 5 に従う。
 */

import type { FastifyInstance, FastifyError } from "fastify";
import type { AppError } from "@trancall/shared-kernel";
import { logger } from "../logger.js";

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  // 400
  VALIDATION_ERROR: 400,
  CONTACT_SELF_ADD: 400,
  BILLING_INVALID_RECEIPT: 400,
  BILLING_CHANNEL_NOT_AVAILABLE: 400,
  BILLING_IAP_RECEIPT_INVALID: 400,
  BILLING_INVALID_PLAN_CHANGE: 400,
  NOTIFICATION_DEVICE_TOKEN_INVALID: 400,
  // media.token.invalid_request: media facade の Zod バリデーション失敗 (クライアント起因)
  "media.token.invalid_request": 400,
  // ACCOUNT_NOT_DELETED: #27 POST /api/account/restore — 退会リクエストなしで restore を呼んだ
  ACCOUNT_NOT_DELETED: 400,
  // 401
  UNAUTHORIZED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_EXPIRED: 401,
  // 402
  BILLING_INSUFFICIENT_BALANCE: 402,
  BILLING_SUBSCRIPTION_EXPIRED: 402,
  BILLING_PAYMENT_FAILED: 402,
  // 403
  AUTH_EMAIL_NOT_VERIFIED: 403,
  AUTH_CONSENT_REQUIRED: 403,
  AUTH_CONSENT_REVOKED: 403,
  CONTACT_USER_BLOCKED: 403,
  ROOM_USER_BLOCKED: 403,
  // 確定#2: 招待されていないユーザーの POST /api/rooms/:id/join を拒否する際に使う
  ROOM_USER_NOT_INVITED: 403,
  FORBIDDEN: 403,
  TRANSCRIPT_EXPORT_FORBIDDEN: 403,
  // 404
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  CONTACT_NOT_FOUND: 404,
  TRANSLATION_SESSION_NOT_FOUND: 404,
  // 409
  CONFLICT: 409,
  ROOM_FULL: 409,
  CONTACT_ALREADY_EXISTS: 409,
  AUTH_CONSENT_VERSION_MISMATCH: 409,
  // 410
  ROOM_ALREADY_ENDED: 410,
  // ACCOUNT_GRACE_PERIOD_EXPIRED: #27 POST /api/account/restore — 30日の猶予期間超過
  ACCOUNT_GRACE_PERIOD_EXPIRED: 410,
  // 422
  AUTH_CONSENT_IRREVOCABLE: 422,
  TRANSCRIPT_EXPORT_EMPTY: 422,
  SUPPORT_INVALID_BODY: 422,
  // TRANSCRIPT_EXPORT_TOO_LARGE: transcript facade (packages/transcript/src/facade.ts) は
  // httpStatus: 422 を埋め込んで返すため、それに合わせる (旧 507 は facade の実値と不一致だった)
  TRANSCRIPT_EXPORT_TOO_LARGE: 422,
  // 429
  RATE_LIMITED: 429,
  TRANSLATION_RATE_LIMITED: 429,
  SUPPORT_RATE_LIMIT_EXCEEDED: 429,
  BILLING_RATE_LIMITED: 429,
  // 451
  TRANSLATION_SAFETY_STOP: 451,
  // 500
  INTERNAL_ERROR: 500,
  // ROOM_CREATE_FAILED: rooms/participants INSERT 失敗 (DB 内部エラー)
  ROOM_CREATE_FAILED: 500,
  // media.token.*: profile lookup / metadata 構築 / JWT 署名の内部処理失敗 (クライアント起因ではない)
  "media.token.profile_lookup_failed": 500,
  "media.token.metadata_invalid": 500,
  "media.token.jwt_sign_failed": 500,
  // #34: consentRepo/legalDocRepo が DI されていない場合 (packages/auth/src/facade.ts)
  AUTH_CONSENT_NOT_CONFIGURED: 500,
  // Issue #72.1: profileWriteRepo が DI されていない場合 (packages/auth/src/facade.ts)
  AUTH_PROFILE_WRITE_NOT_CONFIGURED: 500,
  // #34: プロフィールデータが DB から取得後の再バリデーションに失敗 (packages/auth/src/facade.ts:244)
  // 命名規則 (SCREAMING_SNAKE_CASE) 違反だが既存コードとの後方互換のため据え置き、map 登録のみ行う
  "auth.profile.invalid_schema": 500,
  // 501
  TRANSCRIPT_EXPORT_NOT_IMPLEMENTED: 501,
  BILLING_NOT_IMPLEMENTED: 501,
  AUTH_NOT_IMPLEMENTED: 501,
  // 502
  TRANSLATION_PROVIDER_ERROR: 502,
  NOTIFICATION_PUSH_DELIVERY_FAILED: 502,
  // ROOM_MEDIA_CREATE_FAILED / media.room.*: LiveKit (外部サービス) 呼び出し失敗
  ROOM_MEDIA_CREATE_FAILED: 502,
  "media.room.create_failed": 502,
  "media.room.delete_failed": 502,
  // 503
  TRANSLATION_SESSION_LIMIT: 503,
  SUPPORT_MAIL_SEND_FAILED: 503,
  AUTH_LEGAL_DOC_UNAVAILABLE: 503,
  BILLING_UPGRADE_PREVIEW_FAILED: 503,
};

export function getHttpStatus(code: string): number {
  return ERROR_CODE_TO_STATUS[code] ?? 500;
}

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(
    (error: FastifyError | Error, _request, reply) => {
      // Fastify バリデーションエラー
      if ("statusCode" in error && error.statusCode === 400) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: error.message,
            retryable: false,
          },
        });
      }

      logger.error("unhandled error", {
        message: error.message,
        stack: error.stack,
      });

      return reply.status(500).send({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "内部エラーが発生しました",
          retryable: true,
        },
      });
    },
  );
}

/**
 * AppError を HTTP レスポンスとして送信するヘルパー
 */
export function sendAppError(
  reply: import("fastify").FastifyReply,
  error: AppError,
): void {
  const status = getHttpStatus(error.code);
  void reply.status(status).send({ ok: false, error });
}
