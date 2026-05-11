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

import { createAuthFacade, type ProfileRepository } from "../src/facade.js";
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

describe("createAuthFacade.getProfile", () => {
  it("リポジトリの戻り値をそのまま返す（正常系）", async () => {
    const repo: ProfileRepository = {
      findByUserId: vi
        .fn<(userId: UserId) => Promise<Result<Profile, AppError>>>()
        .mockResolvedValue({ ok: true, data: validProfile }),
    };
    const facade = createAuthFacade(repo);

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
        .fn<(userId: UserId) => Promise<Result<Profile, AppError>>>()
        .mockResolvedValue({ ok: false, error: upstreamError }),
    };
    const facade = createAuthFacade(repo);

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
        .fn<(userId: UserId) => Promise<Result<Profile, AppError>>>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockResolvedValue({ ok: true, data: invalidProfile as any }),
    };
    const facade = createAuthFacade(repo);

    const result = await facade.getProfile(makeUserId());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth.profile.invalid_schema");
  });
});
