/**
 * expo-contacts 経由の端末連絡先インポート (L-2)
 *
 * add-contact-screen.tsx の「端末インポート」タブの許可ボタンから呼ばれる。
 *
 * expo-contacts は本リポジトリの package.json に未追加 (native module 未インストール)。
 * これは lib/callkit/index.ts (react-native-callkeep) や
 * lib/livekit/connect.ts (@livekit/react-native) と同じ、このリポジトリで確立された
 * 「native prebuild 前は require() 失敗時に graceful に no-op/unavailable フォールバックする」
 * 方針を踏襲する (native prebuild で正式導入するまでの暫定実装)。
 *
 * マッチング方式: サーバー側に電話番号照合 API (bulk contact match) が存在しないため、
 * 端末連絡先の表示名で ../../api/contacts-api.searchUsers() (部分一致検索) を呼び出し、
 * ヒットした TranCall ユーザーを「マッチ」として扱う。
 */
import type { Result } from "@trancall/shared-kernel";
import type { PublicProfile } from "../../api/contacts-api";

export interface DeviceContact {
  id: string;
  name: string;
}

export type ContactsPermissionStatus = "granted" | "denied" | "unavailable";

export interface RequestContactsPermissionResult {
  status: ContactsPermissionStatus;
  contacts: DeviceContact[];
}

/** expo-contacts の型を最低限だけ duck-typing する (パッケージ未導入でも静的 import しない) */
export interface ExpoContactsModule {
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getContactsAsync: (options: { fields: string[] }) => Promise<{ data: unknown[] }>;
}

// テスト注入用オーバーライド (callkit/index.ts の setCallKeepNativeModule と同パターン)
let _moduleOverride: ExpoContactsModule | null | undefined;

/** テスト注入用。undefined に戻すと require() ベースの本番解決に戻る。 */
export function setContactsModuleOverride(mod: ExpoContactsModule | null): void {
  _moduleOverride = mod;
}

function loadContactsModule(): ExpoContactsModule | null {
  if (_moduleOverride !== undefined) {
    return _moduleOverride;
  }

  try {
    // expo-contacts は native module が必要なため、
    // Expo Go / テスト環境では import エラーになる場合がある
    const mod = require("expo-contacts") as { default?: ExpoContactsModule } & ExpoContactsModule; // eslint-disable-line @typescript-eslint/no-require-imports
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function toDeviceContact(raw: unknown): DeviceContact | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : null;
  const name = typeof r["name"] === "string" ? r["name"].trim() : "";
  if (id == null || name.length === 0) return null;
  return { id, name };
}

/**
 * 連絡先アクセス許可をリクエストし、許可された場合は端末連絡先一覧を取得する。
 *
 * - expo-contacts が未導入の環境 (native prebuild 前) では status: "unavailable"
 * - ユーザーが権限を拒否した場合は status: "denied"
 * - 許可された場合は status: "granted" + 端末連絡先一覧
 */
export async function requestAndImportDeviceContacts(): Promise<RequestContactsPermissionResult> {
  const contactsModule = loadContactsModule();
  if (contactsModule == null) {
    return { status: "unavailable", contacts: [] };
  }

  const permission = await contactsModule.requestPermissionsAsync();
  if (permission.status !== "granted") {
    return { status: "denied", contacts: [] };
  }

  const result = await contactsModule.getContactsAsync({ fields: ["name"] });
  const contacts = result.data
    .map(toDeviceContact)
    .filter((c): c is DeviceContact => c != null);

  return { status: "granted", contacts };
}

/**
 * 端末連絡先の表示名を使って searchFn (searchUsers) を呼び出し、
 * ヒットした TranCall ユーザーを userId で重複排除して返す。
 *
 * @param deviceContacts requestAndImportDeviceContacts() が返した端末連絡先一覧
 * @param searchFn ../../api/contacts-api.searchUsers (テストでは差し替え可能)
 */
export async function matchDeviceContactsToTrancallUsers(
  deviceContacts: DeviceContact[],
  searchFn: (query: string) => Promise<Result<PublicProfile[]>>,
): Promise<PublicProfile[]> {
  const names = Array.from(
    new Set(deviceContacts.map((c) => c.name.trim()).filter((n) => n.length > 0)),
  );

  const results = await Promise.all(names.map((name) => searchFn(name)));

  const matched = new Map<string, PublicProfile>();
  for (const result of results) {
    if (!result.ok) continue;
    for (const profile of result.data) {
      matched.set(profile.userId, profile);
    }
  }

  return Array.from(matched.values());
}
