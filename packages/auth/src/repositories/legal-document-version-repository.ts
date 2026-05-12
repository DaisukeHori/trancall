/**
 * LegalDocumentVersionRepository — 法務ドキュメントバージョンの永続化抽象
 *
 * canonical: docs/legal-and-consent.md v1.2 §4.2
 * canonical: docs/module-contracts.md v1.3 §2.1 (要求 Repository)
 *
 * 本番実装は packages/auth/src/adapters/supabase-legal-document-version-repository.ts を参照。
 * テストでは in-memory モックを DI する。
 */

import {
  type Result,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type LegalDocumentVersion,
} from "@trancall/shared-kernel";

export interface LegalDocumentVersionRepository {
  /**
   * 指定 scope の最新バージョンを取得する。
   * consent_versions テーブルから該当 scope の最新行を返す。
   * 存在しない場合は { ok: true, data: null } を返す。
   */
  findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion | null>>;

  /**
   * 全 scope の最新バージョンを一括取得する。
   * getRequiredConsents() で全 scope を一度に参照するために使用する。
   * scope ごとに最新バージョン 1 件を返す。
   */
  findAllLatest(): Promise<Result<LegalDocumentVersion[]>>;
}
