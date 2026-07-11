/**
 * correlation_id ミドルウェア (L-15)
 *
 * docs/deployment-render-dryrun.md §11.4 準拠:
 * 1. リクエストの `x-correlation-id` ヘッダーがあれば再利用、なければ新規 UUID v4 を生成する
 * 2. `request.correlationId` に格納する (他ミドルウェア/ルートハンドラから参照可能)
 * 3. `logger.ts` の AsyncLocalStorage コンテキストに入れ、このリクエスト処理中に呼ばれる
 *    `logger.*()` すべてが自動的に correlation_id を含めるようにする
 * 4. レスポンスヘッダー `x-correlation-id` にも同じ値を返し、クライアント側 (mobile) が
 *    ログとの突き合わせに使えるようにする
 *
 * `onRequest` フックは Fastify のリクエストごとの非同期実行チェーンの起点であるため、
 * ここで `enterCorrelationId()` (AsyncLocalStorage.enterWith) を呼べば、以降の
 * preHandler/handler/onSend まで同じコンテキストが継続する。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { enterCorrelationId } from "../logger.js";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

const CORRELATION_ID_HEADER = "x-correlation-id";

/** ヘッダー由来の correlation_id が明らかに不正 (異常に長い等) な場合は使わず新規生成する */
const MAX_INCOMING_CORRELATION_ID_LENGTH = 128;

export function registerCorrelationIdMiddleware(fastify: FastifyInstance): void {
  fastify.decorateRequest("correlationId", "");

  fastify.addHook("onRequest", (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const incoming = request.headers[CORRELATION_ID_HEADER];
    const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId =
      incomingValue != null &&
      incomingValue.length > 0 &&
      incomingValue.length <= MAX_INCOMING_CORRELATION_ID_LENGTH
        ? incomingValue
        : randomUUID();

    request.correlationId = correlationId;
    enterCorrelationId(correlationId);
    void reply.header(CORRELATION_ID_HEADER, correlationId);
    done();
  });
}
