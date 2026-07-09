/**
 * JSON リクエストの生ボディ (rawBody) 保持パーサー
 *
 * #25 対応:
 * - `hmac-middleware.ts` は従来 `JSON.stringify(request.body)` で HMAC 署名検証用の
 *   ボディ文字列を再構築していたが、これは受信した生バイト列と一致する保証がない
 *   (キー順序の非決定性、数値表現の正規化、空白の欠落等)。再シリアライズが原の
 *   バイト列と食い違うと、正当な Agent リクエストが誤って 401 になり得る。
 * - `#39 Stripe Webhook`（別担当 W2c）も同様に「受信した生バイト列」を署名検証に使う
 *   必要がある。
 *
 * 実装方針:
 * `fastify-raw-body` 等の外部パッケージを追加せず、Fastify 標準の
 * `addContentTypeParser` で `application/json` を `parseAs: "string"` で受け取り、
 * パース前の文字列をそのまま `request.rawBody` に保持してから `JSON.parse` する。
 * これにより `request.body` の挙動（パース済み JSON オブジェクト）は一切変えず、
 * 全 JSON リクエストで `request.rawBody: string`（受信時そのままの文字列）を
 * 参照できるようになる。対象を特定ルートに絞らず全 JSON リクエストに適用することで、
 * #25 (Agent HMAC) と #39 (Stripe Webhook) の両方から共通利用できるようにする。
 */
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** 受信した生の JSON リクエストボディ文字列（署名検証用、未受信時は空文字） */
    rawBody: string;
  }
}

/**
 * JSON.parse に失敗した際に投げるエラー。
 * Fastify 標準の JSON パーサーと同様に `statusCode = 400` を持たせることで、
 * `error-handler.ts` の `"statusCode" in error && error.statusCode === 400` 分岐に
 * 乗り、VALIDATION_ERROR (400) として返る（型アサーションを使わずに済ませるため
 * plain Error ではなくこの専用クラスを使う）。
 */
class InvalidJsonBodyError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

export function registerRawBodyParser(fastify: FastifyInstance): void {
  fastify.decorateRequest("rawBody", "");

  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, bodyInput, done) => {
      // `parseAs: "string"` 指定時、実行時は常に string だが Fastify の型定義は
      // `string | Buffer` のままのため、型アサーションを使わず typeof で narrow する。
      const body = typeof bodyInput === "string" ? bodyInput : bodyInput.toString("utf8");
      request.rawBody = body;

      if (body.length === 0) {
        done(null, undefined);
        return;
      }

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        done(new InvalidJsonBodyError("リクエストボディが有効な JSON ではありません"), undefined);
        return;
      }
      done(null, json);
    },
  );
}
