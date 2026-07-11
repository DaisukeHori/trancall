/**
 * シナリオ 3: contact ブロック・招待リンク テスト (3 件)
 *
 * - A が B をブロック → A.searchUsers で B が結果から除外
 * - A が B をブロック → B が A に addContact すると CONTACT_USER_BLOCKED
 * - A が招待リンク作成 → B が consume → A と B が相互に contacts に追加
 */

import { describe, it, expect } from "vitest";
import {
  brandUserId,
} from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";
import type { Profile } from "@trancall/auth";
import type { PublicProfile } from "@trancall/contact";
import { buildFacades } from "../src/mocks/build-facades.js";

// ---- helpers ----

function uid(n: number): UserId {
  const r = brandUserId(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  if (!r.success) throw new Error(`brandUserId failed`);
  return r.data;
}

function makeProfile(userId: UserId, name: string): Profile {
  return {
    userId,
    email: `${name}@example.com`,
    displayName: name,
    nativeLanguage: "ja",
    trancallId: name.toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
}

function makePublicProfile(userId: UserId, name: string): PublicProfile {
  return {
    userId,
    trancallId: name.toLowerCase(),
    displayName: name,
    nativeLanguage: "ja",
    avatarUrl: null,
  };
}

describe("シナリオ 3: contact ブロック・招待リンク", () => {
  const userA = uid(1);
  const userB = uid(2);

  it("3-1: A が B をブロック → searchUsers で B が除外される", async () => {
    const { facades } = buildFacades({
      profiles: [makeProfile(userA, "Alice"), makeProfile(userB, "Bob")],
      searchableProfiles: [makePublicProfile(userA, "Alice"), makePublicProfile(userB, "Bob")],
    });

    // ブロック前: A が "Bob" で検索すると B が出る
    const beforeBlock = await facades.contact.searchUsers("Bob", userA);
    expect(beforeBlock.some((p) => p.userId === userB)).toBe(true);

    // A が B をブロック
    const blockResult = await facades.contact.blockUser({ userId: userA, blockedUserId: userB });
    expect(blockResult.ok).toBe(true);

    // ブロック後: A が "Bob" で検索すると B が除外される
    const afterBlock = await facades.contact.searchUsers("Bob", userA);
    expect(afterBlock.some((p) => p.userId === userB)).toBe(false);
  });

  it("3-2: A が B をブロック → B が A に addContact すると CONTACT_USER_BLOCKED (双方向ブロック検出)", async () => {
    const { facades } = buildFacades({
      profiles: [makeProfile(userA, "Alice"), makeProfile(userB, "Bob")],
    });

    // A が B をブロック
    await facades.contact.blockUser({ userId: userA, blockedUserId: userB });

    // B が A に addContact しようとする
    const addResult = await facades.contact.addContact({
      userId: userB,
      contactUserId: userA,
    });

    expect(addResult.ok).toBe(false);
    if (addResult.ok) return;
    expect(addResult.error.code).toBe("CONTACT_USER_BLOCKED");
  });

  it("3-3: A が招待リンク作成 → B が consume → A と B が相互に contacts に追加", async () => {
    const { facades } = buildFacades({
      profiles: [makeProfile(userA, "Alice"), makeProfile(userB, "Bob")],
    });

    // A が招待リンクを作成
    const createResult = await facades.contact.createInviteLink(userA);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const { token } = createResult.data;
    expect(token).toBeTruthy();

    // B がリンクを消費
    const consumeResult = await facades.contact.consumeInviteLink(token, userB);
    expect(consumeResult.ok).toBe(true);

    // A の contacts に B が追加されているか
    const aContactsResult = await facades.contact.listContacts(userA);
    expect(aContactsResult.ok).toBe(true);
    if (!aContactsResult.ok) return;
    expect(aContactsResult.data.some((c) => c.contactUserId === userB)).toBe(true);

    // B の contacts に A が追加されているか
    const bContactsResult = await facades.contact.listContacts(userB);
    expect(bContactsResult.ok).toBe(true);
    if (!bContactsResult.ok) return;
    expect(bContactsResult.data.some((c) => c.contactUserId === userA)).toBe(true);
  });
});
