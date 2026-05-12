/**
 * ExportService テスト
 *
 * transcript-export-spec.md (TRANSCRIPT-EXPORT-001) §9.1 unit テスト準拠
 */

import { describe, it, expect } from "vitest";
import { createExportService } from "../src/services/export-service.js";
import type { ExportInput, RoomMeta } from "../src/services/export-service.js";
import {
  brandRoomId,
  brandParticipantId,
} from "@trancall/shared-kernel";
import { makeSegment, ROOM_ID, PARTICIPANT_A, PARTICIPANT_B } from "./helpers/fixtures.js";
import type { TranscriptSegment } from "../src/schemas.js";

function mustOk<T>(result: { success: boolean; data?: T }): T {
  if (!result.success || result.data === undefined) {
    throw new Error("brand parse failed");
  }
  return result.data;
}

// テスト用 RoomMeta
const ROOM_META: RoomMeta = {
  roomId: ROOM_ID,
  createdAt: "2026-05-12T01:00:00.000Z",
  endedAt: "2026-05-12T01:05:32.000Z",
  myName: "山田太郎",
  otherNames: ["John Wang"],
  languagePairs: ["ja → en", "en → ja"],
};

// 10 セグメント (ja/en/zh 混在)
function makeMultiLangSegments(): TranscriptSegment[] {
  return [
    makeSegment({
      participantId: PARTICIPANT_A,
      speakerName: "山田太郎",
      originalText: "こんにちは、お元気ですか？",
      translatedText: "Hello, how are you?",
      languagePair: "ja → en",
      startTimeMs: 3000,
      endTimeMs: 5000,
      sequenceNo: 0,
    }),
    makeSegment({
      participantId: PARTICIPANT_B,
      speakerName: "John Wang",
      originalText: "I'm doing well, thank you.",
      translatedText: "元気です、ありがとう。",
      languagePair: "en → ja",
      startTimeMs: 8000,
      endTimeMs: 11000,
      sequenceNo: 0,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d410",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d411",
    }),
    makeSegment({
      participantId: PARTICIPANT_A,
      speakerName: "山田太郎",
      originalText: "今日はよい天気ですね。",
      translatedText: "It's nice weather today, isn't it?",
      languagePair: "ja → en",
      startTimeMs: 13000,
      endTimeMs: 16000,
      sequenceNo: 1,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d412",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d413",
    }),
    makeSegment({
      participantId: PARTICIPANT_B,
      speakerName: "Wang Wei (王伟)",
      originalText: "你好，最近怎么样？",
      translatedText: "こんにちは、最近どうですか？",
      languagePair: "zh → ja",
      startTimeMs: 18000,
      endTimeMs: 21000,
      sequenceNo: 1,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d414",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d415",
    }),
    makeSegment({
      participantId: PARTICIPANT_A,
      speakerName: "山田太郎",
      originalText: "プロジェクトの進捗はいかがでしょうか？",
      translatedText: "How is the project progressing?",
      languagePair: "ja → en",
      startTimeMs: 25000,
      endTimeMs: 29000,
      sequenceNo: 2,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d416",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d417",
    }),
    makeSegment({
      participantId: PARTICIPANT_B,
      speakerName: "John Wang",
      originalText: "We are making good progress. The deadline is next week.",
      translatedText: "良い進捗です。締め切りは来週です。",
      languagePair: "en → ja",
      startTimeMs: 31000,
      endTimeMs: 36000,
      sequenceNo: 2,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d418",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d419",
    }),
    makeSegment({
      participantId: PARTICIPANT_A,
      speakerName: "山田太郎",
      originalText: "わかりました。何か問題はありますか？",
      translatedText: "I see. Are there any issues?",
      languagePair: "ja → en",
      startTimeMs: 38000,
      endTimeMs: 41000,
      sequenceNo: 3,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d420",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d421",
    }),
    makeSegment({
      participantId: PARTICIPANT_B,
      speakerName: "Wang Wei (王伟)",
      originalText: "没有什么大问题，一切进展顺利。",
      translatedText: "大きな問題はなく、すべて順調に進んでいます。",
      languagePair: "zh → ja",
      startTimeMs: 44000,
      endTimeMs: 48000,
      sequenceNo: 3,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d422",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d423",
    }),
    makeSegment({
      participantId: PARTICIPANT_A,
      speakerName: "山田太郎",
      originalText: "それはよかった。引き続きよろしくお願いします。",
      translatedText: "That's great. Please continue doing a good job.",
      languagePair: "ja → en",
      startTimeMs: 51000,
      endTimeMs: 55000,
      sequenceNo: 4,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d424",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d425",
    }),
    makeSegment({
      participantId: PARTICIPANT_B,
      speakerName: "John Wang",
      originalText: "Thank you. Let's meet again next week.",
      translatedText: "ありがとう。来週また会いましょう。",
      languagePair: "en → ja",
      startTimeMs: 58000,
      endTimeMs: 62000,
      sequenceNo: 4,
      segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d426",
      sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d427",
    }),
  ];
}

function makeInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    roomMeta: ROOM_META,
    segments: makeMultiLangSegments(),
    termsVersion: "1.0.0",
    privacyVersion: "1.0.0",
    ...overrides,
  };
}

describe("ExportService", () => {
  const service = createExportService();

  // ---------- PDF ----------

  describe("PDF 生成", () => {
    it("test-1: PDF magic bytes (%PDF) で始まる", async () => {
      const result = await service.exportTranscript(makeInput(), "pdf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        // %PDF-1.x
        expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      }
    });

    it("test-2: mime が application/pdf", async () => {
      const result = await service.exportTranscript(makeInput(), "pdf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mime).toBe("application/pdf");
      }
    });

    it("test-3: filename が命名規則に従う (YYYYMMDD-HHmm-<8chars>.pdf)", async () => {
      const result = await service.exportTranscript(makeInput(), "pdf");
      expect(result.ok).toBe(true);
      if (result.ok) {
        // trancall-transcript-20260512-1000-<8chars>.pdf
        expect(result.data.filename).toMatch(
          /^trancall-transcript-\d{8}-\d{4}-[0-9a-f]{8}\.pdf$/,
        );
      }
    });

    it("test-4: 多言語 (ja+en+zh 混在) で生成が成功する", async () => {
      const result = await service.exportTranscript(makeInput(), "pdf");
      expect(result.ok).toBe(true);
    });
  });

  // ---------- TXT ----------

  describe("TXT 生成", () => {
    it("test-5: UTF-8 BOM (EF BB BF) で始まる", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        expect(buf[0]).toBe(0xef);
        expect(buf[1]).toBe(0xbb);
        expect(buf[2]).toBe(0xbf);
      }
    });

    it("test-6: mime が text/plain; charset=utf-8", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mime).toBe("text/plain; charset=utf-8");
      }
    });

    it("test-7: filename が命名規則に従う (.txt)", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.filename).toMatch(
          /^trancall-transcript-\d{8}-\d{4}-[0-9a-f]{8}\.txt$/,
        );
      }
    });

    it("test-8: TXT 本文にヘッダ文字列を含む", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        // BOM を除いた本文
        const text = buf.slice(3).toString("utf8");
        expect(text).toContain("TranCall 通話トランスクリプト");
        expect(text).toContain("山田太郎");
        expect(text).toContain("John Wang");
      }
    });

    it("test-9: TXT 本文に各 segment の原文・翻訳が含まれる", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        const text = buf.slice(3).toString("utf8");
        // 日本語テキスト
        expect(text).toContain("こんにちは、お元気ですか？");
        // 英語テキスト
        expect(text).toContain("I'm doing well, thank you.");
        // 中国語テキスト
        expect(text).toContain("你好，最近怎么样？");
      }
    });

    it("test-10: TXT 末尾に同意バージョン記載がある", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        const text = buf.slice(3).toString("utf8");
        expect(text).toContain("利用規約 v1.0.0");
        expect(text).toContain("プライバシーポリシー v1.0.0");
      }
    });

    it("test-11: TXT に翻訳ペア情報が含まれる", async () => {
      const result = await service.exportTranscript(makeInput(), "txt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        const text = buf.slice(3).toString("utf8");
        expect(text).toContain("ja -> en");
        expect(text).toContain("en -> ja");
      }
    });
  });

  // ---------- エッジケース ----------

  describe("エッジケース", () => {
    it("test-12: 空 segments でも PDF 生成が成功する", async () => {
      const result = await service.exportTranscript(
        makeInput({ segments: [] }),
        "pdf",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      }
    });

    it("test-13: 空 segments でも TXT 生成が成功する", async () => {
      const result = await service.exportTranscript(
        makeInput({ segments: [] }),
        "txt",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        const text = buf.slice(3).toString("utf8");
        expect(text).toContain("TranCall 通話トランスクリプト");
      }
    });

    it("test-14: 長文 (50 segments) で PDF 生成が成功する", async () => {
      const participantC = mustOk(brandParticipantId("f47ac10b-58cc-4372-a567-0e02b2c3d490"));
      const longSegments: TranscriptSegment[] = Array.from({ length: 50 }, (_, i) =>
        makeSegment({
          participantId: i % 2 === 0 ? PARTICIPANT_A : participantC,
          speakerName: i % 2 === 0 ? "山田太郎" : "Long Speaker",
          originalText: `これはテスト文章 ${i + 1} 番目です。長いテキストのテストを行っています。`,
          translatedText: `This is test sentence number ${i + 1}. Testing long text output.`,
          languagePair: "ja → en",
          startTimeMs: i * 5000,
          endTimeMs: i * 5000 + 4000,
          sequenceNo: Math.floor(i / 2),
          segmentId: `f47ac10b-58cc-4372-a567-0e02b2c3d4${(50 + i).toString(16).padStart(2, "0")}`,
          sourceEventId: `f47ac10b-58cc-4372-a567-0e02b2c3d5${(50 + i).toString(16).padStart(2, "0")}`,
        }),
      );

      const result = await service.exportTranscript(
        makeInput({ segments: longSegments }),
        "pdf",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      }
    });

    it("test-15: translatedText が null のセグメントを含む場合も TXT 生成が成功する", async () => {
      const segments = [
        makeSegment({
          translatedText: null,
          originalText: "翻訳なしのテキスト",
          languagePair: "ja",
        }),
      ];
      const result = await service.exportTranscript(
        makeInput({ segments }),
        "txt",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        const text = buf.slice(3).toString("utf8");
        expect(text).toContain("翻訳なしのテキスト");
      }
    });

    it("test-16: translatedText が null のセグメントを含む場合も PDF 生成が成功する", async () => {
      const segments = [
        makeSegment({
          translatedText: null,
          originalText: "翻訳なしのテキスト PDF テスト",
          languagePair: "ja",
        }),
      ];
      const result = await service.exportTranscript(
        makeInput({ segments }),
        "pdf",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      }
    });
  });

  // ---------- Arabic 文字混在テスト ----------

  describe("Arabic 文字混在", () => {
    function makeArabicSegments(): TranscriptSegment[] {
      return [
        makeSegment({
          participantId: PARTICIPANT_A,
          speakerName: "Ahmed Hassan",
          originalText: "مرحبا، كيف حالك؟",
          translatedText: "Hello, how are you?",
          languagePair: "ar → en",
          startTimeMs: 3000,
          endTimeMs: 6000,
          sequenceNo: 0,
          segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d500",
          sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d501",
        }),
        makeSegment({
          participantId: PARTICIPANT_B,
          speakerName: "山田太郎",
          originalText: "元気です、ありがとう。",
          translatedText: "أنا بخير، شكراً لك.",
          languagePair: "ja → ar",
          startTimeMs: 8000,
          endTimeMs: 11000,
          sequenceNo: 0,
          segmentId: "f47ac10b-58cc-4372-a567-0e02b2c3d502",
          sourceEventId: "f47ac10b-58cc-4372-a567-0e02b2c3d503",
        }),
      ];
    }

    it("test-17: アラビア文字混在 transcript で PDF magic bytes (%PDF) が得られる", async () => {
      const result = await service.exportTranscript(
        makeInput({ segments: makeArabicSegments() }),
        "pdf",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
      }
    });

    it("test-18: アラビア文字混在 PDF に NotoSansArabic フォント名が埋め込まれている", async () => {
      const result = await service.exportTranscript(
        makeInput({ segments: makeArabicSegments() }),
        "pdf",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const buf = Buffer.from(result.data.contentBase64, "base64");
        // pdfkit は登録フォント名を PDF ストリーム内に埋め込む
        // バイナリ PDF を文字列として走査し、フォント名の存在を検証する
        const pdfStr = buf.toString("latin1");
        expect(pdfStr).toContain("NotoSansArabic");
      }
    });
  });
});
