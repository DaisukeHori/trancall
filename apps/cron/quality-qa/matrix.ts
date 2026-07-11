/**
 * matrix.ts — M-12: 翻訳品質 QA 合否判定マトリクス自動生成
 *
 * docs/translation-quality-qa.md §9 (合否判定マトリクス) は現状テンプレート/サンプルの
 * まま(実測 13(14)言語ペアの数値が未記入)。本モジュールは、採点済み evaluator-sheet
 * CSV (§7.3 フォーマット、ネイティブ評価者が score_a/f/c/l/s・weighted_score・pass_fail を
 * 記入した状態) から §9 のマトリクスを自動生成する「仕組み」を提供する。
 *
 * NOTE: 実際の 13(14)言語ペアの QA 判定 (数値を埋める行為そのもの) は、
 * LiveKit/OpenAI 実接続によるライブ収録 (L-3) + ネイティブ評価者によるスコアリングが
 * 必要な運用タスクであり、本モジュール単体では代替できない。ここで揃えるのは
 * 「実測データが揃った後、マトリクスを機械的に生成・網羅チェックする自動化」である。
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseEvaluatorCsv } from "./evaluator-sheet.js";
import type { EvaluatorSheetRow } from "./schemas.js";

// ─── Canonical 言語ペア / シナリオ (fixture-validation.test.ts の
//     EXPECTED_LANG_PAIRS / EXPECTED_SCENARIOS と一致させる canonical ソース) ──────

export const CANONICAL_LANG_PAIRS = [
  "ja-en",
  "ja-es",
  "ja-pt",
  "ja-fr",
  "ja-ru",
  "ja-zh",
  "ja-de",
  "ja-ko",
  "ja-hi",
  "ja-id",
  "ja-vi",
  "ja-it",
  "en-ja",
  "zh-ja",
] as const;

// docs/translation-quality-qa.md §8.2.3 の Phase 1a 主要ペア
export const PHASE_1A_PRIORITY_LANG_PAIRS = [
  "ja-en",
  "en-ja",
  "ja-zh",
  "zh-ja",
] as const;

export const SCENARIO_ORDER = ["S1", "S2", "S3", "S4", "S5"] as const;
export type ScenarioKey = (typeof SCENARIO_ORDER)[number];

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  S1: "S1 日常",
  S2: "S2 商談",
  S3: "S3 旅行",
  S4: "S4 数値",
  S5: "S5 同言語",
};

// ─── 集計 ────────────────────────────────────────────────────────────────────

export interface MatrixCell {
  /** ターン単位 weighted_score の平均 (未実施/未採点なら null) */
  avgScore: number | null;
  /** score_s (安全性) === 1 のターンが 1 件でもあれば true */
  hasSafetyFail: boolean;
  /** 集計対象になったターン数 (weighted_score が入力済みの行数) */
  scoredTurnCount: number;
}

export type Judgement = "PASS" | "CPASS" | "FAIL" | "-";

/**
 * §9.3 判定凡例:
 * PASS: 5 シナリオ平均 >= 3.5、安全性スコア 1 なし
 * CPASS: 平均 3.0-3.49 または軽微な問題あり
 * FAIL: 平均 < 3.0、または安全性スコア 1 が存在
 * -: 未実施
 */
export function judge(avgScore: number | null, hasSafetyFail: boolean): Judgement {
  if (avgScore === null) return "-";
  if (hasSafetyFail) return "FAIL";
  if (avgScore >= 3.5) return "PASS";
  if (avgScore >= 3.0) return "CPASS";
  return "FAIL";
}

/** scenario_id (例: "TC-S2-en" / "TC-S2-zh-ja" / "TC-S2-en-ja") から S1-S5 を抽出する */
export function extractScenarioKey(scenarioId: string): ScenarioKey | null {
  const match = /S([1-5])/.exec(scenarioId);
  if (!match) return null;
  switch (match[1]) {
    case "1":
      return "S1";
    case "2":
      return "S2";
    case "3":
      return "S3";
    case "4":
      return "S4";
    case "5":
      return "S5";
    default:
      return null;
  }
}

export function langPairKey(sourceLang: string, targetLang: string): string {
  return `${sourceLang}-${targetLang}`;
}

/**
 * evaluator-sheet の行群 (ターン単位) を (langPair, scenario) セルごとに集計する。
 */
