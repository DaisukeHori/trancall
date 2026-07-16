/**
 * apns-adapter ESM 実行時スモークテスト (Issue #77 回帰防止)
 *
 * packages/notification は "type": "module" (ESM) の実 Node.js ランタイムで
 * 実行される。かつて apns-adapter.ts はモジュールトップレベルで
 * `require("@parse/node-apn")` を使っており、vitest (CJS 変換を挟む) や
 * apps/mock-server 経由のテストでは検出できないまま、実 Node ESM ランタイム
 * (`node dist/index.js`) でのみ `ReferenceError: require is not defined in
 * ES module scope` によりクラッシュしていた。
 *
 * この事象は vitest の transform を経由すると再現しないため、ビルド済み
 * dist/adapters/apns-adapter.js を **別プロセスの実 Node ESM ランタイム**で
 * 直接 import することで検証する。
 *
 * turbo.json の test タスクは build に依存するため、このテスト実行時点で
 * dist/ は既に生成済みであることが保証される。
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distAdapterPath = join(__dirname, "..", "dist", "adapters", "apns-adapter.js");

describe("apns-adapter — 実 Node ESM ランタイムでの import (Issue #77 回帰防止)", () => {
  it("ビルド済み dist/adapters/apns-adapter.js を実 Node ESM で import してもクラッシュしない", () => {
    const distAdapterUrl = pathToFileURL(distAdapterPath).href;
    const script = `
      import("${distAdapterUrl}")
        .then((mod) => {
          if (typeof mod.createApnsAdapter !== "function") {
            throw new Error("createApnsAdapter export not found");
          }
          console.log("ESM_IMPORT_OK");
        })
        .catch((e) => {
          console.error("ESM_IMPORT_FAILED:", e.message);
          process.exit(1);
        });
    `;

    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
    });

    expect(output).toContain("ESM_IMPORT_OK");
  });
});
