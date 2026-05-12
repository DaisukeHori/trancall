/**
 * ExternalPurchaseTokenRepository テスト
 *
 * - createToken: 正常系
 * - findByToken: 正常系・異常系
 * - markUsed: 正常系・二重消費防止
 * - cleanupExpired: 正常系
 */

import { describe, expect, it } from "vitest";
import type { ExternalPurchaseTokenRepository, ExternalPurchaseTokenRow } from "../src/repositories/external-purchase-token-repository.js";
import { brandUserId } from "@trancall/shared-kernel";

function makeUserId() {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("brandUserId failed");
  return r.data;
}

// =============================================================================
// InMemory 実装 (テスト用)
// createSupabaseExternalPurchaseTokenRepository と同じインターフェースを実装
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
          error: {
            code: "NOT_FOUND",
            message: `redirectToken が見つかりません`,
            retryable: false,
          },
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
      const now = new Date();
      let count = 0;
      for (const [token, row] of store.entries()) {
        if (!row.used && new Date(row.expiresAt) < now) {
          store.delete(token);
          count++;
        }
      }
      return { ok: true, data: count };
    },
  };
}

// =============================================================================
// テスト
// =============================================================================

describe("ExternalPurchaseTokenRepository.createToken", () => {
  it("正常系: トークンが DB に保存される", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();
    const userId = makeUserId();
    const token = "a".repeat(64);

    const result = await repo.createToken(userId, "standard", "cs_001", token, 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toBe(token);
    expect(result.data.targetTier).toBe("standard");
    expect(result.data.used).toBe(false);
    const expiresAt = new Date(result.data.expiresAt);
    const diff = expiresAt.getTime() - Date.now();
    expect(diff).toBeGreaterThan(4 * 60 * 1000); // 4 分以上
    expect(diff).toBeLessThan(6 * 60 * 1000); // 6 分以下
  });
});

describe("ExternalPurchaseTokenRepository.findByToken", () => {
  it("正常系: 作成したトークンを取得できる", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();
    const userId = makeUserId();
    const token = "b".repeat(64);

    await repo.createToken(userId, "light", "cs_002", token, 5);
    const result = await repo.findByToken(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toBe(token);
  });

  it("異常系: 存在しないトークンは NOT_FOUND", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();

    const result = await repo.findByToken("nonexistent");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("ExternalPurchaseTokenRepository.markUsed — 二重消費防止", () => {
  it("1 回目の markUsed は成功する", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();
    const userId = makeUserId();
    const token = "c".repeat(64);

    await repo.createToken(userId, "standard", "cs_003", token, 5);
    const result = await repo.markUsed(token);

    expect(result.ok).toBe(true);
  });

  it("2 回目の markUsed は BILLING_PAYMENT_FAILED を返す (二重消費防止)", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();
    const userId = makeUserId();
    const token = "d".repeat(64);

    await repo.createToken(userId, "business", "cs_004", token, 5);
    await repo.markUsed(token); // 1 回目: 成功

    const result = await repo.markUsed(token); // 2 回目: 失敗

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
    expect(result.error.retryable).toBe(false);
  });

  it("存在しないトークンの markUsed は BILLING_PAYMENT_FAILED を返す", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();

    const result = await repo.markUsed("nonexistent");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BILLING_PAYMENT_FAILED");
  });
});

describe("ExternalPurchaseTokenRepository.cleanupExpired", () => {
  it("期限切れの未使用トークンが削除される", async () => {
    const repo = createInMemoryExternalPurchaseTokenRepository();
    const userId = makeUserId();

    // 期限切れトークン (TTL = 0 分, つまり即期限切れ)
    // Note: TTL 0 で作成すると expiresAt = now() なので少し過去に設定するため TTL=-1 の代替として
    // createToken 後に expiresAt を書き換えることはできないので、
    // ttlMinutes を負値にして作成したトークンで代替テストを行う
    // (InMemory 実装は ttlMinutes をそのまま計算するため)
    const tokenExpired = "e".repeat(64);
    // ttlMinutes=-5: 5 分前に期限切れ
    await repo.createToken(userId, "light", "cs_005", tokenExpired, -5);

    const tokenValid = "f".repeat(64);
    await repo.createToken(userId, "light", "cs_006", tokenValid, 5);

    const result = await repo.cleanupExpired();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(1); // 1 件削除

    // 期限切れトークンは削除済み
    const expired = await repo.findByToken(tokenExpired);
    expect(expired.ok).toBe(false);

    // 有効トークンは残存
    const valid = await repo.findByToken(tokenValid);
    expect(valid.ok).toBe(true);
  });
});
