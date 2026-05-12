// Vercel Serverless Function entrypoint (monorepo root).
// Re-exports the canonical handler from apps/server/api/index.ts.
// This indirection is required because Vercel detects serverless functions
// only in the repository root `api/` directory, while the actual implementation
// lives in apps/server/api/index.ts (per docs/production-runbook.md §3.1).

export { default } from "../apps/server/api/index.js";
