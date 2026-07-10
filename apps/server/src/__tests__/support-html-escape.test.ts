/**
 * サポートメール HTML エスケープ テスト (Issue #28)
 *
 * buildEmailHtml() がユーザー入力 (subject/body/診断情報/メールアドレス) を
 * エスケープしてから HTML に埋め込んでいることを検証する。
 */

import { describe, it, expect } from "vitest";
import { escapeHtml, buildEmailHtml } from "../routes/support-routes.js";

describe("escapeHtml", () => {
  it("<script> タグをエスケープする", () => {
    const result = escapeHtml("<script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("属性インジェクション用の引用符もエスケープする", () => {
    const result = escapeHtml(`" onmouseover="alert(1)" '`);
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
  });

  it("& はエンティティ化される (二重エスケープの元にもなるため単体でも確認)", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });
});

function makeInquiry(overrides: Partial<Parameters<typeof buildEmailHtml>[0]["inquiry"]> = {}) {
  return {
    category: "bug" as const,
    subject: "通常の件名",
    body: "通常の本文",
    diagnosticData: {
      appVersion: "1.0.0",
      osVersion: "iOS 17.5",
      deviceModel: "iPhone 15 Pro",
      submittedAt: "2026-05-12T10:00:00.000Z",
      locale: "ja-JP",
      callHistoryLast7d: 5,
      subscriptionTier: "free" as const,
    },
    ...overrides,
  };
}

describe("buildEmailHtml — HTML インジェクション対策 (Issue #28)", () => {
  it("body に <script> タグを含む問い合わせを送ってもメール HTML に生の <script> が残らない", () => {
    const html = buildEmailHtml({
      inquiry: makeInquiry({ body: "<script>alert('xss')</script>通話が止まる" }),
      ticketId: "TC-20260512-ABCDEF",
      anonymizedUserId: "deadbeef",
      userEmail: "user@example.com",
    });

    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("subject への HTML インジェクションもエスケープされる", () => {
    const html = buildEmailHtml({
      inquiry: makeInquiry({ subject: '<img src=x onerror="alert(1)">' }),
      ticketId: "TC-20260512-ABCDEF",
      anonymizedUserId: "deadbeef",
      userEmail: "user@example.com",
    });

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img");
  });

  it("診断情報 (appVersion/osVersion/deviceModel/locale) もエスケープされる", () => {
    const html = buildEmailHtml({
      inquiry: makeInquiry({
        diagnosticData: {
          ...makeInquiry().diagnosticData,
          appVersion: "<b>1.0.0</b>",
          osVersion: "<i>iOS</i>",
          deviceModel: "<u>iPhone</u>",
          locale: "<mark>ja-JP</mark>",
        },
      }),
      ticketId: "TC-20260512-ABCDEF",
      anonymizedUserId: "deadbeef",
      userEmail: "user@example.com",
    });

    expect(html).not.toContain("<b>1.0.0</b>");
    expect(html).not.toContain("<i>iOS</i>");
    expect(html).not.toContain("<u>iPhone</u>");
    expect(html).not.toContain("<mark>ja-JP</mark>");
  });

  it("userEmail (返信先表示) もエスケープされる", () => {
    const html = buildEmailHtml({
      inquiry: makeInquiry(),
      ticketId: "TC-20260512-ABCDEF",
      anonymizedUserId: "deadbeef",
      userEmail: '"><script>alert(1)</script>@example.com',
    });

    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("通常の入力では従来通り本文がそのまま (エスケープ後も) 読める形で含まれる", () => {
    const html = buildEmailHtml({
      inquiry: makeInquiry({ body: "通話中に翻訳が止まります" }),
      ticketId: "TC-20260512-ABCDEF",
      anonymizedUserId: "deadbeef",
      userEmail: "user@example.com",
    });

    expect(html).toContain("通話中に翻訳が止まります");
    expect(html).toContain("TC-20260512-ABCDEF");
  });
});
