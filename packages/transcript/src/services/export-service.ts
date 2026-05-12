/**
 * ExportService — PDF / TXT エクスポート実装
 *
 * transcript-export-spec.md (TRANSCRIPT-EXPORT-001) 準拠
 * pdfkit + Source Han Sans (OFL 1.1) + NotoSansDevanagari (OFL 1.1) で多言語 A4 縦 PDF 生成
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { type Result, ok, err } from "@trancall/shared-kernel";
import type { RoomId, UserId } from "@trancall/shared-kernel";
import type { TranscriptSegment } from "../schemas.js";

export type ExportFormat = "pdf" | "txt";

export interface ExportResult {
  contentBase64: string;
  mime: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// ExportInput — リポジトリに依存せず値渡しで受け取る
// ---------------------------------------------------------------------------

export interface RoomMeta {
  roomId: RoomId;
  /** 通話開始日時 (ISO string) */
  createdAt: string;
  /** 通話終了日時 (ISO string または null) */
  endedAt: string | null;
  /** リクエストユーザーの表示名 */
  myName: string;
  /** 相手の表示名一覧 */
  otherNames: string[];
  /** 翻訳ペア例: "ja → en, en → ja" */
  languagePairs: string[];
}

export interface ExportInput {
  roomMeta: RoomMeta;
  segments: TranscriptSegment[];
  /** 同意バージョン (docs/legal-and-consent.md §14 準拠) */
  termsVersion: string;
  privacyVersion: string;
}

