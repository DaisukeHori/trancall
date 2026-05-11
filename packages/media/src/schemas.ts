/**
 * Media モジュール公開スキーマ
 */

import { z } from "zod";

import {
  OutputLanguage,
  RoomIdSchema,
  UserIdSchema,
} from "@trancall/shared-kernel";

/**
 * LiveKit Participant Metadata
 *
 * **Server-side で Token 発行時にのみ書き込まれる**（C-005 対応）。
 * クライアントはこれを書き換える権限を持たない（grant.canUpdateMetadata = false）。
 *
 * Translation Agent はこの metadata から `nativeLanguage` を読み取り、
 * 他参加者向けの翻訳セッションを開く。
 */
export const ParticipantMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  userId: UserIdSchema,
  /** ユーザーのネイティブ言語（DB の profiles.native_language を真実のソースとする） */
  nativeLanguage: OutputLanguage,
  /**
   * Token 発行時刻（ISO 8601）
   * Token expiry とは別に、metadata の鮮度を確認するために含める
   */
  issuedAt: z.string().datetime(),
});
export type ParticipantMetadata = z.infer<typeof ParticipantMetadataSchema>;

/**
 * LiveKit Access Token 発行リクエスト
 */
export const IssueAccessTokenRequestSchema = z.object({
  userId: UserIdSchema,
  roomId: RoomIdSchema,
  /** 通話の役割（caller = 発信者、callee = 受信者） */
  role: z.enum(["caller", "callee"]),
  /** Token 有効期限（秒）、デフォルト 6 時間 */
  ttlSeconds: z.number().int().positive().max(86400).default(21600),
});
export type IssueAccessTokenRequest = z.infer<typeof IssueAccessTokenRequestSchema>;

/**
 * LiveKit Access Token 発行レスポンス
 *
 * `metadata` フィールドは **Server が DB から取得した値で焼き込まれた**ものを返す。
 * クライアントは metadata を直接書き換えできない。
 */
export const IssueAccessTokenResponseSchema = z.object({
  /** JWT 形式の LiveKit Access Token */
  token: z.string().min(1),
  /** LiveKit Server の WSS URL（環境変数から） */
  livekitUrl: z.string().url(),
  /** Token に焼き込まれた metadata（クライアント側で参照用） */
  metadata: ParticipantMetadataSchema,
  /** Token expiry (ISO 8601) */
  expiresAt: z.string().datetime(),
});
export type IssueAccessTokenResponse = z.infer<typeof IssueAccessTokenResponseSchema>;
