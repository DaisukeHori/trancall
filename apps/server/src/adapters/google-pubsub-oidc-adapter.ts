/**
 * GooglePubSubOidcAdapter — Google Cloud Pub/Sub push サブスクリプションの
 * OIDC ID トークン検証 (#61)
 *
 * POST /api/billing/webhook/google (Google Play RTDN) は Google Cloud Pub/Sub の
 * push サブスクリプション経由で届く。Pub/Sub push は呼び出し元が Google であることを
 * 証明するため、Google が発行した OIDC ID トークンを `Authorization: Bearer <token>`
 * ヘッダーで送ってくる。本アダプタは google-auth-library の
 * OAuth2Client.verifyIdToken() で署名・audience・有効期限を検証し、
 * 正当な Google Cloud Pub/Sub からのリクエストであることを確認する。
 *
 * 【運用者作業】 GOOGLE_PLAY_PUBSUB_AUDIENCE (apps/server/src/config.ts) は
 * Google Cloud Pub/Sub サブスクリプション作成時に設定した OIDC audience と一致させる
 * 必要がある実際の運用値であり、コード側でダミー値を設定できない。未設定の場合は
 * fail-close (検証失敗として拒否) する。
 *
 * adapters/* 内では型アサーション例外許可 (CLAUDE.md)。
 */

import { OAuth2Client } from "google-auth-library";
import type { Result } from "@trancall/shared-kernel";
import { ok, err } from "@trancall/shared-kernel";

const BEARER_PREFIX = "Bearer ";

// OAuth2Client はステートレスな検証器 (audience は verifyIdToken() 呼び出し時に指定する) のため
// モジュールスコープで 1 個だけ生成し使い回す。
const oauth2Client = new OAuth2Client();

export interface GooglePubSubOidcVerificationResult {
  /** OIDC トークンのペイロードに含まれる email (Pub/Sub push サービスアカウントのメール) */
  email: string | undefined;
}

/**
 * Authorization ヘッダー値から Bearer トークンを抽出して OIDC 検証する。
 *
 * fail-close 方針:
 * - audience (GOOGLE_PLAY_PUBSUB_AUDIENCE) が未設定 → 常に検証失敗として拒否する
 * - Authorization ヘッダーが無い / Bearer 形式でない → 検証失敗
 * - OAuth2Client.verifyIdToken() が例外を投げる (署名不正・期限切れ・audience 不一致等) → 検証失敗
 *
 * @param authorizationHeader リクエストの Authorization ヘッダー値 (未設定なら undefined)
 * @param audience GOOGLE_PLAY_PUBSUB_AUDIENCE の設定値 (未設定なら undefined)
 */
export async function verifyGooglePubSubOidcToken(
  authorizationHeader: string | undefined,
  audience: string | undefined,
): Promise<Result<GooglePubSubOidcVerificationResult>> {
  if (audience === undefined || audience.length === 0) {
    return err({
      code: "UNAUTHORIZED",
      message:
        "GOOGLE_PLAY_PUBSUB_AUDIENCE が未設定のため Google Play webhook を拒否しました" +
        " (fail-close)。運用者は Google Cloud Pub/Sub push サブスクリプションの" +
        " OIDC audience と一致する値を環境変数に設定してください。",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (authorizationHeader === undefined || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return err({
      code: "UNAUTHORIZED",
      message: "Authorization ヘッダー (Bearer OIDC トークン) が必要です",
      retryable: false,
      httpStatus: 401,
    });
  }

  const idToken = authorizationHeader.slice(BEARER_PREFIX.length);
  if (idToken.length === 0) {
    return err({
      code: "UNAUTHORIZED",
      message: "Authorization ヘッダーの Bearer トークンが空です",
      retryable: false,
      httpStatus: 401,
    });
  }

  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload) {
      return err({
        code: "UNAUTHORIZED",
        message: "Google OIDC トークンのペイロードを取得できませんでした",
        retryable: false,
        httpStatus: 401,
      });
    }
    return ok({ email: payload.email });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({
      code: "UNAUTHORIZED",
      message: `Google OIDC トークン検証に失敗しました: ${msg}`,
      retryable: false,
      httpStatus: 401,
    });
  }
}
