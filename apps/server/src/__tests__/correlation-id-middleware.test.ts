/**
 * correlation-id-middleware テスト (L-15)
 *
 * docs/deployment-render-dryrun.md §11.4 準拠。
 */
import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { registerCorrelationIdMiddleware } from "../middleware/correlation-id-middleware.js";
import { getCorrelationId } from "../logger.js";

function buildMinimalApp() {
  const fastify = Fastify({ logger: false });
  registerCorrelationIdMiddleware(fastify);

  let observedDuringHandler: string | undefined;
  fastify.get("/probe", async (request) => {
    // ハンドラ内で AsyncLocalStorage 経由の correlation_id が取得できることを確認する
    observedDuringHandler = getCorrelationId();
    return { correlationId: request.correlationId };
  });

  return { fastify, getObserved: () => observedDuringHandler };
}

describe("registerCorrelationIdMiddleware", () => {
  afterEach(() => {
    // enterWith はグローバル AsyncLocalStorage の状態を変更するため、
    // 後続テストへの汚染防止のため明示的に何もしない (各テストが必ず値を上書きするため安全)。
  });

  it("x-correlation-id ヘッダーがない場合、新規 UUID を生成して response header に返す", async () => {
    const { fastify } = buildMinimalApp();
    const response = await fastify.inject({ method: "GET", url: "/probe" });

    expect(response.statusCode).toBe(200);
    const header = response.headers["x-correlation-id"];
    expect(typeof header).toBe("string");
    expect(header).toMatch(/^[0-9a-f-]{36}$/i);

    const body = JSON.parse(response.body) as { correlationId: string };
    expect(body.correlationId).toBe(header);
  });

  it("x-correlation-id ヘッダーがある場合、その値をそのまま再利用する", async () => {
    const { fastify } = buildMinimalApp();
    const response = await fastify.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-correlation-id": "client-generated-id-123" },
    });

    expect(response.headers["x-correlation-id"]).toBe("client-generated-id-123");
    const body = JSON.parse(response.body) as { correlationId: string };
    expect(body.correlationId).toBe("client-generated-id-123");
  });

  it("異常に長い x-correlation-id ヘッダーは無視し新規 UUID を生成する", async () => {
    const { fastify } = buildMinimalApp();
    const tooLong = "a".repeat(200);
    const response = await fastify.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-correlation-id": tooLong },
    });

    expect(response.headers["x-correlation-id"]).not.toBe(tooLong);
    expect(response.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("request.correlationId はルートハンドラ内から参照でき、logger の AsyncLocalStorage コンテキストにも伝搬している", async () => {
    const { fastify, getObserved } = buildMinimalApp();
    const response = await fastify.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-correlation-id": "trace-42" },
    });

    expect(response.statusCode).toBe(200);
    expect(getObserved()).toBe("trace-42");
  });

  it("リクエストごとに異なる correlation_id が生成される (ヘッダー未指定時)", async () => {
    const { fastify } = buildMinimalApp();
    const r1 = await fastify.inject({ method: "GET", url: "/probe" });
    const r2 = await fastify.inject({ method: "GET", url: "/probe" });

    expect(r1.headers["x-correlation-id"]).not.toBe(r2.headers["x-correlation-id"]);
  });
});