export interface ExportService {
  /**
   * トランスクリプトを PDF または TXT にエクスポートする。
   * アクセス権チェックは facade 側で実施済み前提。
   */
  exportTranscript(
    input: ExportInput,
    format: ExportFormat,
  ): Promise<Result<ExportResult>>;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/** ミリ秒 → "HH:MM:SS" */
function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** 秒 → "X 分 Y 秒" */
function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s} 秒`;
  return `${m} 分 ${s} 秒`;
}

/** Date → "YYYY-MM-DD HH:mm:ss JST" */
function formatDateJST(dateStr: string): string {
  const d = new Date(dateStr);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return (
    `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())} ` +
    `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}:${pad2(jst.getUTCSeconds())} JST`
  );
}

/** Date → "YYYYMMDD" (JST) */
function toYYYYMMDD(dateStr: string): string {
  const d = new Date(dateStr);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return `${jst.getUTCFullYear()}${pad2(jst.getUTCMonth() + 1)}${pad2(jst.getUTCDate())}`;
}

/** Date → "HHmm" (JST) */
function toHHmm(dateStr: string): string {
  const d = new Date(dateStr);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return `${pad2(jst.getUTCHours())}${pad2(jst.getUTCMinutes())}`;
}

/** ファイル名生成 (§6 準拠) */
function buildFilename(roomId: RoomId, createdAt: string, ext: "pdf" | "txt"): string {
  const yyyymmdd = toYYYYMMDD(createdAt);
  const hhmm = toHHmm(createdAt);
  const roomShort = (roomId as string).replace(/-/g, "").slice(0, 8);
  return `trancall-transcript-${yyyymmdd}-${hhmm}-${roomShort}.${ext}`;
}

/** pdfkit の書き込みストリームを Buffer に変換する */
async function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = doc as unknown as Readable;
    readable.on("data", (chunk: Buffer) => chunks.push(chunk));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", (e: Error) => reject(e));
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// フォントパス解決
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getFontPath(name: string): string {
  // src/services/export-service.ts → ../../fonts/
  return join(__dirname, "..", "..", "fonts", name);
}

const FONT_REGULAR = getFontPath("SourceHanSans-Regular.otf");
const FONT_BOLD = getFontPath("SourceHanSans-Bold.otf");
const FONT_DEVANAGARI = getFontPath("NotoSansDevanagari-Regular.ttf");
// NotoSansArabic: Arabic script フォールバック (U+0600–U+06FF 等)
const FONT_ARABIC = getFontPath("NotoSansArabic-Regular.ttf");

// ---------------------------------------------------------------------------
// PDF 生成
// ---------------------------------------------------------------------------

const PAGE_MARGINS = { top: 57, bottom: 57, left: 57, right: 57 }; // ~20mm
const PAGE_WIDTH = 595.28; // A4 pt
const PAGE_HEIGHT = 841.89; // A4 pt
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGINS.left - PAGE_MARGINS.right;
const HEADER_H = 50;
const FOOTER_H = 20;
const BODY_TOP = PAGE_MARGINS.top + HEADER_H + 10;
const BODY_BOTTOM = PAGE_HEIGHT - PAGE_MARGINS.bottom - FOOTER_H - 10;

async function generatePDF(input: ExportInput): Promise<Buffer> {
  // pdfkit は CommonJS パッケージ。ESM context で import するため createRequire 使用。
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require("pdfkit") as typeof import("pdfkit");

  const { roomMeta, segments } = input;
  const callEndedAt = roomMeta.endedAt ?? roomMeta.createdAt;

  const doc: PDFKit.PDFDocument = new PDFDocument({
    size: "A4",
    margins: PAGE_MARGINS,
    autoFirstPage: false,
    info: {
      Title: `TranCall Transcript - ${(roomMeta.roomId as string).slice(0, 8)}`,
      Author: "TranCall",
      Subject: `Translation call between ${roomMeta.myName} and ${roomMeta.otherNames.join(", ")}`,
      Creator: "TranCall Server v1.0",
      Producer: "pdfkit",
      CreationDate: new Date(callEndedAt),
    },
  });

  // フォント登録
  doc.registerFont("Regular", FONT_REGULAR);
  doc.registerFont("Bold", FONT_BOLD);
  doc.registerFont("Devanagari", FONT_DEVANAGARI);
  // NotoSansArabic: アラビア文字フォールバック (transcript-export-spec.md §5.2 準拠)
  doc.registerFont("NotoSansArabic", FONT_ARABIC);

  // 通話時間計算
  const durationMs =
    segments.length > 0
      ? Math.max(...segments.map((s) => s.endTimeMs))
      : 0;
  const durationSec = Math.floor(durationMs / 1000);

  // 翻訳ペア文字列
  const langPairsStr = roomMeta.languagePairs.join(", ");

  // 参加者文字列
  const participantsStr = [
    `自分 (${roomMeta.myName})`,
    ...roomMeta.otherNames,
  ].join(", ");

  let currentPage = 0;
  let totalPages = 0; // 後で差し替え (pdfkit は ahead estimation 不可のため placeholder)

  // ページ追加ヘルパー
  const addPage = () => {
    doc.addPage({ size: "A4", margins: PAGE_MARGINS });
    currentPage++;
    drawHeader();
  };

  // ヘッダ描画
  const drawHeader = () => {
    const y = PAGE_MARGINS.top;
    doc
      .font("Bold")
      .fontSize(14)
      .fillColor("#000000")
      .text("TranCall", PAGE_MARGINS.left, y);
    doc
      .font("Regular")
      .fontSize(10)
      .fillColor("#333333")
      .text("通話トランスクリプト", PAGE_MARGINS.left, y + 18);
    doc
      .moveTo(PAGE_MARGINS.left, y + HEADER_H - 2)
      .lineTo(PAGE_WIDTH - PAGE_MARGINS.right, y + HEADER_H - 2)
      .strokeColor("#cccccc")
      .stroke();
  };

  // フッタ描画（ページ番号はテキスト + 暫定番号）
  const drawFooter = (pageNum: number) => {
    const y = PAGE_HEIGHT - PAGE_MARGINS.bottom - FOOTER_H + 4;
    doc
      .moveTo(PAGE_MARGINS.left, y - 4)
      .lineTo(PAGE_WIDTH - PAGE_MARGINS.right, y - 4)
      .strokeColor("#cccccc")
      .stroke();
    doc
      .font("Regular")
      .fontSize(8)
      .fillColor("#888888")
      .text(`Page ${pageNum}`, PAGE_MARGINS.left, y, { width: CONTENT_WIDTH / 2 })
      .text("TranCall (c) 2026", PAGE_MARGINS.left + CONTENT_WIDTH / 2, y, {
        width: CONTENT_WIDTH / 2,
        align: "right",
      });
  };

  // メタ情報ブロック描画
  const drawMeta = (yStart: number): number => {
    let y = yStart;
    const lineH = 16;
    doc.font("Regular").fontSize(10).fillColor("#000000");
    doc.text(`通話日時: ${formatDateJST(roomMeta.createdAt)}`, PAGE_MARGINS.left, y);
    y += lineH;
    doc.text(`参加者: ${participantsStr}`, PAGE_MARGINS.left, y);
    y += lineH;
    doc.text(`通話時間: ${formatDuration(durationSec)}`, PAGE_MARGINS.left, y);
    y += lineH;
    doc.text(`翻訳ペア: ${langPairsStr}`, PAGE_MARGINS.left, y);
    y += lineH + 8;
    doc
      .moveTo(PAGE_MARGINS.left, y)
      .lineTo(PAGE_WIDTH - PAGE_MARGINS.right, y)
      .strokeColor("#cccccc")
      .stroke();
    y += 10;
    return y;
  };

  // ヒンディー語チェック (Devanagari Unicode range: U+0900-U+097F)
  const hasDevanagari = (text: string) => /[ऀ-ॿ]/.test(text);

  // アラビア文字チェック (transcript-export-spec.md §5.2 準拠)
  // Covers: Arabic (U+0600–U+06FF), Arabic Supplement (U+0750–U+077F),
  //         Arabic Presentation Forms-A (U+FB50–U+FDFF),
  //         Arabic Presentation Forms-B (U+FE70–U+FEFF)
  const hasArabic = (text: string) =>
    /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text);

  const chooseFont = (text: string, bold: boolean): string => {
    if (hasDevanagari(text)) return "Devanagari";
    if (hasArabic(text)) return "NotoSansArabic";
    return bold ? "Bold" : "Regular";
  };

  // 最初のページ追加
  addPage();
  let y = drawMeta(BODY_TOP);

  // セグメント描画
  for (const seg of segments) {
    const ts = msToTimestamp(seg.startTimeMs);
    const speakerLine = `[${ts}] ${seg.speakerName} (${seg.languagePair})`;
    const origText = seg.originalText;
    const transText = seg.translatedText ?? "";

    // 大まかな高さ推定（speaker + orig + trans + gap）
    const estimatedHeight = 14 + 15 + (transText ? 15 : 0) + 8;

    if (y + estimatedHeight > BODY_BOTTOM) {
      drawFooter(currentPage);
      addPage();
      y = BODY_TOP;
    }

    // speaker line
    doc
      .font(chooseFont(speakerLine, true))
      .fontSize(10)
      .fillColor("#000000")
      .text(speakerLine, PAGE_MARGINS.left, y, { width: CONTENT_WIDTH });
    y += 14;

    // original text
    const origFont = chooseFont(origText, false);
    doc
      .font(origFont)
      .fontSize(11)
      .fillColor("#000000")
      .text(`  ${origText}`, PAGE_MARGINS.left, y, { width: CONTENT_WIDTH });
    const origH = doc.heightOfString(`  ${origText}`, { width: CONTENT_WIDTH });
    y += origH + 2;

    // translated text (italic 相当、灰色)
    if (transText) {
      const transFont = chooseFont(transText, false);
      doc
        .font(transFont)
        .fontSize(11)
        .fillColor("#888888")
        .text(`  "${transText}"`, PAGE_MARGINS.left, y, { width: CONTENT_WIDTH });
      const transH = doc.heightOfString(`  "${transText}"`, { width: CONTENT_WIDTH });
      y += transH + 2;
    }

    y += 8; // segment 間の余白
  }

  // 同意バージョン記載 (§7.3 準拠)
  const consentText =
    `本トランスクリプトは利用規約 v${input.termsVersion} および` +
    `プライバシーポリシー v${input.privacyVersion} に同意のうえ生成されました。`;

  if (y + 30 > BODY_BOTTOM) {
    drawFooter(currentPage);
    addPage();
    y = BODY_TOP;
  }
  doc
    .moveTo(PAGE_MARGINS.left, y)
    .lineTo(PAGE_WIDTH - PAGE_MARGINS.right, y)
    .strokeColor("#cccccc")
    .stroke();
  y += 8;
  doc
    .font("Regular")
    .fontSize(8)
    .fillColor("#888888")
    .text(consentText, PAGE_MARGINS.left, y, { width: CONTENT_WIDTH });

  // 最終ページのフッタ
  drawFooter(currentPage);
  totalPages = currentPage;
  void totalPages; // 変数使用（ページ数は動的差し替えのため今は参照のみ）

  return streamToBuffer(doc);
}

// ---------------------------------------------------------------------------
// TXT 生成
// ---------------------------------------------------------------------------

function generateTXT(input: ExportInput): Buffer {
  const { roomMeta, segments } = input;
  const sep = "==============================================\n";
  const callEndedAt = roomMeta.endedAt ?? roomMeta.createdAt;

  const durationMs =
    segments.length > 0
      ? Math.max(...segments.map((s) => s.endTimeMs))
      : 0;
  const durationSec = Math.floor(durationMs / 1000);

  const participantsStr = [
    `自分 (${roomMeta.myName})`,
    ...roomMeta.otherNames,
  ].join(", ");
  const langPairsStr = roomMeta.languagePairs.join(", ");

  let out = "";
  out += sep;
  out += "TranCall 通話トランスクリプト\n";
  out += sep;
  out += "\n";
  out += `通話日時: ${formatDateJST(roomMeta.createdAt)}\n`;
  out += `参加者: ${participantsStr}\n`;
  out += `通話時間: ${formatDuration(durationSec)}\n`;
  out += `翻訳ペア: ${roomMeta.languagePairs.map((p) => p.replace("→", "->")).join(", ")}\n`;
  out += "\n";
  out += sep;
  out += "\n";

  for (const seg of segments) {
    const ts = msToTimestamp(seg.startTimeMs);
    const lp = seg.languagePair.replace("→", "->");
    out += `[${ts}] ${seg.speakerName} (${lp})\n`;
    out += `  原文: ${seg.originalText}\n`;
    if (seg.translatedText) {
      out += `  翻訳: ${seg.translatedText}\n`;
    }
    out += "\n";
  }

  // 同意バージョン記載 (§7.3 準拠)
  const generatedAt = formatDateJST(new Date().toISOString());
  out += sep;
  out += `TranCall (c) 2026 — Generated at ${generatedAt}\n`;
  out += sep;
  out += "\n";
  out += `本トランスクリプトは利用規約 v${input.termsVersion} および`;
  out += `プライバシーポリシー v${input.privacyVersion} に同意のうえ生成されました。\n`;
  out += sep;

  // §4.3: UTF-8 with BOM
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, Buffer.from(out, "utf8")]);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExportService(): ExportService {
  return {
    exportTranscript: async (
      input: ExportInput,
      format: ExportFormat,
    ): Promise<Result<ExportResult>> => {
      try {
        if (format === "pdf") {
          const buf = await generatePDF(input);
          const filename = buildFilename(input.roomMeta.roomId, input.roomMeta.createdAt, "pdf");
          return ok({
            contentBase64: buf.toString("base64"),
            mime: "application/pdf",
            filename,
          });
        } else {
          const buf = generateTXT(input);
          const filename = buildFilename(input.roomMeta.roomId, input.roomMeta.createdAt, "txt");
          return ok({
            contentBase64: buf.toString("base64"),
            mime: "text/plain; charset=utf-8",
            filename,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err({
          code: "INTERNAL_ERROR",
          message: `エクスポートに失敗しました: ${msg}`,
          retryable: false,
          httpStatus: 500,
        });
      }
    },
  };
}
