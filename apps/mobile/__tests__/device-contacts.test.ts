/**
 * device-contacts.test.ts
 *
 * L-2: add-contact-screen.tsx「端末インポート」タブの
 * expo-contacts 権限取得 → 連絡先インポート → TranCall ユーザーマッチングのユニットテスト。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestAndImportDeviceContacts,
  matchDeviceContactsToTrancallUsers,
  setContactsModuleOverride,
} from "../src/lib/contacts/device-contacts.js";
import type { ExpoContactsModule, DeviceContact } from "../src/lib/contacts/device-contacts.js";
import type { PublicProfile } from "../src/api/contacts-api.js";

function makeMockModule(): ExpoContactsModule & {
  requestPermissionsAsync: ReturnType<typeof vi.fn>;
  getContactsAsync: ReturnType<typeof vi.fn>;
} {
  return {
    requestPermissionsAsync: vi.fn(),
    getContactsAsync: vi.fn(),
  };
}

describe("requestAndImportDeviceContacts", () => {
  afterEach(() => {
    setContactsModuleOverride(null);
  });

  it("expo-contacts が未導入の場合 status: 'unavailable' を返す", async () => {
    setContactsModuleOverride(null);
    const result = await requestAndImportDeviceContacts();
    expect(result.status).toBe("unavailable");
    expect(result.contacts).toEqual([]);
  });

  it("権限が拒否された場合 status: 'denied' を返す", async () => {
    const mod = makeMockModule();
    mod.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
    setContactsModuleOverride(mod);

    const result = await requestAndImportDeviceContacts();

    expect(result.status).toBe("denied");
    expect(result.contacts).toEqual([]);
    expect(mod.getContactsAsync).not.toHaveBeenCalled();
  });

  it("権限が許可された場合 status: 'granted' + 端末連絡先一覧を返す", async () => {
    const mod = makeMockModule();
    mod.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mod.getContactsAsync.mockResolvedValue({
      data: [
        { id: "c1", name: "山田 太郎" },
        { id: "c2", name: "John Smith" },
      ],
    });
    setContactsModuleOverride(mod);

    const result = await requestAndImportDeviceContacts();

    expect(result.status).toBe("granted");
    expect(result.contacts).toEqual([
      { id: "c1", name: "山田 太郎" },
      { id: "c2", name: "John Smith" },
    ]);
  });

  it("name が空/未設定の端末連絡先は除外する", async () => {
    const mod = makeMockModule();
    mod.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mod.getContactsAsync.mockResolvedValue({
      data: [
        { id: "c1", name: "  " },
        { id: "c2" },
        { id: "c3", name: "有効な名前" },
      ],
    });
    setContactsModuleOverride(mod);

    const result = await requestAndImportDeviceContacts();

    expect(result.contacts).toEqual([{ id: "c3", name: "有効な名前" }]);
  });

  it("id が欠落している端末連絡先は除外する", async () => {
    const mod = makeMockModule();
    mod.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    mod.getContactsAsync.mockResolvedValue({
      data: [{ name: "IDなし" }],
    });
    setContactsModuleOverride(mod);

    const result = await requestAndImportDeviceContacts();

    expect(result.contacts).toEqual([]);
  });
});

describe("matchDeviceContactsToTrancallUsers", () => {
  it("端末連絡先の名前で searchFn を呼び出し、ヒットしたプロフィールを返す", async () => {
    const deviceContacts: DeviceContact[] = [
      { id: "c1", name: "山田 太郎" },
      { id: "c2", name: "John Smith" },
    ];
    const profile1: PublicProfile = {
      userId: "u1",
      displayName: "山田 太郎",
      trancallId: "@yamada",
      nativeLanguage: "ja",
    };
    const profile2: PublicProfile = {
      userId: "u2",
      displayName: "John Smith",
      trancallId: "@john",
      nativeLanguage: "en",
    };

    const searchFn = vi.fn(async (query: string) => {
      if (query === "山田 太郎") return { ok: true as const, data: [profile1] };
      if (query === "John Smith") return { ok: true as const, data: [profile2] };
      return { ok: true as const, data: [] };
    });

    const result = await matchDeviceContactsToTrancallUsers(deviceContacts, searchFn);

    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("マッチが無い場合は空配列を返す", async () => {
    const deviceContacts: DeviceContact[] = [{ id: "c1", name: "未登録の人" }];
    const searchFn = vi.fn(async () => ({ ok: true as const, data: [] }));

    const result = await matchDeviceContactsToTrancallUsers(deviceContacts, searchFn);

    expect(result).toEqual([]);
  });

  it("同名の端末連絡先は 1 回だけ検索する (重複排除)", async () => {
    const deviceContacts: DeviceContact[] = [
      { id: "c1", name: "重複 太郎" },
      { id: "c2", name: "重複 太郎" },
    ];
    const searchFn = vi.fn(async () => ({ ok: true as const, data: [] }));

    await matchDeviceContactsToTrancallUsers(deviceContacts, searchFn);

    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  it("同一 userId が複数クエリでヒットしても重複排除される", async () => {
    const deviceContacts: DeviceContact[] = [
      { id: "c1", name: "太郎" },
      { id: "c2", name: "山田" },
    ];
    const profile: PublicProfile = {
      userId: "u1",
      displayName: "山田 太郎",
      trancallId: "@yamada",
      nativeLanguage: "ja",
    };
    const searchFn = vi.fn(async () => ({ ok: true as const, data: [profile] }));

    const result = await matchDeviceContactsToTrancallUsers(deviceContacts, searchFn);

    expect(result).toHaveLength(1);
  });

  it("searchFn がエラーを返しても他の結果は反映される", async () => {
    const deviceContacts: DeviceContact[] = [
      { id: "c1", name: "エラー太郎" },
      { id: "c2", name: "成功太郎" },
    ];
    const profile: PublicProfile = {
      userId: "u2",
      displayName: "成功太郎",
      trancallId: "@success",
      nativeLanguage: "ja",
    };
    const searchFn = vi.fn(async (query: string) => {
      if (query === "エラー太郎") {
        return {
          ok: false as const,
          error: { code: "NETWORK_ERROR", message: "network", retryable: true },
        };
      }
      return { ok: true as const, data: [profile] };
    });

    const result = await matchDeviceContactsToTrancallUsers(deviceContacts, searchFn);

    expect(result).toEqual([profile]);
  });

  it("空の端末連絡先リストでは searchFn を呼ばない", async () => {
    const searchFn = vi.fn(async () => ({ ok: true as const, data: [] }));

    const result = await matchDeviceContactsToTrancallUsers([], searchFn);

    expect(searchFn).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
