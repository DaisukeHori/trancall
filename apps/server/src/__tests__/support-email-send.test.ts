/**
 * サポートメール実送信経路テスト (Issue #28)
 *
 * - ESM ("type": "module") 下で `require("resend")` が使えず常に 503 になっていたバグの
 *   修正確認: RESEND_API_KEY 設定時に `resend` パッケージ経由で実際に送信が試みられること。
 * - request.userEmail (常に undefined) ではなく AuthFacade.getProfile() から取得した
 *   実際のメールアドレスが replyTo に使われること。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null });
const ResendConstructorMock = vi.fn().mockImplementation(() => ({
  emails: { send: sendMock },
}));

// #28: 動的 import("resend") もこの vi.mock でインターセプトされる (vitest は
// ESM の動的 import も静的 import と同様にモジュールレジストリを差し替える)。
vi.mock("resend", () => ({
  Resend: ResendConstructorMock,
}));

const VALID_INQUIRY = {
  category: "bug",
  subject: "翻訳が途中で止まる",
  body: "通話中に翻訳が停止してしまいます。",
  diagnosticData: {
    appVersion: "1.0.0",
    osVersion: "iOS 17.5",
    deviceModel: "iPhone 15 Pro",
    submittedAt: "2026-05-12T10:00:00.000Z",
    locale: "ja-JP",
    callHistoryLast7d: 5,
    subscriptionTier: "free",
  },
};

const AUTH_HEADER = { authorization: "Bearer mock-valid-token" };

describe("POST /api/support/inquiry — resend 実送信経路 (#28)", () => {
  let app: FastifyInstance;
  const originalApiKey = process.env["RESEND_API_KEY"];

  beforeEach(async () => {
    process.env["RESEND_API_KEY"] = "test-resend-api-key";
    sendMock.mockClear();
    ResendConstructorMock.mockClear();

    // vi.mock はモジュールレベルで hoist されるため、動的 import 側の解決を
    // 確実にするには各テストで動的 import 前に import しておく必要はないが、
    // buildTestApp 経由でルートを読み込む時点で "resend" は未 import (動的 import は
    // リクエストハンドラ内で初めて実行される) のため beforeEach での準備のみで良い。
    const { buildTestApp } = await import("./helpers/test-app.js");
    const { createMockContainer } = await import("./helpers/mock-container.js");
    app = await buildTestApp(createMockContainer());
  });

  afterEach(async () => {
    await app.close();
    if (originalApiKey === undefined) {
      delete process.env["RESEND_API_KEY"];
    } else {
      process.env["RESEND_API_KEY"] = originalApiKey;
    }
  });

  it("RESEND_API_KEY 設定時は resend 経由で実際に送信を試みる (require() の ESM 失敗が解消されている)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: VALID_INQUIRY,
    });

    expect(response.statusCode).toBe(200);
    expect(ResendConstructorMock).toHaveBeenCalledWith("test-resend-api-key");
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("replyTo には AuthFacade.getProfile() から取得した実際のメールアドレスが使われる (unknown@trancall.app にならない)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: VALID_INQUIRY,
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const sentArgs = sendMock.mock.calls[0]?.[0] as { replyTo: string; html: string };
    // mock-container.ts の auth.getProfile は email: "test@example.com" を返す
    expect(sentArgs.replyTo).toBe("test@example.com");
    expect(sentArgs.replyTo).not.toBe("unknown@trancall.app");
  });

  it("resend.emails.send に渡す HTML は subject/body がエスケープ済みである", async () => {
    await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: {
        ...VALID_INQUIRY,
        subject: "<script>alert(1)</script>",
        body: "本文に <b>タグ</b> を含む",
      },
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const sentArgs = sendMock.mock.calls[0]?.[0] as { html: string };
    expect(sentArgs.html).not.toContain("<script>alert(1)</script>");
    expect(sentArgs.html).not.toContain("<b>タグ</b>");
  });

  it("resend がエラーを返した場合は 503 (SUPPORT_MAIL_SEND_FAILED) を返す", async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "invalid API key" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/support/inquiry",
      headers: AUTH_HEADER,
      payload: VALID_INQUIRY,
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SUPPORT_MAIL_SEND_FAILED");
  });
});
