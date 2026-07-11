/**
 * AccessService テスト
 *
 * 1. deleteAccess: deleted_at がセットされる
 * 2. deleteAccess: 相手のアクセスは維持される
 * 3. deleteAccess: 既に削除済みの場合は冪等に ok を返す
 * 4. deleteAccess: access が存在しない場合は NOT_FOUND
 * 5. canView: can_view=true AND deleted_at IS NULL → true
 * 6. canView: deleted_at がセット済みの場合は false
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createAccessService } from "../src/services/access-service.js";
import { InMemoryAccessRepository } from "./helpers/stubs.js";
import {
  makeAccessRecord,
  ROOM_ID,
  USER_A,
  USER_B,
} from "./helpers/fixtures.js";

describe("AccessService", () => {
  let repo: InMemoryAccessRepository;
  let service: ReturnType<typeof createAccessService>;

  beforeEach(() => {
    repo = new InMemoryAccessRepository();
    service = createAccessService(repo);
  });

  it("test-1: deleteAccess で自分の deleted_at がセットされる", async () => {
    repo.addRecord(makeAccessRecord(USER_A));
    const result = await service.deleteAccess(ROOM_ID, USER_A);
    expect(result.ok).toBe(true);

    // deleted_at が設定されている確認
    const findResult = await repo.findOne(ROOM_ID, USER_A);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data.deletedAt).not.toBeNull();
    }
  });

  it("test-2: deleteAccess で相手のアクセスは維持される", async () => {
    repo.addRecord(makeAccessRecord(USER_A));
    repo.addRecord(
      makeAccessRecord(USER_B, { id: "f47ac10b-58cc-4372-a567-0e02b2c3d420" }),
    );

    await service.deleteAccess(ROOM_ID, USER_A);

    // USER_B のアクセスは維持されている
    const findResult = await repo.findOne(ROOM_ID, USER_B);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data.deletedAt).toBeNull();
      expect(findResult.data.canView).toBe(true);
    }
  });

  it("test-3: 既に削除済みの場合は冪等に ok を返す", async () => {
    repo.addRecord(
      makeAccessRecord(USER_A, {
        deletedAt: new Date().toISOString(),
      }),
    );
    const result = await service.deleteAccess(ROOM_ID, USER_A);
    expect(result.ok).toBe(true);
  });

  it("test-4: access が存在しない場合は NOT_FOUND を返す", async () => {
    const result = await service.deleteAccess(ROOM_ID, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("test-5: canView: can_view=true AND deleted_at IS NULL → true", async () => {
    repo.addRecord(makeAccessRecord(USER_A, { canView: true, deletedAt: null }));
    const result = await service.canView(ROOM_ID, USER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });

  it("test-6: canView: deleted_at セット済みは false を返す", async () => {
    repo.addRecord(
      makeAccessRecord(USER_A, {
        canView: true,
        deletedAt: new Date().toISOString(),
      }),
    );
    const result = await service.canView(ROOM_ID, USER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(false);
    }
  });

  // ===========================================================================
  // Issue #69 (2): grantAccess
  // ===========================================================================

  it("test-7: grantAccess で新規 transcript_access が作成される (can_view=true)", async () => {
    const result = await service.grantAccess(ROOM_ID, USER_A, "v1.0");
    expect(result.ok).toBe(true);

    const findResult = await repo.findOne(ROOM_ID, USER_A);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data.canView).toBe(true);
      expect(findResult.data.canExport).toBe(false);
      expect(findResult.data.deletedAt).toBeNull();
      expect(findResult.data.consentVersion).toBe("v1.0");
    }
  });

  it("test-8: grantAccess は冪等 (既存行があれば何もしない)", async () => {
    repo.addRecord(makeAccessRecord(USER_A, { consentVersion: "v1.0" }));

    const result = await service.grantAccess(ROOM_ID, USER_A, "v2.0");
    expect(result.ok).toBe(true);

    const findResult = await repo.findOne(ROOM_ID, USER_A);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      // 既存行の consentVersion は上書きされない (v1.0 のまま)
      expect(findResult.data.consentVersion).toBe("v1.0");
    }
  });

  it("test-9: grantAccess は明示的に deleteAccess 済みのアクセスを復活させない", async () => {
    repo.addRecord(
      makeAccessRecord(USER_A, { deletedAt: new Date().toISOString() }),
    );

    const result = await service.grantAccess(ROOM_ID, USER_A, "v1.0");
    expect(result.ok).toBe(true);

    const findResult = await repo.findOne(ROOM_ID, USER_A);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      // deleted_at が復活していないこと (grant は insert-if-absent のみ)
      expect(findResult.data.deletedAt).not.toBeNull();
    }
  });

  it("test-10: grantAccess は相手のアクセスに影響しない", async () => {
    repo.addRecord(makeAccessRecord(USER_B));

    await service.grantAccess(ROOM_ID, USER_A, "v1.0");

    const findResult = await repo.findOne(ROOM_ID, USER_B);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data.deletedAt).toBeNull();
    }
  });

  it("test-11: grantAccess は consentVersion が空文字なら VALIDATION_ERROR", async () => {
    const result = await service.grantAccess(ROOM_ID, USER_A, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