export function aggregateMatrix(
  rows: readonly EvaluatorSheetRow[]
): Map<string, Map<ScenarioKey, MatrixCell>> {
  interface Bucket {
    scores: number[];
    hasSafetyFail: boolean;
  }

  const grouped = new Map<string, Map<ScenarioKey, Bucket>>();

  for (const row of rows) {
    const scenarioKey = extractScenarioKey(row.scenario_id);
    if (!scenarioKey) continue;

    const pairKey = langPairKey(row.source_lang, row.target_lang);
    if (!grouped.has(pairKey)) {
      grouped.set(pairKey, new Map());
    }
    const pairMap = grouped.get(pairKey);
    if (!pairMap) continue;

    if (!pairMap.has(scenarioKey)) {
      pairMap.set(scenarioKey, { scores: [], hasSafetyFail: false });
    }
    const bucket = pairMap.get(scenarioKey);
    if (!bucket) continue;

    if (typeof row.weighted_score === "number") {
      bucket.scores.push(row.weighted_score);
    }
    if (row.score_s === 1) {
      bucket.hasSafetyFail = true;
    }
  }

  const result = new Map<string, Map<ScenarioKey, MatrixCell>>();
  for (const [pairKey, pairMap] of grouped) {
    const cellMap = new Map<ScenarioKey, MatrixCell>();
    for (const [scenarioKey, bucket] of pairMap) {
      const avgScore =
        bucket.scores.length > 0
          ? bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length
          : null;
      cellMap.set(scenarioKey, {
        avgScore,
        hasSafetyFail: bucket.hasSafetyFail,
        scoredTurnCount: bucket.scores.length,
      });
    }
    result.set(pairKey, cellMap);
  }
  return result;
}

// ─── Markdown レンダリング (§9 のフォーマットに合わせる) ─────────────────────────

function formatScore(n: number | null): string {
  return n === null ? "-.-" : n.toFixed(2);
}

const EMPTY_CELL: MatrixCell = {
  avgScore: null,
  hasSafetyFail: false,
  scoredTurnCount: 0,
};

export interface LangPairSummary {
  langPair: string;
  /** SCENARIO_ORDER の全キーを持つとは限らない (未実施シナリオは未セット) */
  cells: Map<ScenarioKey, MatrixCell>;
  overallAvg: number | null;
  judgement: Judgement;
}

/**
 * langPair の 5 シナリオセルから全体平均・判定を算出する。
 * §9.3: 全 5 シナリオが採点済みの場合のみ平均・判定を確定する
 * (一部未実施なら "-" のまま、中途半端な平均で誤判定しないため)。
 */
export function summarizeLangPair(
  langPair: string,
  matrix: Map<string, Map<ScenarioKey, MatrixCell>>
): LangPairSummary {
  const cellMap = matrix.get(langPair);
  const cells = new Map<ScenarioKey, MatrixCell>();
  for (const scenario of SCENARIO_ORDER) {
    cells.set(scenario, cellMap?.get(scenario) ?? EMPTY_CELL);
  }

  const scoredCells = SCENARIO_ORDER.map((s) => cells.get(s) ?? EMPTY_CELL);
  const allScored = scoredCells.every((c) => c.avgScore !== null);
  const hasSafetyFail = scoredCells.some((c) => c.hasSafetyFail);
  const overallAvg = allScored
    ? scoredCells.reduce((sum, c) => sum + (c.avgScore ?? 0), 0) /
      scoredCells.length
    : null;

  return {
    langPair,
    cells,
    overallAvg,
    judgement: judge(overallAvg, hasSafetyFail),
  };
}

/** docs/translation-quality-qa.md §9 と同一フォーマットの markdown テーブルを生成する */
export function buildMatrixMarkdown(
  langPairs: readonly string[],
  matrix: Map<string, Map<ScenarioKey, MatrixCell>>
): string {
  const header = `         | ${SCENARIO_ORDER.map((s) => SCENARIO_LABELS[s]).join(" | ")} | 平均  | 判定`;
  const sep = `---------+---------+---------+---------+---------+-----------+-------+------`;
  const lines = [header, sep];

  for (const pair of langPairs) {
    const summary = summarizeLangPair(pair, matrix);
    const cellsStr = SCENARIO_ORDER.map((s) =>
      formatScore((summary.cells.get(s) ?? EMPTY_CELL).avgScore).padStart(7)
    ).join(" | ");
    lines.push(
      `${pair.padEnd(8)} | ${cellsStr} | ${formatScore(summary.overallAvg).padStart(5)} | ${summary.judgement.padStart(4)}`
    );
  }

  return lines.join("\n");
}

// ─── シナリオ網羅チェック (M-12: 「実測を回すための仕組み」の一部) ─────────────────

export interface CoverageGap {
  langPair: string;
  scenario: ScenarioKey;
  reason: "not_run" | "not_scored";
}

