/**
 * Media モジュール公開ファサード
 *
 * 他モジュール（room, billing など）は **このファイル経由でしか media に触れない**。
 *
 * adapter（LiveKit）への依存はここで吸収する。Phase 2 で TRTC を併用する際は、
 * `MediaFacade` の実装を adapter から選択する形で拡張する。
 */

import {
  type Result,
  type RoomId,
} from "@trancall/shared-kernel";

import { type LiveKitAdapter } from "./adapters/livekit.js";
import {
  IssueAccessTokenRequestSchema,
  type IssueAccessTokenRequest,
  type IssueAccessTokenResponse,
} from "./schemas.js";

export interface MediaFacade {
  /**
   * LiveKit Access Token を発行する。
   * 入力 request は Zod で再バリデーションされ、無効な場合は err を返す。
   * **C-005 対応**: クライアントから来た nativeLanguage は使わず、DB の値を焼き込む。
   */
  issueAccessToken: (
    rawRequest: unknown,
  ) => Promise<Result<IssueAccessTokenResponse>>;

  /**
   * Room を作成する。
   */
  createRoom: (
    roomId: RoomId,
    options?: { emptyTimeoutSec?: number; maxParticipants?: number },
  ) => Promise<Result<void>>;

  /**
   * Room を削除する。
   */
  deleteRoom: (roomId: RoomId) => Promise<Result<void>>;
}

export function createMediaFacade(adapter: LiveKitAdapter): MediaFacade {
  return {
    issueAccessToken: async (rawRequest) => {
      const parsed = IssueAccessTokenRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "media.token.invalid_request",
            message: "Token 発行リクエストの形式が不正",
            retryable: false,
            details: { issues: parsed.error.issues.map((i) => i.message) },
          },
        };
      }
      const request: IssueAccessTokenRequest = parsed.data;
      return adapter.issueAccessToken(request);
    },

    createRoom: (roomId, options) => adapter.createRoom(roomId, options),

    deleteRoom: (roomId) => adapter.deleteRoom(roomId),
  };
}
