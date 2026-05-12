/**
 * LiveKit Adapter
 *
 * LiveKit Server SDK をラップし、Token 発行・Room 管理・Subscribe 制御を提供する。
 *
 * **C-005 対応の中核**:
 *   - クライアントから渡される `nativeLanguage` は信頼しない
 *   - 代わりに Auth モジュールの `getProfile(userId)` で DB から取得した値を Token metadata に焼き込む
 *   - grant.canUpdateMetadata = false で、クライアントから metadata を上書きさせない
 *
 * eslint 設定で `adapters/` 配下のみ型アサーション (`as`) を許可している。
 * 理由: livekit-server-sdk の型と内部 Branded Type の橋渡しが必要な箇所があるため。
 */

import { AccessToken, RoomServiceClient, type AccessTokenOptions } from "livekit-server-sdk";

import {
  type Result,
  type RoomId,
  ok,
  err,
} from "@trancall/shared-kernel";
import { type AuthFacade } from "@trancall/auth";

import {
  type IssueAccessTokenRequest,
  type IssueAccessTokenResponse,
  ParticipantMetadataSchema,
  type ParticipantMetadata,
} from "../schemas.js";

// --- 設定 ---

export interface LiveKitAdapterConfig {
  /** LiveKit Server の WSS URL (wss://xxx.livekit.cloud) */
  livekitUrl: string;
  /** LiveKit Server の HTTPS URL (https://xxx.livekit.cloud) — Room CRUD 用 */
  livekitHttpUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Auth モジュールのファサード（Profile lookup 用） */
  authFacade: AuthFacade;
}

// --- Adapter 本体 ---

export interface LiveKitAdapter {
  /**
   * LiveKit Access Token を発行する。
   *
   * **重要**: 引数の `userId` を元に Auth モジュールから Profile を取得し、
   * その `nativeLanguage` を Token metadata に焼き込む。
   * クライアントから渡された値（あれば）は **無視する**。
   */
  issueAccessToken: (
    request: IssueAccessTokenRequest,
  ) => Promise<Result<IssueAccessTokenResponse>>;

  /**
   * Room を作成する（既に存在する場合はエラーにせず冪等に返す）。
   */
  createRoom: (
    roomId: RoomId,
    options?: { emptyTimeoutSec?: number; maxParticipants?: number },
  ) => Promise<Result<void>>;

  /**
   * Room を削除する（存在しない場合もエラーにしない）。
   */
  deleteRoom: (roomId: RoomId) => Promise<Result<void>>;
}

