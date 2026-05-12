#!/usr/bin/env node
/**
 * quality-qa/index.ts — エントリポイント
 *
 * 使用方法:
 *   pnpm --filter @trancall/cron quality-qa
 *   pnpm --filter @trancall/cron quality-qa --scenario S1 --source ja --target en
 *   pnpm --filter @trancall/cron quality-qa --all
 *   QA_MOCK=true pnpm --filter @trancall/cron quality-qa --all
 *
 * オプション:
 *   --scenario <S1|S2|S3|S4|S5>   実行するシナリオ (省略時: 全シナリオ)
 *   --source   <ja|en|zh|ko>       発話言語 (省略時: 全言語)
 *   --target   <en|es|...>         翻訳先言語 (省略時: 全言語)
 *   --all                          全 65 ケースを実行
 *   --output   <dir>               結果出力ディレクトリ (デフォルト: docs/audit-reports/)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateEvaluatorSheet,
  loadGoogleSheetsConfig,
} from "./evaluator-sheet.js";
import {
  loadAllFixtures,
  loadRunnerConfig,
  runScenario,
  saveRunResults,
} from "./runner.js";
import type { QARunResult } from "./schemas.js";
import type { ScenarioFixture } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI argument parser ─────────────────────────────────────────────────────

interface CliArgs {
  scenario: string | null;
  source: string | null;
  target: string | null;
  all: boolean;
  outputDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenario: null,
    source: null,
    target: null,
    all: false,
    outputDir: join(__dirname, "../../../docs/audit-reports"),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario") {
      args.scenario = argv[++i] ?? null;
    } else if (arg === "--source") {
      args.source = argv[++i] ?? null;
    } else if (arg === "--target") {
      args.target = argv[++i] ?? null;
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--output") {
      args.outputDir = argv[++i] ?? args.outputDir;
    }
  }

  return args;
}

// ─── Fixture filter ──────────────────────────────────────────────────────────

function filterFixtures(
  fixtures: ScenarioFixture[],
  args: CliArgs
): ScenarioFixture[] {
  return fixtures.filter((f) => {
    if (args.scenario && f.scenario !== args.scenario) return false;
    if (args.source && f.source_lang !== args.source) return false;
    if (args.target && f.target_lang !== args.target) return false;
    return true;
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadRunnerConfig();

  const scenariosDir = join(__dirname, "scenarios");
  const allFixtures = loadAllFixtures(scenariosDir);
  console.log(`[quality-qa] Loaded ${allFixtures.length} scenario fixtures`);

  const selectedFixtures =
    args.all ||
    (!args.scenario && !args.source && !args.target)
      ? allFixtures
      : filterFixtures(allFixtures, args);

  if (selectedFixtures.length === 0) {
    console.error("[quality-qa] No fixtures matched the given filters");
    process.exit(1);
  }

  console.log(
    `[quality-qa] Running ${selectedFixtures.length} scenarios in ${config.mockMode ? "MOCK" : "LIVE"} mode`
  );

  const results: QARunResult[] = [];

  for (const fixture of selectedFixtures) {
    console.log(
      `\n[quality-qa] Running ${fixture.scenario_id} (${fixture.source_lang}→${fixture.target_lang})`
    );
    const result = await runScenario(fixture, config);
    results.push(result);
  }

  // DB 保存
  await saveRunResults(results, config);

  // 評価者シート生成
  const runDate = new Date().toISOString().slice(0, 10);
  const googleSheetsConfig = loadGoogleSheetsConfig();

  await generateEvaluatorSheet(results, selectedFixtures, {
    outputDir: args.outputDir,
    runDate,
    googleSheetsConfig,
  });

  console.log(
    `\n[quality-qa] Completed. Results: ${results.length} runs, output: ${args.outputDir}`
  );
}

main().catch((err: unknown) => {
  console.error("[quality-qa] Fatal error:", err);
  process.exit(1);
});
