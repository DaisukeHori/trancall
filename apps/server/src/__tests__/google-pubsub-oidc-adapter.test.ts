/**
 * GooglePubSubOidcAdapter テスト (#61)
 *
 * - audience 未設定は fail-close (常に拒否)
 * - Authorization ヘッダー欠如/不正形式は拒否
 * - OAuth2Client.verifyIdToken() 成功/失敗の伝播
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

interface MockVerifyIdTokenResult {
  getPayload: () => { email?: string } | undefined;
}
const mockVerifyIdToken = vi.fn<
  (params: { idToken: string; audience: string }) => Promise<MockVerifyIdTokenResult>
>();

vi.mock("google-auth-library", () => {
  return {
    OAuth2Client: vi.fn().mockImplementation(() => ({
      verifyIdToken: (params: { idToken: string; audience: string }) => mockVerifyIdToken(params),
    })),
  };
});

import { verifyGooglePubSubOidcToken } from "../adapters/google-pubsub-oidc-adapter.js";

const AUDIENCE = "https://api.trancall.test/api/billing/webhook/google";

beforeEach(() => {
  mockVerifyIdToken.mockReset();
});

describe("verifyGooglePubSubOidcToken", () => {
  it("audience が未設定なら fail-close で拒否する (UNAUTHORIZED)", async () => {
    const result = await verifyGooglePubSubOidcToken("Bearer sometoken", undefined);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("audience が空文字でも fail-close で拒否する", async () => {
    const result = await verifyGooglePubSubOidcToken("Bearer sometoken", "");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("Authorization ヘッダーが未指定なら拒否する", async () => {
    const result = await verifyGooglePubSubOidcToken(undefined, AUDIENCE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("Authorization ヘッダーが Bearer 形式でなければ拒否する", async () => {
    const result = await verifyGooglePubSubOidcToken("Basic dXNlcjpwYXNz", AUDIENCE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("Bearer トークンが空文字なら拒否する", async () => {
    const result = await verifyGooglePubSubOidcToken("Bearer ", AUDIENCE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("正常系: verifyIdToken が成功しペイロードを返せば ok(email) を返す", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "pubsub-push@test.iam.gserviceaccount.com" }),
    });

    const result = await verifyGooglePubSubOidcToken("Bearer valid-token", AUDIENCE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.email).toBe("pubsub-push@test.iam.gserviceaccount.com");
    expect(mockVerifyIdToken).toHaveBeenCalledWith({ idToken: "valid-token", audience: AUDIENCE });
  });

  it("verifyIdToken が payload なしを返せば拒否する", async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => undefined });

    const result = await verifyGooglePubSubOidcToken("Bearer valid-token", AUDIENCE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
  });

  it("verifyIdToken が例外を投げれば (署名不正・期限切れ・audience 不一致等) 拒否する", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Wrong number of segments in token"));

    const result = await verifyGooglePubSubOidcToken("Bearer tampered-token", AUDIENCE);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHORIZED");
    expect(result.error.message).toContain("Wrong number of segments");
  });
});