export function createLiveKitAdapter(config: LiveKitAdapterConfig): LiveKitAdapter {
  const roomServiceClient = new RoomServiceClient(
    config.livekitHttpUrl,
    config.apiKey,
    config.apiSecret,
  );

  return {
    issueAccessToken: async (request) => {
      // 1. Auth モジュールから Profile を取得（DBが真実のソース）
      const profileResult = await config.authFacade.getProfile(request.userId);
      if (!profileResult.ok) {
        return err({
          code: "media.token.profile_lookup_failed",
          message: "Profile 取得に失敗、Token 発行不可",
          retryable: profileResult.error.retryable,
          details: { upstream: profileResult.error.code },
        });
      }
      const profile = profileResult.data;

      // 2. metadata を組み立てる（Zod でバリデーション）
      const metadataCandidate = {
        schemaVersion: 1 as const,
        userId: profile.userId,
        // ★ ここがクリティカル: クライアント由来の値ではなく DB の値を使う
        nativeLanguage: profile.nativeLanguage,
        issuedAt: new Date().toISOString(),
      };
      const metadataParsed = ParticipantMetadataSchema.safeParse(metadataCandidate);
      if (!metadataParsed.success) {
        return err({
          code: "media.token.metadata_invalid",
          message: "metadata バリデーションに失敗",
          retryable: false,
          details: { issues: metadataParsed.error.issues.map((i) => i.message) },
        });
      }
      const metadata: ParticipantMetadata = metadataParsed.data;

      // 3. AccessToken を組み立てる
      //
      //   identity = userId（LiveKit 上で参加者を一意に識別する文字列）
      //   metadata = 上記で組み立てた JSON（クライアントから書き換え不可）
      //   ttl = リクエストで指定された秒数
      //
      //   grant の重要ポイント:
      //   - canUpdateOwnMetadata: false ← C-005 対応の要
      //   - canPublish: 自分の raw-* トラックを Publish するため true
      //   - canSubscribe: 翻訳済み trans-*-to-{自分の言語} を Subscribe するため true
      //
      //   Subscribe policy は Phase 1a Sprint 0 では allow-all とし、
      //   ambient passthrough / 字幕のみモードは Sprint 1 で track filter を追加する

      const tokenOptions: AccessTokenOptions = {
        identity: profile.userId,
        metadata: JSON.stringify(metadata),
        ttl: request.ttlSeconds,
      };

      const accessToken = new AccessToken(config.apiKey, config.apiSecret, tokenOptions);
      accessToken.addGrant({
        roomJoin: true,
        room: request.roomId,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: false,
      });

      let jwt: string;
      try {
        jwt = await accessToken.toJwt();
      } catch (e: unknown) {
        return err({
          code: "media.token.jwt_sign_failed",
          message: e instanceof Error ? e.message : "JWT 署名に失敗",
          retryable: true,
        });
      }

      const expiresAt = new Date(Date.now() + request.ttlSeconds * 1000).toISOString();

      return ok({
        token: jwt,
        livekitUrl: config.livekitUrl,
        metadata,
        expiresAt,
      });
    },

    createRoom: async (roomId, options) => {
      try {
        await roomServiceClient.createRoom({
          name: roomId,
          emptyTimeout: options?.emptyTimeoutSec ?? 600,
          maxParticipants: options?.maxParticipants ?? 10,
        });
        return ok(undefined);
      } catch (e: unknown) {
        // LiveKit Server は既存 Room の作成リクエストでエラーを返さないが、
        // 念のため "already_exists" を識別したいケースに備える
        const message = e instanceof Error ? e.message : String(e);
        if (/already.*exist/i.test(message)) {
          return ok(undefined);
        }
        return err({
          code: "media.room.create_failed",
          message,
          retryable: true,
        });
      }
    },

    deleteRoom: async (roomId) => {
      try {
        await roomServiceClient.deleteRoom(roomId);
        return ok(undefined);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        // 存在しない Room の削除は冪等として扱う
        if (/not.*found|does.*not.*exist/i.test(message)) {
          return ok(undefined);
        }
        return err({
          code: "media.room.delete_failed",
          message,
          retryable: true,
        });
      }
    },
  };
}

// --- 型安全ヘルパー: Participant.metadata の安全なパース ---

/**
 * 受信した Participant の metadata 文字列を Zod でパースする。
 *
 * Translation Agent や Client が `participant.metadata` を読むときは必ずこの関数経由で。
 *
 * @returns metadata が空 or 不正な場合は ok(null) を返す（grant を持たないAgent等のケース）
 */
export function parseParticipantMetadata(
  raw: string | undefined,
): Result<ParticipantMetadata | null> {
  if (raw === undefined || raw === "") {
    return ok(null);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e: unknown) {
    return err({
      code: "media.metadata.invalid_json",
      message: e instanceof Error ? e.message : "metadata が JSON でない",
      retryable: false,
    });
  }

  const result = ParticipantMetadataSchema.safeParse(parsedJson);
  if (!result.success) {
    return err({
      code: "media.metadata.invalid_schema",
      message: "metadata がスキーマと不整合",
      retryable: false,
      details: { issues: result.error.issues.map((i) => i.message) },
    });
  }

  // schemaVersion の前方互換性チェック
  if (result.data.schemaVersion !== 1) {
    return err({
      code: "media.metadata.unsupported_version",
      message: `metadata schemaVersion ${String(result.data.schemaVersion)} は未対応`,
      retryable: false,
    });
  }

  return ok(result.data);
}
