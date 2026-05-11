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
  NOTIFICATION_DEVICE_TOKEN_INVALID: 400,
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
  CONTACT_USER_BLOCKED: 403,
  ROOM_USER_BLOCKED: 403,
  FORBIDDEN: 403,
  // 404
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  CONTACT_NOT_FOUND: 404,
  TRANSLATION_SESSION_NOT_FOUND: 404,
  // 409
  CONFLICT: 409,
  ROOM_FULL: 409,
  CONTACT_ALREADY_EXISTS: 409,
  // 410
  ROOM_ALREADY_ENDED: 410,
  // 429
  RATE_LIMITED: 429,
  TRANSLATION_RATE_LIMITED: 429,
  // 451
  TRANSLATION_SAFETY_STOP: 451,
  // 500
  INTERNAL_ERROR: 500,
  // 501
  TRANSCRIPT_EXPORT_NOT_IMPLEMENTED: 501,
  // 502
  TRANSLATION_PROVIDER_ERROR: 502,
  NOTIFICATION_PUSH_DELIVERY_FAILED: 502,
  // 503
  TRANSLATION_SESSION_LIMIT: 503,
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
