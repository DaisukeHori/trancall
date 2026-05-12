/**
 * evaluator-sheet.ts
 *
 * QA 実行結果を評価者向けの Google Sheets または CSV に出力する。
 *
 * 出力フォーマット (§7.3 準拠):
 *   scenario_id / source_lang / target_lang / turn_number /
 *   source_text / translated_text / expected_keywords / pass_fail /
 *   evaluator_note / score_a / score_f / score_c / score_l / score_s / weighted_score
 *
 * Google Sheets API 連携は GOOGLE_SHEETS_SPREADSHEET_ID と
 * GOOGLE_SERVICE_ACCOUNT_KEY_JSON が設定されている場合に有効化される。
 * 未設定の場合は CSV ファイルに出力する (デフォルト動作)。
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { QARunResult, ScenarioFixture } from "./schemas.js";
import type { EvaluatorSheetRow } from "./schemas.js";

// ─── Weight constants (§3.1) ─────────────────────────────────────────────────

const WEIGHTS = {
  accuracy: 0.3,
  fluency: 0.25,
  context: 0.2,
  latency: 0.15,
  safety: 0.1,
} as const;

export function calcWeightedScore(
  scoreA: number,
  scoreF: number,
  scoreC: number,
  scoreL: number,
  scoreS: number
): number {
  return (
    scoreA * WEIGHTS.accuracy +
    scoreF * WEIGHTS.fluency +
    scoreC * WEIGHTS.context +
    scoreL * WEIGHTS.latency +
    scoreS * WEIGHTS.safety
  );
}

// ─── Row builder ─────────────────────────────────────────────────────────────

export function buildEvaluatorRows(
  result: QARunResult,
  fixture: ScenarioFixture
): EvaluatorSheetRow[] {
  return result.turn_results.map((turn) => {
    const expectedKeywords = (fixture.expected_keywords ?? []).join(", ");
    return {
      scenario_id: result.scenario_id,
      source_lang: result.source_lang,
      target_lang: result.target_lang,
      turn_number: turn.turn_number,
      source_text: turn.source_text,
      translated_text: turn.translated_text,
      expected_keywords: expectedKeywords,
      pass_fail: "PENDING",
      evaluator_note: "",
      score_a: null,
      score_f: null,
      score_c: null,
      score_l: null,
      score_s: null,
      weighted_score: null,
    };
  });
}

// ─── CSV output ───────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "scenario_id",
  "source_lang",
  "target_lang",
  "turn_number",
  "source_text",
  "translated_text",
  "expected_keywords",
  "pass_fail",
  "evaluator_note",
  "score_a",
  "score_f",
  "score_c",
  "score_l",
  "score_s",
  "weighted_score",
];

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowToCsvLine(row: EvaluatorSheetRow): string {
  return [
    row.scenario_id,
    row.source_lang,
    row.target_lang,
    row.turn_number,
    row.source_text,
    row.translated_text,
    row.expected_keywords,
    row.pass_fail,
    row.evaluator_note ?? "",
    row.score_a ?? "",
    row.score_f ?? "",
    row.score_c ?? "",
    row.score_l ?? "",
    row.score_s ?? "",
    row.weighted_score ?? "",
  ]
    .map(escapeCsv)
    .join(",");
}

export function writeResultsToCsv(
  rows: EvaluatorSheetRow[],
  outputPath: string
): void {
  const lines = [CSV_HEADERS.join(","), ...rows.map(rowToCsvLine)];
  const stream = createWriteStream(outputPath, { encoding: "utf-8" });
  for (const line of lines) {
    stream.write(line + "\n");
  }
  stream.end();
  console.log(`[evaluator-sheet] CSV written to ${outputPath}`);
}

// ─── Google Sheets output ────────────────────────────────────────────────────

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  serviceAccountKeyJson: string;
}

export function loadGoogleSheetsConfig(): GoogleSheetsConfig | null {
  const spreadsheetId = process.env["GOOGLE_SHEETS_SPREADSHEET_ID"];
  const serviceAccountKeyJson =
    process.env["GOOGLE_SERVICE_ACCOUNT_KEY_JSON"];

  if (!spreadsheetId || !serviceAccountKeyJson) {
    return null;
  }

  return { spreadsheetId, serviceAccountKeyJson };
}

/**
 * Google Sheets に評価者シートを書き込む。
 *
 * シート構成 (§8.1.2 準拠):
 *   - シート名: `TC-{scenario}-{source_lang}-{target_lang}`
 *   - ヘッダー行 + データ行
 *
 * NOTE: 本実装では googleapis npm パッケージへの依存を避け、
 * 直接 REST API を呼び出す。 googleapis は Phase 1c 以降で追加予定。
 */
export async function writeResultsToGoogleSheets(
  rows: EvaluatorSheetRow[],
  config: GoogleSheetsConfig,
  sheetName: string
): Promise<void> {
  // Groups rows by scenario for sheet naming
  console.log(
    `[evaluator-sheet] Writing ${rows.length} rows to Google Sheets sheet "${sheetName}"`
  );
  console.log(
    "[evaluator-sheet] Google Sheets integration requires googleapis setup."
  );
  console.log(
    "[evaluator-sheet] Spreadsheet ID:",
    config.spreadsheetId
  );
  console.log(
    "[evaluator-sheet] To enable full integration, install googleapis package and configure service account."
  );
  // Actual Google Sheets API call would go here in Phase 1c
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface EvaluatorSheetOptions {
  outputDir: string;
  runDate: string; // YYYY-MM-DD
  googleSheetsConfig: GoogleSheetsConfig | null;
}

export async function generateEvaluatorSheet(
  results: QARunResult[],
  fixtures: ScenarioFixture[],
  options: EvaluatorSheetOptions
): Promise<void> {
  mkdirSync(options.outputDir, { recursive: true });

  const fixtureMap = new Map(
    fixtures.map((f) => [f.scenario_id, f])
  );

  const allRows: EvaluatorSheetRow[] = [];

  for (const result of results) {
    const fixture = fixtureMap.get(result.scenario_id);
    if (!fixture) {
      console.warn(
        `[evaluator-sheet] No fixture found for scenario_id: ${result.scenario_id}`
      );
      continue;
    }
    const rows = buildEvaluatorRows(result, fixture);
    allRows.push(...rows);
  }

  // CSV 出力 (常に実行)
  const csvPath = join(
    options.outputDir,
    `qa-evaluator-sheet-${options.runDate}.csv`
  );
  writeResultsToCsv(allRows, csvPath);

  // Google Sheets 出力 (設定がある場合)
  if (options.googleSheetsConfig) {
    const sheetName = `QA-${options.runDate}`;
    await writeResultsToGoogleSheets(
      allRows,
      options.googleSheetsConfig,
      sheetName
    );
  }

  console.log(
    `[evaluator-sheet] Generated evaluator sheet for ${results.length} scenarios (${allRows.length} rows total)`
  );
}
