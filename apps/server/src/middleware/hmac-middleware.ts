/**
 * HMAC 検証ミドルウェア
 *
 * Agent → Server の内部 API 向け HMAC-SHA256 署名検証。
 * docs/module-contracts.md Section 7.2 に従う。
 *
 * Signature 計算: HMAC-SHA256(secret, body + "|" + idempotencyKey)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Config } from "../config.js";

export function verifyHmac(
  config: Config,
  body: string,
  signature: string,
  idempotencyKey: string,
): boolean {
  const expected = createHmac("sha256", config.TRANCALL_AGENT_HMAC_SECRET)
    .update(body + "|" + idempotencyKey)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");

  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export function createHmacPreHandler(config: Config) {
  return async function hmacPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const signature = request.headers["x-trancall-signature"];
    const idempotencyKey = request.headers["x-trancall-idempotency-key"];

    if (
      typeof signature !== "string" ||
      typeof idempotencyKey !== "string"
    ) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "HMAC シグネチャが必要です", retryable: false },
      });
    }

    const rawBody = JSON.stringify(request.body);
    const valid = verifyHmac(config, rawBody, signature, idempotencyKey);

    if (!valid) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "HMAC シグネチャが不正です", retryable: false },
      });
    }
  };
}
