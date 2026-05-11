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
});
