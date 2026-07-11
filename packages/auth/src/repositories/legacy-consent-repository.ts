/**
 * LegacyConsentRepository — レガシー consent_versions 書き込みの永続化抽象 (Issue #72.1)
 *
 * `POST /api/auth/consent` (単数形、旧 API) が使う書き込み経路。
 * Sprint 2 D7 で導入された scope 単位の同意管理 (`ConsentRepository` /
 * `trancall_auth.user_consents`、`POST /api/auth/consents` 複数形) とは別物であり、
 * こちらは Sprint 1 由来のレガシー経路 (ユーザーごとに単一の consent_version を記録)。
 *
 * 【既知の課題・スコープ外】 apps/mobile/src/api/auth-api.ts の `revokeConsent()` は
 * この `POST /api/auth/consent` に `{ revoke: true }` を送るが、サーバー側は
 * `{ consentVersion: string }` を要求するスキーマ (auth-routes.ts ConsentSchema) の
 * ままであり、実際の mobile リクエストは常に 400 (VALIDATION_ERROR) になる
 * (= 本エンドポイントは実質的に到達不能な状態)。また書き込み先テーブル
 * `trancall_auth.consent_versions` は version/scope を PK とするドキュメント
 * バージョン参照テーブルであり (migration 00001 §15 / 00008)、
 * user_id 列を持たない。本 Issue (#72.1: facade バイパスの是正) のスコープは
 * 「直接 supabase 呼び出しを facade 経由に置き換えること」に限定されるため、
 * 本リポジトリは既存コードの書き込み対象・カラム構成を変更せずそのまま
 * facade 経由に移設する。上記のスキーマ不整合・mobile/server 契約不一致は
 * 別 Issue での是正が必要。
 *
 * 本番実装は apps/server/src/adapters/repositories/auth/legacy-consent-repository.supabase.ts
 * を参照。
 */

import { type Result, type UserId } from "@trancall/shared-kernel";

export interface LegacyConsentRepository {
  /**
   * レガシー consent_versions への同意記録 (現状の実装をそのまま踏襲)。
   */
  recordConsentVersion(userId: UserId, consentVersion: string): Promise<Result<true>>;
}
