/**
 * AuthFacade 新規書き込みメソッドのテスト
 *
 * - publishUserRegistered (Issue #67)
 * - updateProfile / getProfileDeletionStatus /
 *   setProfileDeletedAt (Issue #72.1: facade バイパス是正)
 *
 * Issue #78: recordLegacyConsentVersion (LegacyConsentRepository) はレガシー
 * `POST /api/auth/consent` の三重の契約不一致 (mobile ペイロード不一致 → 400 /
 * consent_versions スキーマ不整合 → 500 / レスポンス形状不一致) を受けて
 * レガシー route ごと削除した。関連テストも削除済み。
 */

import { describe, expect, it, vi } from "vitest";

import { brandUserId, type UserId } from "@trancall/shared-kernel";

import { createAuthFacade, type AuthEventBus } from "../src/facade.js";
import { type ProfileRepository } from "../src/facade.js";
import { type ProfileWriteRepository } from "../src/repositories/profile-write-repository.js";
import { type ProfileDeletionRepository } from "../src/repositories/profile-deletion-repository.js";
import { type Profile } from "../src/schemas.js";

function makeUserId(): UserId {
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

function makeProfileRepo(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ ok: true, data: validProfile }),
    ...overrides,
  };
}

function makeEventBus(): AuthEventBus {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

// ============================================================
// publishUserRegistered (Issue #67)
// ============================================================

describe("AuthFacade.publishUserRegistered", () => {
  it("正常系: eventBus に auth.user_registered を発行する", async () => {
    const userId = makeUserId();
    const eventBus = makeEventBus();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), eventBus });

    const result = await facade.publishUserRegistered(userId, "test@example.com", "ja");

    expect(result.ok).toBe(true);
    expect(eventBus.publish).toHaveBeenCalledOnce();
    const publishedEvent = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(publishedEvent?.type).toBe("auth.user_registered");
    expect(publishedEvent?.payload.userId).toBe(userId);
    expect(publishedEvent?.payload.email).toBe("test@example.com");
    expect(publishedEvent?.payload.nativeLanguage).toBe("ja");
  });

  it("eventBus 未設定時はサイレントに ok(true) を返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo() });

    const result = await facade.publishUserRegistered(userId, "test@example.com", "ja");

    expect(result.ok).toBe(true);
  });

  it("不正な nativeLanguage は発行をスキップしつつ ok(true) を返す (サインアップを止めない)", async () => {
    const userId = makeUserId();
    const eventBus = makeEventBus();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), eventBus });

    const result = await facade.publishUserRegistered(userId, "test@example.com", "klingon");

    expect(result.ok).toBe(true);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it("eventBus.publish が例外を投げてもサイレントに ok(true) を返す", async () => {
    const userId = makeUserId();
    const eventBus: AuthEventBus = { publish: vi.fn().mockRejectedValue(new Error("接続失敗")) };
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), eventBus });

    const result = await facade.publishUserRegistered(userId, "test@example.com", "ja");

    expect(result.ok).toBe(true);
  });
});

// ============================================================
// updateProfile (Issue #72.1)
// ============================================================

describe("AuthFacade.updateProfile", () => {
  function makeProfileWriteRepo(overrides: Partial<ProfileWriteRepository> = {}): ProfileWriteRepository {
    return {
      update: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      ...overrides,
    };
  }

  it("正常系: 書き込み後、最新の Profile を再取得して返す", async () => {
    const userId = makeUserId();
    const profileWriteRepo = makeProfileWriteRepo();
    const profileRepo = makeProfileRepo({
      findByUserId: vi.fn().mockResolvedValue({ ok: true, data: { ...validProfile, displayName: "新しい名前" } }),
    });
    const facade = createAuthFacade({ profileRepo, profileWriteRepo });

    const result = await facade.updateProfile(userId, { displayName: "新しい名前" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.displayName).toBe("新しい名前");
    expect(profileWriteRepo.update).toHaveBeenCalledWith(userId, { displayName: "新しい名前" });
  });

  it("profileWriteRepo 未設定時は AUTH_PROFILE_WRITE_NOT_CONFIGURED を返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo() });

    const result = await facade.updateProfile(userId, { displayName: "x" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_PROFILE_WRITE_NOT_CONFIGURED");
  });

  it("書き込み失敗時はそのままエラーを伝播する", async () => {
    const userId = makeUserId();
    const profileWriteRepo = makeProfileWriteRepo({
      update: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "DB 障害", retryable: true },
      }),
    });
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), profileWriteRepo });

    const result = await facade.updateProfile(userId, { displayName: "x" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});

// ============================================================
// getProfileDeletionStatus / setProfileDeletedAt (Issue #72.1)
// ============================================================

describe("AuthFacade.getProfileDeletionStatus / setProfileDeletedAt", () => {
  function makeProfileDeletionRepo(
    overrides: Partial<ProfileDeletionRepository> = {},
  ): ProfileDeletionRepository {
    return {
      findStatus: vi.fn().mockResolvedValue({ ok: true, data: null }),
      setDeletedAt: vi.fn().mockResolvedValue({ ok: true, data: true }),
      ...overrides,
    };
  }

  it("getProfileDeletionStatus: 正常系", async () => {
    const userId = makeUserId();
    const profileDeletionRepo = makeProfileDeletionRepo({
      findStatus: vi.fn().mockResolvedValue({ ok: true, data: { deletedAt: "2026-06-01T00:00:00.000Z" } }),
    });
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), profileDeletionRepo });

    const result = await facade.getProfileDeletionStatus(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.deletedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("getProfileDeletionStatus: 未設定時はエラーを返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo() });

    const result = await facade.getProfileDeletionStatus(userId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_PROFILE_WRITE_NOT_CONFIGURED");
  });

  it("setProfileDeletedAt: null を渡すと退会解除として repository に渡す", async () => {
    const userId = makeUserId();
    const profileDeletionRepo = makeProfileDeletionRepo();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo(), profileDeletionRepo });

    const result = await facade.setProfileDeletedAt(userId, null);

    expect(result.ok).toBe(true);
    expect(profileDeletionRepo.setDeletedAt).toHaveBeenCalledWith(userId, null);
  });

  it("setProfileDeletedAt: 未設定時はエラーを返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: makeProfileRepo() });

    const result = await facade.setProfileDeletedAt(userId, "2026-06-01T00:00:00.000Z");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_PROFILE_WRITE_NOT_CONFIGURED");
  });
});
