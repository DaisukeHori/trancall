// apps/server/api/index.ts (Sprint 3 新規)
import serverless from "serverless-http";
import type { Handler } from "serverless-http";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { buildContainer } from "../src/container.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// Vercel Serverless Function のコールドスタート対策: 同一インスタンス内でアプリをキャッシュ
let cachedHandler: Handler | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cachedHandler) {
    const config = loadConfig();
    const container = buildContainer(config);
    const app = await buildApp(container, config);
    // serverless-http は内部で app に handle プロパティがあれば使用する
    // Fastify v4 は handle メソッドを持たないが、app.server (http.Server) を
    // Node.js の request リスナーとして使うラッパー関数を渡す
    const requestListener = (reqIn: IncomingMessage, resOut: ServerResponse) => {
      app.server.emit("request", reqIn, resOut);
    };
    cachedHandler = serverless(requestListener);
  }
  return await cachedHandler(req, res);
}

// vercel.json `functions[].runtime` で nodejs20.x 指定済のため
// この config export は不要 (Node.js runtime がデフォルト)