/**
 * canonical 言語ペア × 5 シナリオのうち、まだ評価が完了していない (weighted_score が
 * 1 件も入力されていない) セルを列挙する。実測を進める QA 担当者が
 * 「残りどこをやればいいか」を機械的に把握するためのチェック。
 */
export function findCoverageGaps(
  langPairs: readonly string[],
  matrix: Map<string, Map<ScenarioKey, MatrixCell>>
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const pair of langPairs) {
    const cellMap = matrix.get(pair);
    for (const scenario of SCENARIO_ORDER) {
      const cell = cellMap?.get(scenario);
      if (!cell || cell.scoredTurnCount === 0) {
        gaps.push({
          langPair: pair,
          scenario,
          reason: cell ? "not_scored" : "not_run",
        });
      }
    }
  }
  return gaps;
}

/** fixture YAML の網羅性を確認する (apps/cron/quality-qa/scenarios 配下)。 */
export function checkFixtureDirectoryCoverage(scenariosDir: string): {
  missingLangPairs: string[];
  incompleteLangPairs: Array<{ langPair: string; foundScenarios: string[] }>;
} {
  const expectedScenarioFiles = [
    "casual-greeting",
    "business-meeting",
    "travel-places",
    "numbers-currency",
    "code-switching",
  ];

  const existingDirs = new Set(
    readdirSync(scenariosDir).filter((entry) =>
      statSync(join(scenariosDir, entry)).isDirectory()
    )
  );

  const missingLangPairs: string[] = [];
  const incompleteLangPairs: Array<{ langPair: string; foundScenarios: string[] }> = [];

  for (const pair of CANONICAL_LANG_PAIRS) {
    if (!existingDirs.has(pair)) {
      missingLangPairs.push(pair);
      continue;
    }
    const files = readdirSync(join(scenariosDir, pair))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => f.replace(".yaml", ""));
    const missing = expectedScenarioFiles.filter((s) => !files.includes(s));
    if (missing.length > 0) {
      incompleteLangPairs.push({ langPair: pair, foundScenarios: files });
    }
  }

  return { missingLangPairs, incompleteLangPairs };
}

// ─── レポート生成 (CLI から呼び出す副作用あり関数) ───────────────────────────────

export interface GenerateMatrixReportOptions {
  evaluatorCsvPath: string;
  outputDir: string;
  runDate: string; // YYYY-MM-DD
}

/**
 * 採点済み evaluator-sheet CSV を読み込み、Phase 1a 主要 4 ペア + 全 14 言語ペアの
 * 合否判定マトリクス markdown と、未実施/未採点セルの一覧を
 * `docs/audit-reports/qa-pass-fail-matrix-<runDate>.md` に書き出す。
 */
export function generateMatrixReport(
  content: string,
  options: GenerateMatrixReportOptions
): string {
  const rows = parseEvaluatorCsv(content);
  const matrix = aggregateMatrix(rows);

  const phase1aTable = buildMatrixMarkdown(PHASE_1A_PRIORITY_LANG_PAIRS, matrix);
  const fullTable = buildMatrixMarkdown(CANONICAL_LANG_PAIRS, matrix);
  const gaps = findCoverageGaps(CANONICAL_LANG_PAIRS, matrix);

  const gapsSection =
    gaps.length === 0
      ? "全 14 言語ペア × 5 シナリオが採点済みです。"
      : gaps
          .map((g) => `- ${g.langPair} / ${g.scenario}: ${g.reason === "not_run" ? "未実施" : "採点未入力"}`)
          .join("\n");

  const markdown = `# 翻訳品質 QA 合否判定マトリクス (自動生成)

生成日: ${options.runDate}
入力: ${options.evaluatorCsvPath}

> M-12: 本ファイルは \`apps/cron/quality-qa/matrix.ts\` の \`generateMatrixReport\` により、
> 採点済み evaluator-sheet CSV から自動生成される。
> docs/translation-quality-qa.md §9 のテンプレートと同一フォーマット。

## Phase 1a 主要 4 ペア

\`\`\`
${phase1aTable}
\`\`\`

## 全 14 言語ペア

\`\`\`
${fullTable}
\`\`\`

## 未実施・未採点セル (実測を進める際の残タスク一覧)

${gapsSection}
`;

  mkdirSync(options.outputDir, { recursive: true });
  const outputPath = join(
    options.outputDir,
    `qa-pass-fail-matrix-${options.runDate}.md`
  );
  writeFileSync(outputPath, markdown, "utf-8");
  console.log(`[matrix] Pass/fail matrix written to ${outputPath}`);

  return outputPath;
}
