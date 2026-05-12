/**
 * LiveKit Adapter テスト
 *
 * **C-005 対応の検証ポイント**:
 * - クライアントから渡された nativeLanguage は使われない
 * - DB の Profile から取得した nativeLanguage が metadata に焼き込まれる
 * - grant.canUpdateOwnMetadata = false が設定される
 */

import { describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

import {
  brandUserId,
  brandRoomId,
  type Result,
  type AppError,
  type UserId,
} from "@trancall/shared-kernel";
import { type AuthFacade, type Profile } from "@trancall/auth";

import { createLiveKitAdapter, parseParticipantMetadata } from "../src/adapters/livekit.js";

// --- テストユーティリティ ---

const TEST_USER_ID_RAW = "00000000-0000-4000-8000-000000000001";
const TEST_ROOM_ID_RAW = "10000000-0000-4000-8000-000000000001";

function makeUserId() {
  const r = brandUserId(TEST_USER_ID_RAW);
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

function makeRoomId() {
  const r = brandRoomId(TEST_ROOM_ID_RAW);
  if (!r.success) throw new Error("test setup: brandRoomId failed");
  return r.data;
}

function makeAuthFacade(profile: Profile): AuthFacade {
  return {
    getProfile: vi
      .fn<(userId: UserId) => Promise<Result<Profile>>>()
      .mockResolvedValue({ ok: true, data: profile }),
  };
}

function makeFailingAuthFacade(error: AppError): AuthFacade {
  return {
    getProfile: vi
      .fn<(userId: UserId) => Promise<Result<Profile>>>()
      .mockResolvedValue({ ok: false, error }),
  };
}

const TEST_PROFILE: Profile = {
  userId: makeUserId(),
  email: "hori@example.com",
  displayName: "堀大輔",
  nativeLanguage: "ja",
  trancallId: "hori_test_123",
  updatedAt: "2026-05-12T00:00:00.000Z",
};

const adapterConfig = (authFacade: AuthFacade) => ({
  livekitUrl: "wss://trancall-test.livekit.cloud",
  livekitHttpUrl: "https://trancall-test.livekit.cloud",
  apiKey: "API_KEY_FOR_TEST",
  apiSecret: "API_SECRET_FOR_TEST_AT_LEAST_32_CHARACTERS",
  authFacade,
});

// --- Tests ---

describe("createLiveKitAdapter.issueAccessToken — C-005 metadata server-side焼き込み", () => {
  it("DBから取得したnativeLanguageがmetadataに焼き込まれる", async () => {
    const authFacade = makeAuthFacade(TEST_PROFILE);
    const adapter = createLiveKitAdapter(adapterConfig(authFacade));

    const result = await adapter.issueAccessToken({
      userId: makeUserId(),
      roomId: makeRoomId(),
      role: "caller",
      ttlSeconds: 3600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.metadata.nativeLanguage).toBe("ja");
    expect(result.data.metadata.userId).toBe(TEST_USER_ID_RAW);
    expect(result.data.metadata.schemaVersion).toBe(1);
  });

  it("JWTにmetadataとgrantが正しくエンコードされる", async () => {
    const authFacade = makeAuthFacade(TEST_PROFILE);
    const adapter = createLiveKitAdapter(adapterConfig(authFacade));

    const result = await adapter.issueAccessToken({
      userId: makeUserId(),
      roomId: makeRoomId(),
      role: "caller",
      ttlSeconds: 3600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // JWT を decode してペイロードを検証
    const payload = decodeJwt(result.data.token);

    expect(payload.sub).toBe(TEST_USER_ID_RAW);
    expect(typeof payload["metadata"]).toBe("string");

    const metadataDecoded: unknown = JSON.parse(String(payload["metadata"]));
    expect(metadataDecoded).toMatchObject({
      schemaVersion: 1,
      userId: TEST_USER_ID_RAW,
      nativeLanguage: "ja",
    });

    // grant.canUpdateOwnMetadata = false が設定されている
    const video = payload["video"];
    expect(video).toMatchObject({
      roomJoin: true,
      room: TEST_ROOM_ID_RAW,
      canPublish: true,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
    });
  });

  it("プロフィール取得失敗時はエラーを返す（Token発行しない）", async () => {
    const authFacade = makeFailingAuthFacade({
      code: "auth.profile.not_found",
      message: "Profile が見つからない",
      retryable: false,
    });
    const adapter = createLiveKitAdapter(adapterConfig(authFacade));

    const result = await adapter.issueAccessToken({
      userId: makeUserId(),
      roomId: makeRoomId(),
      role: "caller",
      ttlSeconds: 3600,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("media.token.profile_lookup_failed");
  });

  it("DBのnativeLanguageが en でも metadata は en で焼き込まれる（DBが真実のソース）", async () => {
    const englishProfile: Profile = { ...TEST_PROFILE, nativeLanguage: "en" };
    const authFacade = makeAuthFacade(englishProfile);
    const adapter = createLiveKitAdapter(adapterConfig(authFacade));

    const result = await adapter.issueAccessToken({
      userId: makeUserId(),
      roomId: makeRoomId(),
      role: "callee",
      ttlSeconds: 3600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metadata.nativeLanguage).toBe("en");
  });

  it("authFacade.getProfileは引数のuserIdで呼ばれる", async () => {
    const authFacade = makeAuthFacade(TEST_PROFILE);
    const adapter = createLiveKitAdapter(adapterConfig(authFacade));
    const userId = makeUserId();

    await adapter.issueAccessToken({
      userId,
      roomId: makeRoomId(),
      role: "caller",
      ttlSeconds: 3600,
    });

    expect(authFacade.getProfile).toHaveBeenCalledWith(userId);
  });
});

describe("parseParticipantMetadata", () => {
  it("空文字列・undefined は null を返す", () => {
    expect(parseParticipantMetadata(undefined).ok).toBe(true);
    const r1 = parseParticipantMetadata(undefined);
    if (r1.ok) expect(r1.data).toBeNull();

    expect(parseParticipantMetadata("").ok).toBe(true);
    const r2 = parseParticipantMetadata("");
    if (r2.ok) expect(r2.data).toBeNull();
  });

  it("正常な metadata をパースできる", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      userId: TEST_USER_ID_RAW,
      nativeLanguage: "ja",
      issuedAt: "2026-05-12T00:00:00.000Z",
    });
    const result = parseParticipantMetadata(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      schemaVersion: 1,
      userId: TEST_USER_ID_RAW,
      nativeLanguage: "ja",
    });
  });

  it("不正な JSON は err を返す", () => {
    const result = parseParticipantMetadata("not-json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("media.metadata.invalid_json");
  });

  it("スキーマ違反は err を返す", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      userId: "not-a-uuid",
      nativeLanguage: "ja",
      issuedAt: "2026-05-12T00:00:00.000Z",
    });
    const result = parseParticipantMetadata(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("media.metadata.invalid_schema");
  });

  it("未対応の schemaVersion は err を返す", () => {
    // 0 を渡す（Zod の literal(1) で先に弾かれるが、保険のテスト）
    const json = JSON.stringify({
      schemaVersion: 2,
      userId: TEST_USER_ID_RAW,
      nativeLanguage: "ja",
      issuedAt: "2026-05-12T00:00:00.000Z",
    });
    const result = parseParticipantMetadata(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // literal(1) でひっかかるので invalid_schema が先に来る
    expect(result.error.code).toBe("media.metadata.invalid_schema");
  });
});
