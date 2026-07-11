/**
 * @trancall/contact — ユニットテスト
 *
 * テストはインメモリのリポジトリ実装を使用する。
 * DB 接続不要で完結する。
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  UserIdSchema,
  type UserId,
} from "@trancall/shared-kernel";

import type { ContactRepository } from "../src/repositories/contact-repository.js";
import type { BlockRepository } from "../src/repositories/block-repository.js";
import type { InviteRepository, InviteLink } from "../src/repositories/invite-repository.js";
import type { ProfileSearchRepository } from "../src/repositories/profile-search-repository.js";
import type { ReportRepository } from "../src/repositories/report-repository.js";

import { createContactService } from "../src/services/contact-service.js";
import { createBlockService } from "../src/services/block-service.js";
import { createSearchService } from "../src/services/search-service.js";
import { createInviteService } from "../src/services/invite-service.js";

import type { ContactEntry, PublicProfile, ReportUserCommand } from "../src/schemas.js";
import type { AppError, Result } from "@trancall/shared-kernel";

// =============================================================================
// ヘルパー: Branded UserId を生成する
// =============================================================================

function uid(raw: string): UserId {
  const result = UserIdSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid UUID: ${raw}`);
  return result.data;
}

const USER_A = uid("a0000000-0000-4000-8000-000000000001");
const USER_B = uid("b0000000-0000-4000-8000-000000000002");
const USER_C = uid("c0000000-0000-4000-8000-000000000003");

// =============================================================================
// インメモリリポジトリ実装
// =============================================================================

function makeContactRepo(): ContactRepository {
  const contacts = new Map<string, ContactEntry>();
  let seq = 0;

  return {
    add: async (userId, contactUserId) => {
      const key = `${userId}:${contactUserId}`;
      const contactId = `contact-${++seq}`;
      const entry: ContactEntry = {
        contactId,
        userId,
        contactUserId,
        displayName: "テストユーザー",
        nativeLanguage: "ja",
        avatarUrl: null,
        addedAt: new Date().toISOString(),
        isFavorite: false,
        trancallId: "testuser",
      };
      contacts.set(key, entry);
      return { ok: true, data: entry };
    },

    remove: async (userId, contactId) => {
      for (const [key, entry] of contacts.entries()) {
        if (entry.userId === userId && entry.contactId === contactId) {
          contacts.delete(key);
          return { ok: true, data: true as const };
        }
      }
      return {
        ok: false,
        error: {
          code: "CONTACT_NOT_FOUND",
          message: "連絡先が見つかりません",
          retryable: false,
        },
      };
    },

    list: async (userId) => {
      return { ok: true, data: Array.from(contacts.values()).filter((e) => e.userId === userId) };
    },

    exists: async (userId, contactUserId) => {
      const key = `${userId}:${contactUserId}`;
      return contacts.has(key);
    },

    toggleFavorite: async (userId, contactId) => {
      for (const entry of contacts.values()) {
        if (entry.userId === userId && entry.contactId === contactId) {
          entry.isFavorite = !entry.isFavorite;
          return { ok: true, data: true as const };
        }
      }
      return {
        ok: false,
        error: {
          code: "CONTACT_NOT_FOUND",
          message: "連絡先が見つかりません",
          retryable: false,
        },
      };
    },
  };
}

function makeBlockRepo(): BlockRepository {
  // blocked = Map<userId, Set<blockedUserId>>
  const blocked = new Map<string, Set<string>>();

  return {
    block: async (userId, blockedUserId, _reason) => {
      if (!blocked.has(userId)) {
        blocked.set(userId, new Set());
      }
      blocked.get(userId)!.add(blockedUserId);
      return { ok: true, data: true as const };
    },

    unblock: async (userId, blockedUserId) => {
      blocked.get(userId)?.delete(blockedUserId);
      return { ok: true, data: true as const };
    },

    isBlocked: async (userId, targetUserId) => {
      return (
        (blocked.get(userId)?.has(targetUserId) ?? false) ||
        (blocked.get(targetUserId)?.has(userId) ?? false)
      );
    },

    getBlockedUserIds: async (userId) => {
      return new Set(blocked.get(userId) ?? []);
    },
  };
}

function makeInviteRepo(): InviteRepository {
  const invites = new Map<string, InviteLink>();

  return {
    create: async (userId, token, expiresAt) => {
      const invite: InviteLink = {
        id: crypto.randomUUID(),
        userId,
        token,
        expiresAt: expiresAt.toISOString(),
        usedBy: null,
        usedAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      invites.set(token, invite);
      return { ok: true, data: invite };
    },

    findByToken: async (token) => {
      return invites.get(token) ?? null;
    },

    markUsed: async (token, usedBy) => {
      const invite = invites.get(token);
      if (!invite) {
        return {
          ok: false,
          error: {
            code: "CONTACT_NOT_FOUND",
            message: "招待リンクが見つかりません",
            retryable: false,
          },
        };
      }
      invite.usedBy = usedBy;
      invite.usedAt = new Date().toISOString();
      return { ok: true, data: true as const };
    },
  };
}

function makeProfileSearchRepo(profiles: PublicProfile[]): ProfileSearchRepository {
  return {
    findByTrancallId: async (trancallId) => {
      return profiles.find((p) => p.trancallId === trancallId) ?? null;
    },

    searchByDisplayName: async (query) => {
      const q = query.toLowerCase();
      return profiles.filter((p) =>
        p.displayName.toLowerCase().includes(q),
      );
    },
  };
}

function makeReportRepo(): ReportRepository {
  const reports = new Set<string>();
  return {
    create: async (_cmd) => {
      return { ok: true, data: true as const };
    },
    exists: async (reporterId, reportedId) => {
      return reports.has(`${reporterId}:${reportedId}`);
    },
  };
}

// =============================================================================
// contact-service テスト
// =============================================================================

describe("contact-service", () => {
  let contactRepo: ContactRepository;
  let blockRepo: BlockRepository;

  beforeEach(() => {
    contactRepo = makeContactRepo();
    blockRepo = makeBlockRepo();
  });

  it("正常系: 連絡先を追加できる", async () => {
    const service = createContactService(contactRepo, blockRepo);
    const result = await service.addContact(USER_A, USER_B);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.userId).toBe(USER_A);
      expect(result.data.contactUserId).toBe(USER_B);
    }
  });

  it("自分自身を追加しようとすると CONTACT_SELF_ADD エラー", async () => {
    const service = createContactService(contactRepo, blockRepo);
    const result = await service.addContact(USER_A, USER_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONTACT_SELF_ADD");
    }
  });

  it("すでに存在する連絡先を追加すると CONTACT_ALREADY_EXISTS エラー", async () => {
    const service = createContactService(contactRepo, blockRepo);
    await service.addContact(USER_A, USER_B);
    const result = await service.addContact(USER_A, USER_B);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONTACT_ALREADY_EXISTS");
    }
  });

  it("ブロック済みユーザーを追加すると CONTACT_USER_BLOCKED エラー", async () => {
    const service = createContactService(contactRepo, blockRepo);
    // USER_A が USER_B をブロック
    await blockRepo.block(USER_A, USER_B);
    const result = await service.addContact(USER_A, USER_B);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONTACT_USER_BLOCKED");
    }
  });
});

// =============================================================================
// block-service テスト
// =============================================================================

describe("block-service", () => {
  let blockRepo: BlockRepository;
  let profileSearchRepo: ProfileSearchRepository;

  beforeEach(() => {
    blockRepo = makeBlockRepo();
    profileSearchRepo = makeProfileSearchRepo([
      {
        userId: USER_B,
        trancallId: "userb",
        displayName: "ユーザーB",
        nativeLanguage: "ja",
        avatarUrl: null,
      },
      {
        userId: USER_C,
        trancallId: "userc",
        displayName: "ユーザーC",
        nativeLanguage: "en",
        avatarUrl: null,
      },
    ]);
  });

  it("blockUser → 検索結果からブロック済みユーザーが除外される", async () => {
    const blockService = createBlockService(blockRepo);
    const searchService = createSearchService(profileSearchRepo, blockRepo);

    // USER_A が USER_B をブロック
    await blockService.blockUser({
      userId: USER_A,
      blockedUserId: USER_B,
    });

    const results = await searchService.searchUsers("ユーザー", USER_A);
    const ids = results.map((r) => r.userId);
    expect(ids).not.toContain(USER_B);
    expect(ids).toContain(USER_C);
  });

  it("unblockUser → ブロック解除後に検索結果に表示される", async () => {
    const blockService = createBlockService(blockRepo);
    const searchService = createSearchService(profileSearchRepo, blockRepo);

    await blockService.blockUser({ userId: USER_A, blockedUserId: USER_B });
    await blockService.unblockUser(USER_A, USER_B);

    const results = await searchService.searchUsers("ユーザー", USER_A);
    const ids = results.map((r) => r.userId);
    expect(ids).toContain(USER_B);
  });
});

// =============================================================================
// invite-service テスト
// =============================================================================

describe("invite-service", () => {
  it("createInviteLink: token が 30 文字で URL が正しい", async () => {
    const inviteRepo = makeInviteRepo();
    const contactRepo = makeContactRepo();
    const service = createInviteService(inviteRepo, contactRepo);

    const result = await service.createInviteLink(USER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.token).toHaveLength(30);
      expect(result.data.url).toBe(
        `https://trancall.app/invite/${result.data.token}`,
      );
      // expiresAt は 7 日後以降
      const expiresAt = new Date(result.data.expiresAt);
      const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 1000);
      expect(expiresAt.getTime()).toBeGreaterThan(sevenDaysLater.getTime());
    }
  });

  it("Issue #72.3: baseUrl オプションを渡すと URL に反映される (ハードコード解消)", async () => {
    const inviteRepo = makeInviteRepo();
    const contactRepo = makeContactRepo();
    const service = createInviteService(inviteRepo, contactRepo, {
      baseUrl: "https://staging.trancall.app/invite",
    });

    const result = await service.createInviteLink(USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.url).toBe(`https://staging.trancall.app/invite/${result.data.token}`);
  });

  it("consumeInviteLink: 双方向 INSERT が行われる", async () => {
    const inviteRepo = makeInviteRepo();
    const contactRepo = makeContactRepo();
    const service = createInviteService(inviteRepo, contactRepo);

    // USER_A が招待リンクを作成
    const createResult = await service.createInviteLink(USER_A);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // USER_B がリンクを消費
    const consumeResult = await service.consumeInviteLink(
      createResult.data.token,
      USER_B,
    );
    expect(consumeResult.ok).toBe(true);

    // 双方向連絡先が存在するか確認
    const aContactsResult = await contactRepo.list(USER_A);
    const bContactsResult = await contactRepo.list(USER_B);
    expect(aContactsResult.ok).toBe(true);
    expect(bContactsResult.ok).toBe(true);
    if (!aContactsResult.ok || !bContactsResult.ok) return;
    expect(aContactsResult.data.some((c) => c.contactUserId === USER_B)).toBe(true);
    expect(bContactsResult.data.some((c) => c.contactUserId === USER_A)).toBe(true);
  });
});

// =============================================================================
// search-service テスト
// =============================================================================

describe("search-service", () => {
  const profiles: PublicProfile[] = [
    {
      userId: USER_A,
      trancallId: "usera",
      displayName: "山田太郎",
      nativeLanguage: "ja",
      avatarUrl: null,
    },
    {
      userId: USER_B,
      trancallId: "userb",
      displayName: "田中花子",
      nativeLanguage: "ja",
      avatarUrl: null,
    },
    {
      userId: USER_C,
      trancallId: "userc",
      displayName: "Smith John",
      nativeLanguage: "en",
      avatarUrl: null,
    },
  ];

  let blockRepo: BlockRepository;
  let searchRepo: ProfileSearchRepository;

  beforeEach(() => {
    blockRepo = makeBlockRepo();
    searchRepo = makeProfileSearchRepo(profiles);
  });

  it("TranCall ID 完全一致で検索できる", async () => {
    const service = createSearchService(searchRepo, blockRepo);
    const results = await service.searchUsers("userb", USER_A);
    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe(USER_B);
  });

  it("表示名部分一致で検索できる", async () => {
    const service = createSearchService(searchRepo, blockRepo);
    const results = await service.searchUsers("太郎", USER_B);
    expect(results.some((r) => r.userId === USER_A)).toBe(true);
  });

  it("自分自身は検索結果に含まれない", async () => {
    const service = createSearchService(searchRepo, blockRepo);
    // USER_A として検索して "山田太郎" を検索（自分のプロフィール）
    const results = await service.searchUsers("山田", USER_A);
    expect(results.every((r) => r.userId !== USER_A)).toBe(true);
  });

  it("ブロック済みユーザーは検索結果に含まれない", async () => {
    // USER_A (caller) が USER_B をブロック
    await blockRepo.block(USER_A, USER_B);

    const service = createSearchService(searchRepo, blockRepo);
    const results = await service.searchUsers("田中", USER_A);
    expect(results.every((r) => r.userId !== USER_B)).toBe(true);
  });
});
