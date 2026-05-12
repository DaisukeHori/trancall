// apps/server/api/index.ts (Sprint 3 新規)
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { buildContainer } from "../src/container.js";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

// Vercel Serverless Function のコールドスタート対策: 同一インスタンス内でアプリをキャッシュ
// Vercel Node.js runtime は (req: IncomingMessage, res: ServerResponse) を直接受け取る形式のため、
// serverless-http (Lambda/API Gateway 専用) は使用しない。
// Fastify の app.ready() + app.server.emit('request', req, res) で直接処理する。
let cachedApp: FastifyInstance | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cachedApp) {
    const config = loadConfig();
    const container = buildContainer(config);
    cachedApp = await buildApp(container, config);
    await cachedApp.ready();
  }
  cachedApp.server.emit("request", req, res);
}

// vercel.json `functions[].runtime` で nodejs20.x 指定済のため
// この config export は不要 (Node.js runtime がデフォルト)
