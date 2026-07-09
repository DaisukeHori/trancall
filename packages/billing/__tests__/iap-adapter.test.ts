/**
 * IapAdapter テスト
 *
 * - verifyIapTransaction: 正常系・異常系 (signedJws ペイロード検証)
 * - verifyIapTransaction: x5c 証明書チェーンによる署名検証 (#40)
 * - resolveTier: 正常系・未知 productId
 * - selectLatestTransaction: 最新選択
 */

import { describe, expect, it } from "vitest";
import { createIapAdapter, APPLE_IAP_PRODUCT_ID_MAP } from "../src/adapters/iap-adapter.js";
import type { IapTransactionResult } from "../src/view-models/index.js";
import {
  getAppleJwsTestChain,
  generateAppleJwsTestChain,
  signAppleJws,
  signAppleJwsRaw,
  signAppleJwsWithBrokenChain,
  tamperJwsSignature,
} from "./helpers/apple-jws-fixture.js";

// =============================================================================
// ヘルパー: JWS ペイロード生成
// =============================================================================

const FUTURE_DATE = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 日後

function makeValidJwsPayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: "tx_001",
    originalTransactionId: "orig_tx_001",
    bundleId: "com.trancall.app",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: Date.now(),
    originalPurchaseDate: Date.now(),
    expiresDate: FUTURE_DATE,
    environment: "Production",
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<IapTransactionResult> = {}): IapTransactionResult {
  const payload = makeValidJwsPayload();
  return {
    originalTransactionId: "orig_tx_001",
    productId: "com.trancall.subscription.light.monthly",
    purchaseDate: new Date(payload.purchaseDate).toISOString(),
    expirationDate: new Date(FUTURE_DATE).toISOString(),
    signedJws: signAppleJws(payload),
    isUpgrade: false,
    ...overrides,
  };
}

// =============================================================================
// テスト
// =============================================================================

describe("APPLE_IAP_PRODUCT_ID_MAP", () => {
  it("docs/billing-ui-flow.md §7.2 の productId 命名規則に準拠している", () => {
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.light.monthly"]).toBe("light");
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.standard.monthly"]).toBe("standard");
    expect(APPLE_IAP_PRODUCT_ID_MAP["com.trancall.subscription.business.monthly"]).toBe("business");
  });
});

