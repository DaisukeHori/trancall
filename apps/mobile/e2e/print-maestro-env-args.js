#!/usr/bin/env node
/**
 * apps/mobile/e2e/maestro/env.json (テキスト/フィクスチャ変数の正本) を読み、
 * `maestro test` に渡す `-e KEY='VALUE'` 引数列を1行で標準出力する。
 *
 * 背景: Maestro のワークスペース設定ファイル (config.yaml) はトップレベルの
 * `env:` ブロックをサポートしていない (公式ドキュメント
 * https://docs.maestro.dev/reference/workspace-configuration に env プロパティの
 * 記載なし、実測でも全フローが `${T_xxx}` を解決できず "undefined" になることを
 * PR #75 CI で確認済み)。公式にドキュメントされている唯一の一括適用手段は
 * `maestro test` の `-e KEY=VALUE` フラグ (`--env` の繰り返し指定) のみ
 * (https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options)。
 * 45個近い変数を workflow 内に直書きすると重複・ドリフトの温床になるため、
 * このスクリプトで env.json から都度生成する。
 */
const path = require("node:path");

const envPath = path.join(__dirname, "maestro", "env.json");
const env = require(envPath);

const args = Object.entries(env)
  .map(([key, value]) => {
    const escaped = String(value).replace(/'/g, "'\\''");
    return `-e '${key}=${escaped}'`;
  })
  .join(" ");

process.stdout.write(args);
