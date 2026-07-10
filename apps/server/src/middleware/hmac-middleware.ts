/**
 * HMAC 検証ミドルウェア
 *
 * Agent → Server の内部 API 向け HMAC-SHA256 署名検証。
 * docs/module-contracts.md Section 7.2 に従う。
 *
 * Signature 計算: HMAC-SHA256(secret, body + "|" + idempotencyKey + "|" + timestamp)
 *
 * 確定#4 (2026-07 敵対的レビュー): 旧実装は `x-trancall-timestamp` をリプレイ攻撃防止の
 * 鮮度チェックにのみ使い、HMAC 署名の計算対象には含めていなかった。そのため
 * signature はそのままに timestamp ヘッダーだけを「現在時刻」に書き換えたリクエストが
 * 有効な署名として通ってしまい、鮮度チェック自体が無意味化していた
 * (timestamp 自体が改竄可能だったため)。本修正で timestamp を署名対象に含め、
 * 併せてヘッダーを必須化した (旧実装は Agent 未対応を理由に任意ヘッダー・後方互換
 * スキップを許していたが、それ自体が「timestamp ヘッダーを送らなければ検証を
 * 無効化できる」抜け道になっていたため廃止)。
 *
 * 重要: apps/translation-agent/src/internal-api-client.ts の署名生成
 * (`sign(body, idempotencyKey, timestamp)`) も同じ canonical string で計算するよう
 * 同時に更新済み。Server 側だけを変更すると Agent → Server の全リクエストが
 * 401 になるため、両側は必ずペアで変更すること。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Config } from "../config.js";

/**
 * リプレイ攻撃防止のタイムスタンプ許容ウィンドウ (docs/security-detail.md §2 準拠、5分)。
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export function verifyHmac(
  config: Config,
  body: string,
  signature: string,
  idempotencyKey: string,
  timestamp: string,
): boolean {
  const expected = createHmac("sha256", config.TRANCALL_AGENT_HMAC_SECRET)
    .update(body + "|" + idempotencyKey + "|" + timestamp)
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
    const timestampHeader = request.headers["x-trancall-timestamp"];

    // 確定#4: timestamp は署名対象に含まれるため必須ヘッダーとする。
    if (
      typeof signature !== "string" ||
      typeof idempotencyKey !== "string" ||
      typeof timestampHeader !== "string"
    ) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "HMAC シグネチャ・タイムスタンプヘッダーが必要です",
          retryable: false,
        },
      });
    }

    // #25: JSON.stringify(request.body) による再シリアライズは、キー順序や空白等の差異で
    // 送信時のバイト列と一致しない場合があり、正当なリクエストが誤って 401 になり得る。
    // raw-body-parser.ts (app.ts で登録) が保持した受信時そのままの文字列を検証に使う。
    const rawBody = request.rawBody;
    const valid = verifyHmac(config, rawBody, signature, idempotencyKey, timestampHeader);

    if (!valid) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "HMAC シグネチャが不正です", retryable: false },
      });
    }

    // タイムスタンプ検証 (リプレイ攻撃防止)。signature 検証を通過した後段のため、
    // ここで見ている timestampHeader は署名に含まれていた値そのもの (改竄されていれば
    // 上の verifyHmac で既に 401 になっている)。
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

    // #25 残課題 (TODO): idempotencyKey 単位でのリクエスト自体の重複排除 (nonce store) は
    // 未実装。現状は event type ごとの DB UNIQUE 制約
    // (module-contracts.md §7.3: translation_sessions.agent_job_id /
    //  transcript.segments UNIQUE(room_id, participant_id, sequence_no)) が
    // 事実上の冪等性を担保しているが、有効なタイムスタンプウィンドウ内での
    // signature 再送そのもの (replay) を専用に拒否するストアはまだない。
    // 追加するには新規テーブル (supabase migrations) が必要なため、本 PR のスコープ外とする。
  };
}