describe("IapAdapter.verifyIapTransaction — ペイロード検証 (正しく署名された JWS)", () => {
  const adapter = createIapAdapter();

  it("正常系: 有効な JWS で VerifiedIapTransaction が返る", async () => {
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tier).toBe("light");
    expect(result.data.originalTransactionId).toBe("orig_tx_001");
    expect(result.data.isValid).toBe(true);
  });

  it("異常系: 不正な JWS 形式 (3 パート未満) で BILLING_IAP_RECEIPT_INVALID", async () => {
    const transaction = makeTransaction({ signedJws: "only.two" });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: Base64URL デコード失敗 で BILLING_IAP_RECEIPT_INVALID", async () => {
    const transaction = makeTransaction({ signedJws: "header.!!!invalid!!!.sig" });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: 未知の productId で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({
      productId: "com.unknown.product",
    });
    const transaction = makeTransaction({
      signedJws: signAppleJws(payload),
      productId: "com.unknown.product",
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: originalTransactionId 不一致 で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({ originalTransactionId: "orig_tx_DIFFERENT" });
    const transaction = makeTransaction({
      signedJws: signAppleJws(payload),
      originalTransactionId: "orig_tx_001", // JWS の値と不一致
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: 有効期限切れ transaction で BILLING_IAP_RECEIPT_INVALID", async () => {
    const payload = makeValidJwsPayload({
      expiresDate: Date.now() - 1000, // 過去
    });
    const transaction = makeTransaction({
      signedJws: signAppleJws(payload),
      expirationDate: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });
});

describe("IapAdapter.verifyIapTransaction — x5c 証明書チェーンによる署名検証 (#40)", () => {
  it("正常系: x5c チェーンが正しく署名された JWS は検証を通過する", async () => {
    const adapter = createIapAdapter();
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(true);
  });

  it("正常系: trustedRootCertsPem に一致するルート証明書は root pinning を通過する", async () => {
    const chain = getAppleJwsTestChain();
    const adapter = createIapAdapter({ trustedRootCertsPem: [chain.rootCertPem] });
    const transaction = makeTransaction({ signedJws: signAppleJws(makeValidJwsPayload(), chain) });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(true);
  });

  it("異常系: trustedRootCertsPem に一致しないルート証明書は BILLING_IAP_RECEIPT_INVALID (root pinning 失敗)", async () => {
    const untrustedChain = generateAppleJwsTestChain();
    const adapter = createIapAdapter({ trustedRootCertsPem: [untrustedChain.rootCertPem] });
    // adapter に渡す trustedRootCertsPem とは別のテストチェーンで署名 (ルート不一致)
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: 署名 (signature 部分) が改竄されている場合は検証に失敗する (改竄検知)", async () => {
    const adapter = createIapAdapter();
    const validJws = signAppleJws(makeValidJwsPayload());
    const tamperedJws = tamperJwsSignature(validJws);
    const transaction = makeTransaction({ signedJws: tamperedJws });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    expect(result.error.message).toContain("署名");
  });

  it("異常系: payload (本文) が改竄されている場合は署名検証に失敗する (改竄検知)", async () => {
    const adapter = createIapAdapter();
    const validJws = signAppleJws(makeValidJwsPayload());
    const parts = validJws.split(".");
    // payload だけ別内容に差し替える (署名はそのまま) → 署名検証は失敗するはず
    const tamperedPayload = Buffer.from(
      JSON.stringify(makeValidJwsPayload({ productId: "com.trancall.subscription.business.monthly" })),
    ).toString("base64url");
    const tamperedJws = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const transaction = makeTransaction({ signedJws: tamperedJws });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: x5c チェーンのリンクが不正な場合 (leaf が issuer に署名されていない) は検証に失敗する", async () => {
    const adapter = createIapAdapter();
    const brokenJws = signAppleJwsWithBrokenChain(makeValidJwsPayload());
    const transaction = makeTransaction({ signedJws: brokenJws });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: header に x5c が存在しない場合は BILLING_IAP_RECEIPT_INVALID", async () => {
    const adapter = createIapAdapter();
    const chain = getAppleJwsTestChain();
    const jws = signAppleJwsRaw(makeValidJwsPayload(), { alg: "ES256" }, chain.leafPrivateKeyPem);
    const transaction = makeTransaction({ signedJws: jws });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
    expect(result.error.message).toContain("x5c");
  });

  it("異常系: 未対応の alg (ES256 以外) は BILLING_IAP_RECEIPT_INVALID", async () => {
    const adapter = createIapAdapter();
    const chain = getAppleJwsTestChain();
    const jws = signAppleJwsRaw(
      makeValidJwsPayload(),
      { alg: "RS256", x5c: chain.x5cChain },
      chain.leafPrivateKeyPem,
    );
    const transaction = makeTransaction({ signedJws: jws });

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("異常系: bundleId が config と不一致の場合は BILLING_IAP_RECEIPT_INVALID", async () => {
    const adapter = createIapAdapter({ bundleId: "com.trancall.app.other" });
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });

  it("正常系: bundleId が config と一致する場合は通過する", async () => {
    const adapter = createIapAdapter({ bundleId: "com.trancall.app" });
    const transaction = makeTransaction();

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(true);
  });

  it("異常系: environment が config と不一致の場合は BILLING_IAP_RECEIPT_INVALID", async () => {
    const adapter = createIapAdapter({ environment: "Sandbox" });
    const transaction = makeTransaction(); // payload.environment = "Production"

    const result = await adapter.verifyIapTransaction(transaction);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_IAP_RECEIPT_INVALID");
  });
});

describe("IapAdapter.resolveTier", () => {
  const adapter = createIapAdapter();

  it("既知の productId を PlanTier に解決できる", () => {
    expect(adapter.resolveTier("com.trancall.subscription.light.monthly")).toBe("light");
    expect(adapter.resolveTier("com.trancall.subscription.standard.monthly")).toBe("standard");
    expect(adapter.resolveTier("com.trancall.subscription.business.monthly")).toBe("business");
  });

  it("未知の productId は null を返す", () => {
    expect(adapter.resolveTier("com.unknown.product")).toBeNull();
  });
});

describe("IapAdapter.selectLatestTransaction", () => {
  const adapter = createIapAdapter();

  it("空配列は null を返す", () => {
    expect(adapter.selectLatestTransaction([])).toBeNull();
  });

  it("1 件はそのまま返す", () => {
    const tx = {
      originalTransactionId: "tx_001",
      productId: "com.trancall.subscription.light.monthly",
      tier: "light" as const,
      purchaseDate: "2026-05-01T00:00:00.000Z",
      expirationDate: "2026-06-01T00:00:00.000Z",
      isValid: true,
    };
    expect(adapter.selectLatestTransaction([tx])).toEqual(tx);
  });

  it("複数件から purchaseDate が最新のものを返す", () => {
    const older = {
      originalTransactionId: "tx_001",
      productId: "com.trancall.subscription.light.monthly",
      tier: "light" as const,
      purchaseDate: "2026-04-01T00:00:00.000Z",
      expirationDate: "2026-05-01T00:00:00.000Z",
      isValid: true,
    };
    const newer = {
      originalTransactionId: "tx_002",
      productId: "com.trancall.subscription.standard.monthly",
      tier: "standard" as const,
      purchaseDate: "2026-05-01T00:00:00.000Z",
      expirationDate: "2026-06-01T00:00:00.000Z",
      isValid: true,
    };
    expect(adapter.selectLatestTransaction([older, newer])).toEqual(newer);
    expect(adapter.selectLatestTransaction([newer, older])).toEqual(newer);
  });
});
