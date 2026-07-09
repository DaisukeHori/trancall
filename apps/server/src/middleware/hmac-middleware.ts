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
import { logger } from "../logger.js";

/**
 * #25: リプレイ攻撃防止のタイムスタンプ許容ウィンドウ (docs/security-detail.md §2 準拠、5分)。
 * `x-trancall-timestamp` ヘッダー (ISO8601) が付与されている場合のみ検証する。
 * 現行 apps/translation-agent/src/internal-api-client.ts はこのヘッダーを送信していない
 * (Agent 側の追随は本 PR のスコープ外) ため、ヘッダー欠如時は後方互換のためスキップする。
 * TODO: Agent 側がヘッダーを送るようになったら必須化する。
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

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

    // #25: JSON.stringify(request.body) による再シリアライズは、キー順序や空白等の差異で
    // 送信時のバイト列と一致しない場合があり、正当なリクエストが誤って 401 になり得る。
    // raw-body-parser.ts (app.ts で登録) が保持した受信時そのままの文字列を検証に使う。
    const rawBody = request.rawBody;
    const valid = verifyHmac(config, rawBody, signature, idempotencyKey);

    if (!valid) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "HMAC シグネチャが不正です", retryable: false },
      });
    }

    // #25: タイムスタンプ検証（リプレイ攻撃防止、任意ヘッダー、上記コメント参照）
    const timestampHeader = request.headers["x-trancall-timestamp"];
    if (typeof timestampHeader === "string") {
      const ts = Date.parse(timestampHeader);
      if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
        return reply.status(401).send({
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "リクエストのタイムスタンプが無効または期限切れです",
            retryable: false,
          },
        });
      }
    } else {
      logger.debug("hmac: x-trancall-timestamp ヘッダーなし (Agent 未対応、後方互換のためスキップ)", {
        idempotencyKey,
      });
    }

    // #25 残課題 (TODO): idempotencyKey 単位でのリクエスト自体の重複排除は未実装。
    // 現状は event type ごとの DB UNIQUE 制約
    // (module-contracts.md §7.3: translation_sessions.agent_job_id /
    //  transcript.segments UNIQUE(room_id, participant_id, sequence_no)) が
    // 事実上の冪等性を担保しているが、HMAC リクエスト自体の replay
    // (同一シグネチャの再送) を専用に拒否するストアはまだない。
    // 追加するには新規テーブル (supabase migrations) が必要なため、本 PR のスコープ外とする。
  };
}
