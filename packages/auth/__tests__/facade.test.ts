/**
 * Auth Facade テスト
 *
 * - リポジトリから取得した Profile を Zod で再バリデーション
 * - ストレージとTSスキーマがずれた場合の安全網検証
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  type Result,
  type AppError,
  type UserId,
} from "@trancall/shared-kernel";

import {
  createAuthFacade,
  type ProfileRepository,
  type ConsentRepository,
  type LegalDocumentVersionRepository,
  type AuthEventBus,
} from "../src/facade.js";
import { type Profile } from "../src/schemas.js";

function makeUserId() {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

const validProfile: Profile = {
  userId: makeUserId(),
  email: "hori@example.com",
  displayName: "堀大輔",
  nativeLanguage: "ja",
  trancallId: "hori_test_123",
  updatedAt: "2026-05-12T00:00:00.000Z",
};

/** テスト用の mock ConsentRepository */
function makeConsentRepo(): ConsentRepository {
  return {
    upsert: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    findActive: vi.fn().mockResolvedValue({ ok: true, data: null }),
    revoke: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
}

/** テスト用の mock LegalDocumentVersionRepository */
function makeLegalDocRepo(): LegalDocumentVersionRepository {
  return {
    findLatest: vi.fn().mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "", retryable: false } }),
    findAllLatest: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  };
}

/** テスト用の mock AuthEventBus */
function makeEventBus(): AuthEventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createAuthFacade.getProfile", () => {
  it("リポジトリの戻り値をそのまま返す（正常系）", async () => {
    const repo: ProfileRepository = {
      findByUserId: vi
        .fn<(userId: UserId) => Promise<Result<Profile>>>()
        .mockResolvedValue({ ok: true, data: validProfile }),
    };
    const facade = createAuthFacade({
      profileRepo: repo,
      consentRepo: makeConsentRepo(),
      legalDocRepo: makeLegalDocRepo(),
      eventBus: makeEventBus(),
    });

    const result = await facade.getProfile(makeUserId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(validProfile);
  });

  it("リポジトリ失敗時はエラーをそのまま伝播", async () => {
    const upstreamError: AppError = {
      code: "auth.repo.network_error",
      message: "Supabase 接続失敗",
      retryable: true,
    };
    const repo: ProfileRepository = {
      findByUserId: vi
        .fn<(userId: UserId) => Promise<Result<Profile>>>()
        .mockResolvedValue({ ok: false, error: upstreamError }),
    };
    const facade = createAuthFacade({
      profileRepo: repo,
      consentRepo: makeConsentRepo(),
      legalDocRepo: makeLegalDocRepo(),
      eventBus: makeEventBus(),
    });

    const result = await facade.getProfile(makeUserId());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(upstreamError);
  });

  it("リポジトリが不正なProfileを返した場合はスキーマ違反エラーを返す（安全網）", async () => {
    // DB の native_language カラムに想定外の値が入っていたケース
    const invalidProfile = {
      ...validProfile,
      nativeLanguage: "klingon", // OutputLanguage enum に無い値
    };
    const repo: ProfileRepository = {
      findByUserId: vi
        .fn<(userId: UserId) => Promise<Result<Profile>>>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue({ ok: true, data: invalidProfile as any }),
    };
    const facade = createAuthFacade({
      profileRepo: repo,
      consentRepo: makeConsentRepo(),
      legalDocRepo: makeLegalDocRepo(),
      eventBus: makeEventBus(),
    });

    const result = await facade.getProfile(makeUserId());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth.profile.invalid_schema");
  });
});
