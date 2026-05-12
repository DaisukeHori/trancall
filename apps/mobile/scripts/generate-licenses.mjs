#!/usr/bin/env node
/**
 * generate-licenses.mjs
 *
 * license-checker-rseidelsohn で production 依存の OSS ライセンス情報を収集し、
 * src/assets/licenses.json に書き出す。
 *
 * - ローカル絶対パス (path / licenseFile) はバンドルに含めず除去する
 * - @trancall/* 内部パッケージは除外 (--excludePrivatePackages 相当)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "src", "assets", "licenses.json");

const rawJson = execSync(
  "node_modules/.bin/license-checker-rseidelsohn --production --json --excludePrivatePackages",
  { cwd: rootDir, encoding: "utf-8" },
);

/** @type {Record<string, { licenses: string; repository?: string; publisher?: string; email?: string; description?: string; licenseText?: string; path?: string; licenseFile?: string }>} */
const raw = JSON.parse(rawJson);

/** @type {Record<string, { licenses: string; repository?: string; publisher?: string; email?: string; description?: string; licenseText?: string }>} */
const cleaned = {};

for (const [packageName, entry] of Object.entries(raw)) {
  // @trancall/* 内部パッケージは除外
  if (packageName.startsWith("@trancall/")) {
    continue;
  }

  // ローカルパス情報は除去、licenseFile から本文を読み込んで licenseText として埋め込む
  /** @type {{ licenses: string; repository?: string; publisher?: string; email?: string; description?: string; licenseText?: string }} */
  const cleanEntry = {
    licenses: entry.licenses,
  };

  if (entry.repository != null) {
    cleanEntry.repository = entry.repository;
  }
  if (entry.publisher != null) {
    cleanEntry.publisher = entry.publisher;
  }
  if (entry.email != null) {
    cleanEntry.email = entry.email;
  }
  if (entry.description != null) {
    cleanEntry.description = entry.description;
  }

  // licenseFile が存在する場合はテキストを読み込んで埋め込む
  if (entry.licenseFile != null) {
    try {
      const licenseText = fs.readFileSync(
        path.isAbsolute(entry.licenseFile)
          ? entry.licenseFile
          : path.join(rootDir, entry.licenseFile),
        "utf-8",
      );
      cleanEntry.licenseText = licenseText.trim();
    } catch {
      // ライセンスファイルが読めない場合はスキップ
    }
  }

  cleaned[packageName] = cleanEntry;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(cleaned, null, 2) + "\n", "utf-8");

const count = Object.keys(cleaned).length;
console.log(`Generated licenses.json: ${count} packages → ${outputPath}`);
