/**
 * ExternalPurchaseAdapter テスト
 *
 * - generateRedirectToken / persistRedirectToken: 正常系 (#44: Stripe Checkout Session
 *   作成前にトークンを生成し、作成後 (sessionId 確定後) に DB へ保存する 2 段階構成)
 * - validateAndConsumeRedirectToken:
 *   - 正常系
 *   - TTL 切れ
 *   - 二重消費防止
 *   - #44 所有者不一致 (tokenRow.userId !== callerUserId) の拒否
 */

import { describe, expect, it, beforeEach } from "vitest";
import { brandUserId } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";

import { createExternalPurchaseAdapter } from "../src/adapters/external-purchase-adapter.js";
import type { ExternalPurchaseTokenRepository, ExternalPurchaseTokenRow } from "../src/repositories/external-purchase-token-repository.js";
import type { StoreKitExternalRedirectResult } from "../src/view-models/index.js";

function makeUserId(uuid = "00000000-0000-4000-8000-000000000001"): UserId {
  const r = brandUserId(uuid);
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

// =============================================================================
// InMemory ExternalPurchaseTokenRepository (external-purchase-token-repository.test.ts と同一パターン)
// =============================================================================

function createInMemoryExternalPurchaseTokenRepository(): ExternalPurchaseTokenRepository {
  const store: Map<string, ExternalPurchaseTokenRow> = new Map();
  let idCounter = 0;

  return {
    async createToken(userId, targetTier, stripeSessionId, token, ttlMinutes) {
      const row: ExternalPurchaseTokenRow = {
        id: String(++idCounter),
        userId: userId as string,
        token,
        targetTier,
        stripeSessionId,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      };
      store.set(token, row);
      return { ok: true, data: row };
    },
    async findByToken(token) {
      const row = store.get(token);
      if (!row) {
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "redirectToken が見つかりません", retryable: false },
        };
      }
      return { ok: true, data: { ...row } };
    },
    async markUsed(token) {
      const row = store.get(token);
      if (!row || row.used) {
        return {
          ok: false,
          error: {
            code: "BILLING_PAYMENT_FAILED",
            message: "redirectToken は既に使用済みか存在しません。二重消費を防止しました。",
            retryable: false,
          },
        };
      }
      row.used = true;
      store.set(token, row);
      return { ok: true, data: true };
    },
    async cleanupExpired() {
      return { ok: true, data: 0 };
    },
  };
}

function makeRedirect(overrides: Partial<StoreKitExternalRedirectResult> = {}): StoreKitExternalRedirectResult {
  return {
    redirectToken: "a".repeat(64),
    stripeSubscriptionId: "sub_ext_001",
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// テスト
// =============================================================================

describe("ExternalPurchaseAdapter.generateRedirectToken", () => {
  it("正常系: 64 文字の16進文字列を返す (crypto.randomBytes(32).toString(\"hex\"))", () => {
    const tokenRepo = createInMemoryExternalPurchaseTokenRepository();
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });

    const token = adapter.generateRedirectToken();

    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("正常系: 呼び出すたびに異なるトークンを返す", () => {
    const tokenRepo = createInMemoryExternalPurchaseTokenRepository();
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });

    const token1 = adapter.generateRedirectToken();
    const token2 = adapter.generateRedirectToken();

    expect(token1).not.toBe(token2);
  });
});

describe("ExternalPurchaseAdapter.persistRedirectToken (#44)", () => {
  it("正常系: 事前生成済みトークンをそのまま DB に保存し redirectUrl/redirectToken を返す", async () => {
    const tokenRepo = createInMemoryExternalPurchaseTokenRepository();
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const userId = makeUserId();
    // [#44] Stripe Checkout Session 作成前の生成を模したトークン
    const pregeneratedToken = adapter.generateRedirectToken();

    const result = await adapter.persistRedirectToken(
      userId,
      "standard",
      "https://checkout.stripe.com/test",
      "cs_test_001",
      pregeneratedToken,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.redirectUrl).toBe("https://checkout.stripe.com/test");
    expect(result.data.redirectToken).toBe(pregeneratedToken);

    // DB に実際に保存されていること (validateAndConsumeRedirectToken で検証可能)
    const findResult = await tokenRepo.findByToken(pregeneratedToken);
    expect(findResult.ok).toBe(true);
    if (!findResult.ok) return;
    expect(findResult.data.stripeSessionId).toBe("cs_test_001");
    expect(findResult.data.targetTier).toBe("standard");
  });
});

describe("ExternalPurchaseAdapter.validateAndConsumeRedirectToken", () => {
  let tokenRepo: ExternalPurchaseTokenRepository;
  const owner = makeUserId("00000000-0000-4000-8000-000000000001");
  const attacker = makeUserId("00000000-0000-4000-8000-000000000002");

  beforeEach(() => {
    tokenRepo = createInMemoryExternalPurchaseTokenRepository();
  });

  it("正常系: 所有者本人が消費すると成功し targetTier/stripeSessionId を返す", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const token = "b".repeat(64);
    await tokenRepo.createToken(owner, "standard", "cs_002", token, 5);

    const result = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: token }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.targetTier).toBe("standard");
    expect(result.data.stripeSessionId).toBe("cs_002");
  });

  it("#44 異常系: 所有者と異なる callerUserId (なりすまし) は BILLING_PAYMENT_FAILED で拒否される", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const token = "c".repeat(64);
    await tokenRepo.createToken(owner, "standard", "cs_003", token, 5);

    const result = await adapter.validateAndConsumeRedirectToken(
      attacker,
      makeRedirect({ redirectToken: token }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("#44 正常系: なりすまし拒否後もトークンは消費されておらず、所有者本人は後から正常に消費できる (DoS 防止)", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const token = "d".repeat(64);
    await tokenRepo.createToken(owner, "standard", "cs_004", token, 5);

    const attackerResult = await adapter.validateAndConsumeRedirectToken(
      attacker,
      makeRedirect({ redirectToken: token }),
    );
    expect(attackerResult.ok).toBe(false);

    const ownerResult = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: token }),
    );
    expect(ownerResult.ok).toBe(true);
  });

  it("異常系: TTL 切れの redirectToken は BILLING_PAYMENT_FAILED を返す", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: -5, // 既に期限切れとして作成
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const token = "e".repeat(64);
    await tokenRepo.createToken(owner, "standard", "cs_005", token, -5);

    const result = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: token }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("異常系: 2 回目の消費は BILLING_PAYMENT_FAILED を返す (二重消費防止)", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });
    const token = "f".repeat(64);
    await tokenRepo.createToken(owner, "standard", "cs_006", token, 5);

    const first = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: token }),
    );
    expect(first.ok).toBe(true);

    const second = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: token }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("BILLING_PAYMENT_FAILED");
  });

  it("異常系: 存在しない redirectToken は BILLING_PAYMENT_FAILED を返す", async () => {
    const adapter = createExternalPurchaseAdapter(tokenRepo, {
      redirectTokenTtlMinutes: 5,
      externalSuccessUrl: "trancall://billing/external-success",
    });

    const result = await adapter.validateAndConsumeRedirectToken(
      owner,
      makeRedirect({ redirectToken: "nonexistent".padEnd(64, "0") }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});
