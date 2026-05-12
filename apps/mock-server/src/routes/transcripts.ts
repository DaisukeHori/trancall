import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Router, Request, Response } from "express";
import { getSessionByToken } from "../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requireAuth(req: Request, res: Response): string | null {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
    });
    return null;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: { code: "AUTH_TOKEN_EXPIRED", message: "Token expired or invalid", retryable: false },
    });
    return null;
  }
  return session.userId;
}

const fixtureTranscriptPath = join(
  __dirname,
  "../../..",
  "apps/mobile/e2e/maestro/fixtures/transcript-sample.json",
);

let fixtureTranscript: unknown;

function loadFixtureTranscript(): unknown {
  if (!fixtureTranscript) {
    try {
      const raw = readFileSync(fixtureTranscriptPath, "utf-8");
      fixtureTranscript = JSON.parse(raw);
    } catch {
      fixtureTranscript = { roomId: "unknown", participants: [], segments: [], hasMore: false };
    }
  }
  return fixtureTranscript;
}

export function registerTranscriptRoutes(router: Router): void {
  router.get("/transcripts/:roomId", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({ ok: true, data: loadFixtureTranscript() });
  });

  router.delete("/transcripts/:roomId", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({ ok: true, data: true });
  });
}
