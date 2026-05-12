/**
 * consent.test.ts — Consent 系 Zod スキーマの単体テスト
 *
 * canonical 定義: docs/legal-and-consent.md v1.2 §3
 * 各スキーマの valid / invalid ケースと ConsentScope 7 値の網羅を検証する。
 */

import { describe, expect, it } from "vitest";

import {
  ConsentScopeSchema,
  ConsentRecordSchema,
  LegalDocumentVersionSchema,
  RequiredConsentViewSchema,
} from "../src/schemas/consent.js";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_USER_UUID = "10000000-0000-4000-8000-000000000001";
const VALID_DATETIME = "2026-05-12T00:00:00.000Z";
const VALID_VERSION = "2026-05-12";
const VALID_VERSION_R = "2026-05-12-r2";

// ============================================================
// ConsentScope
// ============================================================

describe("ConsentScopeSchema", () => {
  const validScopes = [
    "legal_terms",
    "privacy_policy",
    "voice_to_openai",
    "transcript_retention",
    "data_deletion_request",
    "push_notification",
    "marketing_email",
  ] as const;

  it("7 値すべてが合計 7 種類であることを確認する", () => {
    expect(validScopes).toHaveLength(7);
  });

  it.each(validScopes)("'%s' は valid", (scope) => {
    const result = ConsentScopeSchema.safeParse(scope);
    expect(result.success).toBe(true);
  });

  it("未定義の scope 値は invalid", () => {
    const result = ConsentScopeSchema.safeParse("unknown_scope");
    expect(result.success).toBe(false);
  });

  it("空文字は invalid", () => {
    const result = ConsentScopeSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("数値は invalid", () => {
    const result = ConsentScopeSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// LegalDocumentVersionSchema
// ============================================================

describe("LegalDocumentVersionSchema", () => {
  const validBase = {
    scope: "legal_terms",
    version: VALID_VERSION,
    documentUrl: "https://trancall.app/terms",
    effectiveAt: VALID_DATETIME,
    supersedes: null,
    changeSummary: null,
  };

  it("全フィールド valid のオブジェクトを受け入れる", () => {
    const result = LegalDocumentVersionSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("version が YYYY-MM-DD-rN 形式でも valid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      version: VALID_VERSION_R,
    });
    expect(result.success).toBe(true);
  });

  it("documentUrl が null でも valid (voice_to_openai 等)", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      scope: "voice_to_openai",
      documentUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("supersedes に前バージョン文字列を入れても valid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      supersedes: "2026-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("changeSummary に文字列を入れても valid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      changeSummary: "OpenAI 零保持ポリシーへの言及を追記",
    });
    expect(result.success).toBe(true);
  });

  it("version が YYYY-MM-DD 形式でない場合は invalid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      version: "20260512",
    });
    expect(result.success).toBe(false);
  });

  it("version が YYYY/MM/DD 形式は invalid (スラッシュ区切り)", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      version: "2026/05/12",
    });
    expect(result.success).toBe(false);
  });

  it("documentUrl が不正 URL は invalid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      documentUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("effectiveAt が ISO 8601 datetime でない場合は invalid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      effectiveAt: "2026-05-12",
    });
    expect(result.success).toBe(false);
  });

  it("scope が未定義値は invalid", () => {
    const result = LegalDocumentVersionSchema.safeParse({
      ...validBase,
      scope: "unknown_scope",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// ConsentRecordSchema
// ============================================================

describe("ConsentRecordSchema", () => {
  const validBase = {
    id: VALID_UUID,
    userId: VALID_USER_UUID,
    scope: "voice_to_openai",
    version: VALID_VERSION,
    recordedAt: VALID_DATETIME,
    revokedAt: null,
    ipAddress: "203.0.113.1",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    source: "onboarding",
  };

  it("全フィールド valid のオブジェクトを受け入れる", () => {
    const result = ConsentRecordSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("ipAddress が null でも valid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      ipAddress: null,
    });
    expect(result.success).toBe(true);
  });

  it("userAgent が null でも valid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      userAgent: null,
    });
    expect(result.success).toBe(true);
  });

  it("revokedAt に datetime 文字列を入れても valid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      revokedAt: "2026-06-01T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("source が 4 値すべてで valid", () => {
    const sources = [
      "onboarding",
      "incoming_call_first_time",
      "settings_screen",
      "terms_revision_prompt",
    ] as const;
    for (const source of sources) {
      const result = ConsentRecordSchema.safeParse({ ...validBase, source });
      expect(result.success).toBe(true);
    }
  });

  it("source が未定義値は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      source: "unknown_source",
    });
    expect(result.success).toBe(false);
  });

  it("id が UUID でない場合は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("userId が UUID でない場合は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("version が YYYY-MM-DD 形式でない場合は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      version: "1.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("recordedAt が ISO 8601 でない場合は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      recordedAt: "2026-05-12",
    });
    expect(result.success).toBe(false);
  });

  it("scope が未定義値は invalid", () => {
    const result = ConsentRecordSchema.safeParse({
      ...validBase,
      scope: "unknown_scope",
    });
    expect(result.success).toBe(false);
  });

  it("必須フィールド欠落は invalid", () => {
    // id を省く
    const { id: _id, ...withoutId } = validBase;
    const result = ConsentRecordSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// RequiredConsentViewSchema
// ============================================================

describe("RequiredConsentViewSchema", () => {
  const validBase = {
    scope: "legal_terms",
    currentVersion: "2026-05-12",
    userVersion: "2026-05-12",
    isRequired: true,
    isUpToDate: true,
    documentUrl: "https://trancall.app/terms",
  };

  it("全フィールド valid のオブジェクトを受け入れる", () => {
    const result = RequiredConsentViewSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("userVersion が null (未同意) でも valid", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      userVersion: null,
      isUpToDate: false,
    });
    expect(result.success).toBe(true);
  });

  it("documentUrl が null でも valid", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      scope: "voice_to_openai",
      documentUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("isRequired が false でも valid (オプショナルスコープ)", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      scope: "marketing_email",
      isRequired: false,
    });
    expect(result.success).toBe(true);
  });

  it("isUpToDate が false でも valid (バージョン不一致)", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      userVersion: "2026-01-01",
      isUpToDate: false,
    });
    expect(result.success).toBe(true);
  });

  it("scope が未定義値は invalid", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      scope: "unknown_scope",
    });
    expect(result.success).toBe(false);
  });

  it("isRequired が文字列 'true' は invalid (boolean でなければならない)", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      isRequired: "true",
    });
    expect(result.success).toBe(false);
  });

  it("documentUrl が不正 URL は invalid", () => {
    const result = RequiredConsentViewSchema.safeParse({
      ...validBase,
      documentUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("currentVersion 欠落は invalid", () => {
    const { currentVersion: _cv, ...withoutCv } = validBase;
    const result = RequiredConsentViewSchema.safeParse(withoutCv);
    expect(result.success).toBe(false);
  });
});
