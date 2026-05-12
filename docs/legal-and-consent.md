# TranCall 法務・同意フロー設計書 (Legal and Consent Flow Design)

| 項目 | 内容 |
|------|------|
| ドキュメント ID | LEGAL-CONSENT-001 |
| Status | Draft v1.0 (2026-05-12) |
| Sprint | Sprint 2 D7 |
| 上位文書 | `docs/architecture.md` §5.5 §9 / `docs/requirements.md` §2 Phase 1a 完了基準 / `docs/module-contracts.md` v1.1.0 §2.1 AuthFacade |
| 関連文書 | `docs/account-deletion.md` (退会 canonical) / `docs/billing-ui-flow.md` v1.2 (IAP 規約) / `docs/notification-detail.md` v1.3 (Push 同意) / `docs/native-call-bridge.md` v1.4 (CallKit / VoIP Push) |
| 下位実装対象 | `packages/auth/src/schemas.ts` (ConsentScope / ConsentRecord 拡張) / `packages/auth/src/facade.ts` (recordConsent / hasConsent / revokeConsent / getRequiredConsents) / `apps/mobile/src/screens/consent-screen.tsx` (新規) / 利用規約サイト `https://trancall.app/terms` / プライバシーポリシーサイト `https://trancall.app/privacy` |
| 法的有効性 | **本書は骨子・実装 spec を提供する。最終的な法的有効性は外部弁護士の確認後に確定する。** |

---

> **重要免責**: 本書に含まれる利用規約・プライバシーポリシーの本文はすべて骨子・ドラフトである。法律的な有効性・適合性は外部弁護士によるレビュー後に確定する。実装エンジニアは骨子を参照して実装 spec を理解するが、公開前に必ず法務レビューを経ること。

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [用語と前提](#2-用語と前提)
3. [Zod スキーマ定義](#3-zod-スキーマ定義)
4. [AuthFacade 拡張](#4-authfacade-拡張)
5. [同意の種別とライフサイクル](#5-同意の種別とライフサイクル)
6. [同意フロー UI シーケンス](#6-同意フロー-ui-シーケンス)
7. [利用規約 (Terms of Service) 骨子](#7-利用規約-terms-of-service-骨子)
8. [プライバシーポリシー骨子](#8-プライバシーポリシー骨子)
9. [OpenAI 音声送信同意](#9-openai-音声送信同意)
10. [トランスクリプト保持期間同意](#10-トランスクリプト保持期間同意)
11. [退会・データ削除同意](#11-退会データ削除同意)
12. [Apple アカウント削除要件遵守](#12-apple-アカウント削除要件遵守)
13. [規約改訂時の再同意フロー](#13-規約改訂時の再同意フロー)
14. [エラーハンドリング](#14-エラーハンドリング)
15. [テスト戦略 + 法務レビューチェックリスト](#15-テスト戦略--法務レビューチェックリスト)
16. [改訂履歴](#16-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の目的

本書は Sprint 2 D7 として、TranCall の **法務文書（利用規約・プライバシーポリシー）の骨子** と、それを実装する **同意フロー（Zod スキーマ + AuthFacade 拡張 + UI フロー）** を canonical に確定する。

Sprint 3-4 で以下を実装するエンジニア・法務担当・PM が、本書 1 冊で必要な情報を得られることを目標とする:

- 同意フロー実装エンジニア: §3 (Zod スキーマ)・§4 (AuthFacade)・§6 (UI シーケンス)・§14 (エラーコード)
- 法務担当: §7 (利用規約骨子)・§8 (プライバシーポリシー骨子)・§9 (OpenAI 音声送信)・§15.4 (法務チェックリスト)
- Apple App Review 提出担当: §8.2 (Privacy Manifest 整合)・§12 (アカウント削除要件)・§9.1 (5.1.2 対策)

### 1.2 本書がカバーする範囲

- 同意 Zod スキーマ (`ConsentScope` / `ConsentRecord` / `LegalDocumentVersion` / `RequiredConsentView`)
- `AuthFacade` 新規メソッド 4 種の contract (interface + 契約注釈)
- 同意フロー UI シーケンス 4 種 (Onboarding / 初回通話前 / 規約改訂時 / Settings)
- 利用規約 15 条骨子 (ja/en/zh、本文は法務確認後に確定)
- プライバシーポリシー 12 条骨子 (ja/en/zh、本文は法務確認後に確定)
- OpenAI 音声送信同意 (App Store Review Guideline 5.1.2 対策)
- トランスクリプト保持期間同意 (プラン別)
- 退会・データ削除同意 (`docs/account-deletion.md` との整合)
- Apple アカウント削除要件 (App Store Review Guideline 5.1.1(v))
- 規約改訂時の再同意フロー
- エラーコード 4 種の contract
- テスト戦略 + 法務レビューチェックリスト

### 1.3 本書がカバーしない範囲

- **heartbeat 課金**: `docs/billing-detail.md` が canonical
- **IAP 購入フロー UI**: `docs/billing-ui-flow.md` v1.2 が canonical
- **VoIP Push 配信実装**: `docs/notification-detail.md` v1.3 が canonical
- **CallKit / ConnectionService**: `docs/native-call-bridge.md` v1.4 が canonical
- **退会・データ削除の技術実装**: `docs/account-deletion.md` が canonical (本書は同意 UI のみ)
- **App Store 提出手続き**: app-store-submission.md (別 PR で作成予定) が担当
- **法的拘束力のある最終文書**: 外部弁護士確認後に確定

### 1.4 関連設計書との位置関係

```
docs/requirements.md         AUTH-009 (初回翻訳通話前同意)
docs/architecture.md         §5.5 同意フロー言及 / §9 セキュリティ
docs/module-contracts.md     §2.1 AuthFacade / §5 AUTH_CONSENT_REQUIRED error code
docs/account-deletion.md     退会 canonical (退会フロー詳細はこちら)
docs/billing-ui-flow.md      IAP サブスクリプション課金フロー
docs/notification-detail.md  APNs VoIP Push payload / HMAC 署名
docs/native-call-bridge.md   CallKit / ConnectionService 実装
docs/legal-and-consent.md    ★本書 (法務 + 同意フロー canonical)
```

---

## 2. 用語と前提

### 2.1 用語定義

| 用語 | 定義 |
|---|---|
| **同意 (consent)** | ユーザーが特定の scope に対して明示的に同意したこと。本書では能動的 opt-in のみを有効な同意として扱う。 |
| **ConsentScope** | 同意の種別。`legal_terms` / `privacy_policy` / `voice_to_openai` / `transcript_retention` / `data_deletion_request` / `push_notification` / `marketing_email` の 7 種。 |
| **ConsentRecord** | DB に永続化される同意レコード。userId + scope + version + recordedAt + 取消日時で構成。 |
| **LegalDocumentVersion** | 規約ドキュメントのバージョン。YYYY-MM-DD 形式。規約改訂時にインクリメント。 |
| **RequiredConsentView** | UI 表示用の同意状態ビュー。scope ごとに「最新バージョンに同意済か」を示す。 |
| **signatureVersion** | ConsentRecord が同意したドキュメントバージョン。規約改訂時の再同意判定に使用。 |
| **opt-in** | ユーザーが積極的に同意を表明する方式。デフォルト OFF、チェックボックスをオンにして初めて有効。 |
| **opt-out** | デフォルト ON で、ユーザーが取り消す方式。本書では `transcript_retention` / `push_notification` がデフォルト ON だが、取消可能。 |
| **零保持ポリシー** | OpenAI の音声データ保存なし方針。通話音声を翻訳完了後に保持しない。詳細は https://openai.com/policies/data-privacy を参照。 |
| **grace period** | 退会リクエストから物理削除まで 30 日の猶予期間。この期間中はログイン可能かつ復元可能。 |
| **法定保持期間** | GDPR 要件等により、同意記録（consent_versions）は退会後も保持が必要な期間。 |

### 2.2 前提

1. **Zod v4** を使用する (`z.url()`, `z.iso.datetime()`, `z.uuid()` 等の v4 API)
2. **UserIdSchema** / **UserIdBrand** は `@trancall/shared-kernel` から import する
3. **DomainEventBase** は `@trancall/shared-kernel/schemas/events` から import する
4. **Result 型** は `{ ok: true; data: T } | { ok: false; error: AppError }` のdiscriminated union
5. `trancall_auth.consent_versions` テーブルは `supabase/migrations/00001_initial_schema.sql` §15 に定義済み
   - ただし現 DB スキーマは全 scope を 1 テーブルで管理する簡易構造。Sprint 3 でスキーマ拡張が必要（§3.4 参照）
6. 着信者の初回同意は、応答後初回のみ表示する（`docs/architecture.md` §5.5 M2-015 対応）

---

## 3. Zod スキーマ定義

> **注意**: 以下は Sprint 3 で `packages/auth/src/schemas.ts` に追記するコードである。現在の `ProfileSchema` / `ConsentVersionSchema` と同一ファイルに共存させる。

```typescript
// packages/auth/src/schemas.ts (Sprint 3 拡張分)
// 既存 import に追記
import { z } from "zod";
import { DomainEventBase } from "@trancall/shared-kernel/schemas/events.js";
import { UserIdSchema } from "@trancall/shared-kernel";

// ============================================================
// §3.1 ConsentScope — 同意の種別
// ============================================================

/**
 * TranCall で取得する同意の種別。
 * 新規 scope を追加する場合は本書 §5 (ライフサイクル表) も同時に更新すること。
 */
export const ConsentScopeSchema = z.enum([
  "legal_terms",          // 利用規約への同意 (アカウント作成時 + 規約改訂時)
  "privacy_policy",       // プライバシーポリシーへの同意 (同上)
  "voice_to_openai",      // OpenAI への音声送信同意 (初回通話前、最重要)
  "transcript_retention", // トランスクリプト保持への同意 (プラン別保持期間)
  "data_deletion_request",// 退会・データ削除リクエスト確認
  "push_notification",    // Push 通知許可 (iOS POST_NOTIFICATIONS と連動)
  "marketing_email",      // マーケティングメール (オプトイン、Phase 2)
]);
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;

// ============================================================
// §3.2 LegalDocumentVersion — 規約ドキュメントのバージョン
// ============================================================

/**
 * 各 scope のバージョン管理エントリ。
 * 規約改訂時はこのレコードを INSERT し、既存レコードの supersedes に前バージョンを入れる。
 * DB: trancall_auth.consent_versions (拡張版、§3.4 参照)
 */
export const LegalDocumentVersionSchema = z.object({
  /** scope 識別子 */
  scope: ConsentScopeSchema,
  /** バージョン文字列。YYYY-MM-DD 形式 */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * 規約本文の URL。legal_terms / privacy_policy のみ必須。
   * voice_to_openai 等は null を許容。
   */
  documentUrl: z.url().nullable(),
  /** この版が発効する日時 */
  effectiveAt: z.iso.datetime(),
  /** 前バージョン（初版は null） */
  supersedes: z.string().nullable(),
  /**
   * 改訂内容のサマリ（日本語）。
   * 多言語サマリは i18n key で別途管理する。
   * 例: "OpenAI 零保持ポリシーへの言及を追記"
   */
  changeSummary: z.string().nullable(),
});
export type LegalDocumentVersion = z.infer<typeof LegalDocumentVersionSchema>;

// ============================================================
// §3.3 ConsentRecord — 同意レコード (DB 行に対応)
// ============================================================

/**
 * ユーザーが scope に同意した記録。DB では 1 行 = 1 同意行為。
 * 取消時は revokedAt を SET する（物理削除しない）。
 *
 * DB: trancall_auth.user_consents (Sprint 3 新規 migration で作成)
 */
export const ConsentRecordSchema = z.object({
  /** 同意レコード UUID */
  id: z.uuid(),
  /** 同意したユーザー */
  userId: UserIdSchema,
  /** 同意の種別 */
  scope: ConsentScopeSchema,
  /**
   * 同意したドキュメントのバージョン (YYYY-MM-DD)。
   * LegalDocumentVersionSchema.version と整合させる。
   */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 同意が記録された日時 (UTC) */
  recordedAt: z.iso.datetime(),
  /**
   * 同意を取り消した日時。null = 現在有効。
   * 取消不可 scope (legal_terms / privacy_policy) では原則 null のまま。
   */
  revokedAt: z.iso.datetime().nullable(),
  /**
   * 同意記録時の IP アドレス。PII のため暗号化または別途保持期間制限を設ける。
   * Sprint 3 では暗号化なしで記録し、退会後 30 日で削除する。
   */
  ipAddress: z.string().nullable(),
  /** HTTP User-Agent (監査証跡用) */
  userAgent: z.string().nullable(),
  /**
   * 同意を取得した文脈 (source)。
   * - onboarding: オンボーディング画面
   * - incoming_call_first_time: 着信応答後初回通話前
   * - settings_screen: Settings → プライバシーと同意 画面
   * - terms_revision_prompt: 規約改訂バナー経由
   */
  source: z.enum([
    "onboarding",
    "incoming_call_first_time",
    "settings_screen",
    "terms_revision_prompt",
  ]),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

// ============================================================
// §3.4 RequiredConsentView — UI 表示用同意状態ビュー
// ============================================================

/**
 * AuthFacade.getRequiredConsents() の返り値要素。
 * mobile は各 scope の状態をこの型で受け取り、Consent Screen の表示を制御する。
 */
export const RequiredConsentViewSchema = z.object({
  /** 対象 scope */
  scope: ConsentScopeSchema,
  /** LegalDocumentVersion における最新バージョン */
  currentVersion: z.string(),
  /**
   * ユーザーが同意済みのバージョン。
   * null = 一度も同意していない。
   */
  userVersion: z.string().nullable(),
  /** この scope が機能利用に必須か（false = オプショナル） */
  isRequired: z.boolean(),
  /** userVersion === currentVersion (同意が最新版か) */
  isUpToDate: z.boolean(),
  /** 規約本文 URL (null = 別途説明文のみ) */
  documentUrl: z.url().nullable(),
});
export type RequiredConsentView = z.infer<typeof RequiredConsentViewSchema>;

// ============================================================
// §3.5 Domain Events — auth モジュールが発行するドメインイベント
// ============================================================

/**
 * 同意記録時に EventBus で発行するイベント。
 * 将来の analytics / audit モジュールが購読する。
 * Phase 1 では購読者なし（EventBus に発行するが誰も受け取らない）。
 */
export const AuthConsentRecordedEventSchema = DomainEventBase.extend({
  type: z.literal("auth.consent_recorded"),
  payload: z.object({
    userId: UserIdSchema,
    scope: ConsentScopeSchema,
    version: z.string(),
    source: z.enum([
      "onboarding",
      "incoming_call_first_time",
      "settings_screen",
      "terms_revision_prompt",
    ]),
    recordedAt: z.iso.datetime(),
  }),
});
export type AuthConsentRecordedEvent = z.infer<typeof AuthConsentRecordedEventSchema>;

/**
 * 同意取消時に EventBus で発行するイベント。
 * voice_to_openai 取消で Translation Agent に停止信号を送る仕組みは Phase 2 以降。
 */
export const AuthConsentRevokedEventSchema = DomainEventBase.extend({
  type: z.literal("auth.consent_revoked"),
  payload: z.object({
    userId: UserIdSchema,
    scope: ConsentScopeSchema,
    version: z.string(),
    revokedAt: z.iso.datetime(),
  }),
});
export type AuthConsentRevokedEvent = z.infer<typeof AuthConsentRevokedEventSchema>;
```

### 3.4 DB スキーマ拡張 (Sprint 3 migration 要件)

現在の `trancall_auth.consent_versions` テーブル（`00001_initial_schema.sql` §15）は scope 概念がなく、単純なバージョン管理にとどまる。Sprint 3 で以下の migration を追加する:

```sql
-- supabase/migrations/00007_add_user_consents_table.sql
-- ユーザー個別同意記録テーブル
CREATE TABLE trancall_auth.user_consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  scope           VARCHAR(30) NOT NULL
                    CHECK (scope IN (
                      'legal_terms', 'privacy_policy', 'voice_to_openai',
                      'transcript_retention', 'data_deletion_request',
                      'push_notification', 'marketing_email'
                    )),
  version         VARCHAR(20) NOT NULL,  -- YYYY-MM-DD
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  ip_address      TEXT,       -- 暗号化推奨 (Phase 2)
  user_agent      TEXT,
  source          VARCHAR(40) NOT NULL
                    CHECK (source IN (
                      'onboarding', 'incoming_call_first_time',
                      'settings_screen', 'terms_revision_prompt'
                    )),
  UNIQUE (user_id, scope, version)  -- 同一バージョンへの重複同意防止
);

-- 最新同意取得用インデックス
CREATE INDEX idx_user_consents_user_scope
  ON trancall_auth.user_consents(user_id, scope, recorded_at DESC);

ALTER TABLE trancall_auth.user_consents ENABLE ROW LEVEL SECURITY;

-- 自分の同意記録のみ読める (管理側書き込みは service_role)
CREATE POLICY user_consents_self_read ON trancall_auth.user_consents
  FOR SELECT USING (user_id = auth.uid());

-- supabase/migrations/00008_extend_consent_versions.sql
-- 既存 consent_versions テーブルに scope 列を追加
ALTER TABLE trancall_auth.consent_versions
  ADD COLUMN scope VARCHAR(30) NOT NULL DEFAULT 'legal_terms'
    CHECK (scope IN (
      'legal_terms', 'privacy_policy', 'voice_to_openai',
      'transcript_retention', 'data_deletion_request',
      'push_notification', 'marketing_email'
    )),
  ADD COLUMN supersedes VARCHAR(20),
  ADD COLUMN change_summary TEXT;
```

---

## 4. AuthFacade 拡張

### 4.1 AuthFacade interface 全体 (Sprint 3 拡張後)

```typescript
// packages/auth/src/facade.ts (Sprint 3 拡張分)

export interface AuthFacade {
  // ─────────────────────────────────────────────────────────
  // 既存メソッド (module-contracts.md §2.1)
  // ─────────────────────────────────────────────────────────

  /** プロフィール取得 (C-005 対応: media module が Token metadata 焼き込み時に呼ぶ) */
  getProfile(userId: UserId): Promise<Result<Profile>>;

  // ─────────────────────────────────────────────────────────
  // [新規 D7] 同意管理メソッド
  // ─────────────────────────────────────────────────────────

  /**
   * 同意を記録する。
   *
   * @param userId   同意したユーザー
   * @param scope    同意の種別
   * @param version  同意したドキュメントバージョン (YYYY-MM-DD)
   * @param source   同意が取得された文脈
   * @param metadata オプション: IP アドレス / User-Agent (監査証跡)
   * @returns        作成された ConsentRecord
   *
   * **冪等性**: 同一 (userId, scope, version) の組み合わせが既に存在する場合、
   *            既存レコードを返す (upsert 相当)。DB UNIQUE 制約で保証。
   * **副作用**: `auth.consent_recorded` DomainEvent を EventBus に発行する。
   * **retry**: 可 (冪等)。
   */
  recordConsent(
    userId: UserId,
    scope: ConsentScope,
    version: string,
    source: ConsentRecord["source"],
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<Result<ConsentRecord>>;

  /**
   * 指定 scope について、requiredVersion に同意済みかチェックする。
   *
   * @returns { ok: true, data: true }  → 同意済み (最新バージョンに)
   * @returns { ok: true, data: false } → 未同意 または バージョン古い
   *
   * **冪等性**: 読み取り専用。副作用なし。
   * **retry**: 可。
   */
  hasConsent(
    userId: UserId,
    scope: ConsentScope,
    requiredVersion: string,
  ): Promise<Result<boolean>>;

  /**
   * 指定 scope の同意を取り消す。
   *
   * 取消不可 scope (legal_terms / privacy_policy) を渡した場合は
   * `AUTH_CONSENT_IRREVOCABLE` エラーを返す。
   *
   * **副作用**:
   * - DB: `user_consents.revoked_at` に現在時刻をセット
   * - `auth.consent_revoked` DomainEvent を EventBus に発行
   * - transcript_retention 取消時: transcript module に `deleteAccess` を送るのは
   *   **server オーケストレーション層の責務**（auth module 直接はしない）
   * **retry**: 可 (既取消済みの場合は ok: true を返す)。
   */
  revokeConsent(
    userId: UserId,
    scope: ConsentScope,
  ): Promise<Result<true>>;

  /**
   * ユーザーが同意すべき scope 一覧と現在の状態を返す。
   *
   * mobile はアプリ起動時・通話前・Settings 表示時にこのメソッドを呼び、
   * 必要な同意画面を表示するかどうかを判断する。
   *
   * 返り値は RequiredConsentView の配列。`isRequired=true` かつ `isUpToDate=false`
   * の scope が存在すれば、Consent Screen を表示する。
   *
   * **冪等性**: 読み取り専用。副作用なし。
   * **retry**: 可。
   * **ソート順**: isRequired=true を先頭に、次いで scope の優先度順。
   */
  getRequiredConsents(
    userId: UserId,
  ): Promise<Result<RequiredConsentView[]>>;
}
```

### 4.2 ConsentRepository (DI 要求)

```typescript
// packages/auth/src/repositories/consent-repository.ts

export interface ConsentRepository {
  /** 同意レコードを upsert する */
  upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>>;
  /** 最新の有効な同意を取得する (revokedAt IS NULL) */
  findActive(userId: UserId, scope: ConsentScope): Promise<Result<ConsentRecord | null>>;
  /** scope 別に全有効同意を取得する */
  listActive(userId: UserId): Promise<Result<ConsentRecord[]>>;
  /** 同意を取り消す */
  revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>>;
}

export interface LegalDocumentVersionRepository {
  /** scope の最新バージョンを取得する */
  findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion | null>>;
  /** 全 scope の最新バージョンを取得する */
  findAllLatest(): Promise<Result<LegalDocumentVersion[]>>;
}
```

### 4.3 実装ルール

- `recordConsent` は `upsert` を使用し、DB UNIQUE 制約 `(user_id, scope, version)` に依存して冪等性を実現する
- `getRequiredConsents` は `findAllLatest()` で全 scope の最新バージョンを取得し、`listActive(userId)` と突き合わせて `RequiredConsentView` を構築する
- `marketing_email` は `isRequired: false` で返す（Phase 2 スコープ、Phase 1 では skip 可）
- `data_deletion_request` は通常の一覧には含めない（退会フロー専用 scope）
- イベント発行は `try/catch` してサイレントに失敗させる（EventBus 未接続時にも同意記録が止まらない）

---

## 5. 同意の種別とライフサイクル

### 5.1 scope 一覧

| scope | 必須度 | 取得タイミング | 取消可否 | 取消時の影響 |
|---|---|---|---|---|
| `legal_terms` | **必須 P0** | アカウント作成時 (Onboarding §6.1) + 改訂時 | 不可 (退会が必要) | — |
| `privacy_policy` | **必須 P0** | アカウント作成時 (Onboarding §6.1) + 改訂時 | 不可 (退会が必要) | — |
| `voice_to_openai` | **必須 P0** (通話機能に必要) | 初回翻訳通話前 (§6.2) | 可 (Settings §6.4) | 翻訳通話不可、原音のみ通話に降格 |
| `transcript_retention` | 任意 (デフォルト ON) | 初回翻訳通話前 (§6.2、voice_to_openai と同時) | 可 (Settings §6.4) | 通話後トランスクリプト非保存。過去分は retention batch で物理削除 |
| `data_deletion_request` | **必須** (退会時のみ) | 退会フロー内 (§11) | — (退会確認のみ) | 退会処理実行 |
| `push_notification` | 任意 (デフォルト ON) | 初回着信時 (iOS POST_NOTIFICATIONS 権限要求と連動) | 可 (iOS 設定アプリ経由) | 着信通知が届かない。VoIP Push 自体は別系統のため影響は通知 UI のみ |
| `marketing_email` | 任意 (デフォルト OFF) | Settings §6.4 / Phase 2 | 可 | メール配信停止 |

### 5.2 バージョン管理

- バージョン形式: `YYYY-MM-DD`（例: `2026-05-12`）
- 同一日に複数改訂が発生した場合: `2026-05-12-r2` のようにサフィックスを付ける（DB 側は VARCHAR(20)）
- **規約改訂時の再同意要否**:
  - `legal_terms` / `privacy_policy`: 改訂時は全ユーザーに再同意が必要（`requires_reconsent=true`）
  - `voice_to_openai`: OpenAI のプライバシーポリシー変更が重大な場合のみ（法務判断）
  - `transcript_retention` / `push_notification` / `marketing_email`: ユーザー設定性質のため再同意不要

### 5.3 consent_versions レコードの初期データ

Sprint 3 migration で以下を INSERT する:

```sql
INSERT INTO trancall_auth.consent_versions
  (version, scope, effective_at, description, policy_url, requires_reconsent, change_summary)
VALUES
  ('2026-05-12', 'legal_terms',
   '2026-05-12T00:00:00Z',
   '初版利用規約',
   'https://trancall.app/terms',
   TRUE, NULL),
  ('2026-05-12', 'privacy_policy',
   '2026-05-12T00:00:00Z',
   '初版プライバシーポリシー',
   'https://trancall.app/privacy',
   TRUE, NULL),
  ('2026-05-12', 'voice_to_openai',
   '2026-05-12T00:00:00Z',
   'OpenAI への音声送信同意 (GPT-Realtime-Translate)',
   NULL, FALSE, NULL),
  ('2026-05-12', 'transcript_retention',
   '2026-05-12T00:00:00Z',
   'トランスクリプト保持期間同意 (プラン別)',
   NULL, FALSE, NULL),
  ('2026-05-12', 'push_notification',
   '2026-05-12T00:00:00Z',
   'Push 通知許可',
   NULL, FALSE, NULL);
```

---

## 6. 同意フロー UI シーケンス

### 6.1 Onboarding 同意フロー

**トリガー**: 新規ユーザーのアカウント作成完了直後。

```
[New User Sign Up 完了]
    ↓
[Onboarding Screen 1: ようこそ TranCall へ]
  Title: "すべての通話を、自分の言語で。"
  CTA: "はじめる"
    ↓
[Onboarding Screen 2: 利用規約とプライバシーポリシー]
  ┌───────────────────────────────────────────────────────┐
  │ □ 利用規約 に同意します                               │
  │     └→ [利用規約を読む] → https://trancall.app/terms  │
  │ □ プライバシーポリシー に同意します                   │
  │     └→ [プライバシーポリシーを読む] → /privacy        │
  │                                                       │
  │ [次へ] ← 両方チェックしないと非活性                   │
  └───────────────────────────────────────────────────────┘
    ↓ (両方チェック後 "次へ" タップ)
mobile → POST /api/auth/consents
  Body: [
    { scope: "legal_terms",    version: "2026-05-12", source: "onboarding" },
    { scope: "privacy_policy", version: "2026-05-12", source: "onboarding" },
  ]
    ↓ (200 OK)
[Home 画面へ遷移]
```

**実装注意**:
- チェックボックスは `@trancall/ui-kit` の `Checkbox` コンポーネントを使用
- 「次へ」ボタンは `disabled` 属性で非活性制御（スタイルだけで制御しない）
- 利用規約 / プライバシーポリシーのリンクは `Linking.openURL()` でブラウザを開く
- POST は Zod `safeParse` を通してから送信

### 6.2 初回翻訳通話前同意フロー (最重要)

**トリガー**: ユーザーが発信または着信に応答した時、`voice_to_openai` が未同意 or バージョン古い場合。

```
[発信タップ OR 着信応答]
    ↓
[Consent Check]
  mobile: const views = await AuthFacade.getRequiredConsents(userId)
  voice_to_openai が isUpToDate=false?
    ↓ YES
[Consent Screen: OpenAI 音声送信の説明]
  ┌───────────────────────────────────────────────────────────────────┐
  │ Title: "翻訳通話には音声の送信が必要です"                         │
  │                                                                   │
  │ TranCall の翻訳通話では、通話中の音声を OpenAI の                 │
  │ 翻訳 API に送信します。                                            │
  │                                                                   │
  │ • 翻訳完了後、音声は OpenAI に保存されません                       │
  │   (OpenAI 零保持ポリシー)                                          │
  │ • 文字起こしは TranCall 側で最大 {plan_retention_days} 日間        │
  │   保存されます (Settings から変更可)                               │
  │ • 詳細は [プライバシーポリシー] をご確認ください                   │
  │                                                                   │
  │ [ 同意して翻訳通話を開始 ]    ← Primary                           │
  │ [ 翻訳なしで通話 (原音のみ) ] ← Secondary                         │
  │ [ キャンセル ]                ← Tertiary                          │
  └───────────────────────────────────────────────────────────────────┘
    ↓ "同意して翻訳通話を開始" タップ
mobile → POST /api/auth/consents
  Body: [
    { scope: "voice_to_openai",      version: "2026-05-12",
      source: "onboarding" or "incoming_call_first_time" },
    { scope: "transcript_retention", version: "2026-05-12",
      source: "onboarding" or "incoming_call_first_time" },
  ]
    ↓ (200 OK)
[通話開始 → Translation Agent 起動]

    ↓ "翻訳なしで通話 (原音のみ)" タップ
[voice_to_openai は記録しない]
[通常通話開始 (Translation Agent 不起動)]

    ↓ "キャンセル" タップ
[通話キャンセル → Pre-call 画面または Home 画面へ戻る]
```

**着信者の同意 (M2-015 対応)**:
- 着信を受けた場合も、応答後初回のみ同意画面を表示する
- `source: "incoming_call_first_time"` で記録する
- CallKit の CXAnswerCallAction が呼ばれてから 5 秒以内に `getRequiredConsents()` を呼び、未同意の場合は通話は保留状態で Consent Screen を表示する
- 同意完了後に通話を音声有効状態に移行する

**`transcript_retention` の説明**:
- `voice_to_openai` に同意するユーザーには、同一画面で `transcript_retention` の説明も含める
- プラン別保持期間 (`plan_retention_days`) は Billing Facade から取得して表示する
- デフォルト: 同意する (チェックボックス ON)。ユーザーが OFF にした場合、`transcript_retention` は記録しない

### 6.3 着信時の同意チェック補足

着信者は CallKit / ConnectionService の制約から、応答前に同意画面を出せない。実装の順序:

```
[着信 VoIP Push 受信]
    ↓
[CallKit reportNewIncomingCall] ← iOS は 5 秒以内必須
    ↓
[ユーザーが応答ボタンをタップ]
    ↓
[CXAnswerCallAction 実行]
    ↓
[LiveKit Room Join (音声無効状態で join)]
    ↓
[getRequiredConsents() → voice_to_openai 未同意?]
    ↓ YES: Consent Screen 表示
    ↓ NO:  通常の通話開始
```

### 6.4 Settings 画面での同意管理

**Settings → プライバシーと同意 画面** (SCR-006 の子画面):

```
[Settings → プライバシーと同意]
  ┌────────────────────────────────────────────────────────────┐
  │ 必須の同意                                                  │
  │ ─────────────────────────────────────────────────────────  │
  │ ✅ 利用規約 (2026-05-12)          [規約を読む →]           │
  │ ✅ プライバシーポリシー (2026-05-12) [ポリシーを読む →]    │
  │                                                            │
  │ 翻訳・通話                                                  │
  │ ─────────────────────────────────────────────────────────  │
  │ ✅ OpenAI への音声送信             [詳細 →] [取消]          │
  │ ✅ トランスクリプト保持 (90日)     [詳細 →] [取消]          │
  │                                                            │
  │ 通知                                                        │
  │ ─────────────────────────────────────────────────────────  │
  │ ✅ Push 通知                       [iOS 設定で変更]         │
  │                                                            │
  │ ─────────────────────────────────────────────────────────  │
  │ [データをダウンロード] (GDPR Art. 20 / Apple 5.1.1(v))     │
  │ [アカウントを削除] → 退会フロー §11                         │
  └────────────────────────────────────────────────────────────┘
```

- `legal_terms` / `privacy_policy` は取消ボタンなし（退会誘導のみ）
- `voice_to_openai` 取消: 確認 dialog → `revokeConsent()` → 翻訳通話不可 toast 表示
- `transcript_retention` 取消: 確認 dialog → `revokeConsent()` → server が `transcript.deleteAccess()` を呼ぶ
- Push 通知取消は iOS 設定アプリを `Linking.openURL("app-settings:")` で開く

### 6.5 規約改訂時の再同意フロー

§13 に詳述。

---

## 7. 利用規約 (Terms of Service) 骨子

> **重要**: 以下は骨子のみ。最終文は外部弁護士の確認後に確定する。本書の記載を公開文書として使用しないこと。

### 7.1 構成 (15 条)

**第 1 条 適用範囲・本サービスの定義**

TranCall（以下「本サービス」）は、株式会社 [運営主体] が提供する GPT-Realtime-Translate を活用したリアルタイム翻訳付き VoIP 通話アプリケーションである。本規約は本サービスの利用に際し、すべてのユーザーに適用される。

**第 2 条 アカウント**

- 本サービスの利用には 13 歳以上の年齢が必要
- 登録可能な認証方式: メールアドレス + パスワード、Sign in with Apple、Google アカウント
- アカウント情報は正確・最新に保つ義務がある
- アカウントの不正利用は直ちに通知すること
- 1 人のユーザーが複数アカウントを持つことは原則禁止

**第 3 条 サブスクリプション・課金**

- プラン構成・月額・含む翻訳分数は `docs/billing-ui-flow.md` の通り
- Free プランは 5 分間の翻訳通話を提供（試用目的）
- サブスクリプションは月次自動更新。解約は次回更新日の前日まで
- iOS App Store / Google Play IAP 経由の購入はプラットフォーム規約が優先
- 翻訳通話品質はネットワーク状況に依存し、品質を保証するものではない
- 詳細は `https://trancall.app/pricing`（法務確認後に確定）

**第 4 条 通話・翻訳機能**

- 翻訳は OpenAI GPT-Realtime-Translate により提供される
- 翻訳精度・遅延はネットワーク品質と API 状況に依存
- 翻訳通話の利用には `voice_to_openai` への同意（第 6 条）が必要
- 同言語同士の通話は翻訳対象外

**第 5 条 禁止行為**

以下の行為は禁止する:
- 法令に違反する行為（詐欺、脅迫、わいせつコンテンツの送信等）
- 他者への迷惑行為（スパム通話、嫌がらせ等）
- 本サービスのリバースエンジニアリング、クローリング
- 複数アカウントを用いた不正利用
- 自動化ツールによる大量通話
- 本サービスを通じた違法なコンテンツの流通

**第 6 条 コンテンツの取扱い**

- 通話音声は OpenAI に送信される（第 7 条・§9 を参照）
- 文字起こし（トランスクリプト）はプラン別の保持期間後に削除される（§10）
- ユーザーはいつでもトランスクリプトの保持に同意しないことができる（§10）
- コンテンツに関するユーザーの権利は第 8 条（データ保持と削除）に従う

**第 7 条 第三者サービス**

本サービスは以下の第三者サービスを利用する:
- **OpenAI** (GPT-Realtime-Translate): 音声翻訳処理。詳細は §9 を参照
- **LiveKit**: リアルタイム音声通信 SFU
- **Supabase**: データベース・認証基盤
- **Stripe**: 決済処理（Web 課金の場合）
- **Apple / Google**: IAP 課金処理

各第三者サービスの利用規約・プライバシーポリシーは各社の定めによる。

**第 8 条 データ保持と削除**

`docs/account-deletion.md` の処理ポリシーに準拠する。
退会リクエストから 30 日間の猶予期間の後、物理削除を実行する。

**第 9 条 知的財産権**

- 本サービスに関する知的財産権はすべて運営主体に帰属する
- ユーザーは本サービスを通じて伝達された自身のコンテンツに対する権利を保持する
- TranCall のロゴ・ブランド資産の無断利用を禁止する

**第 10 条 免責事項**

- 本サービスは現状有姿で提供される（AS IS）
- 翻訳精度・サービス稼働率の保証はしない
- ネットワーク障害・第三者サービス障害による損害について責任を負わない
- 翻訳通話内容の正確性による損害について責任を負わない

**第 11 条 損害賠償の制限**

- 損害賠償額の上限は当月のサブスクリプション料金を限度とする
- ただし、故意または重大な過失による場合は制限しない
- （具体的な金額・制限範囲は外部弁護士確認後に確定）

**第 12 条 規約改訂**

- 規約は予告なく改訂することがある（重要な変更の場合は 30 日前までに通知）
- 改訂後に本サービスを利用した場合は新規約に同意したものとみなす
- ただし重要な変更（データ利用目的の変更等）は再同意が必要（§13 参照）

**第 13 条 準拠法と裁判管轄**

- 本規約の準拠法は日本法とする
- 本サービスに関する紛争の第一審の専属管轄裁判所は東京地方裁判所とする
- 海外からのサービス利用においては現地法との調整が必要（外部弁護士確認後）

**第 14 条 連絡先**

- サービスに関するお問い合わせ: support@trancall.app
- プライバシーに関するお問い合わせ: privacy@trancall.app

**第 15 条 附則・施行日**

- 本規約は 2026 年 XX 月 XX 日より施行する（法務確認後に確定）

### 7.2 多言語化

| 言語 | 状態 | URL |
|---|---|---|
| ja | **必須** (canonical) | `https://trancall.app/terms` |
| en | **必須** | `https://trancall.app/terms?lang=en` |
| zh | Phase 1c 追加予定 | `https://trancall.app/terms?lang=zh` |

### 7.3 バージョン別アーカイブ URL

```
https://trancall.app/terms/2026-05-12       (YYYY-MM-DD バージョン)
https://trancall.app/terms/2026-05-12?lang=en
```

アーカイブは過去に同意した規約の根拠として提供する。`ConsentRecord.version` から対応 URL を生成できる。

---

## 8. プライバシーポリシー骨子

> **重要**: 以下は骨子のみ。最終文は外部弁護士の確認後に確定する。本書の記載を公開文書として使用しないこと。

### 8.1 構成 (12 条)

**第 1 条 取得する情報**

TranCall が収集・利用する個人情報は以下の通り。

| 情報 | 収集方法 | 用途 |
|---|---|---|
| メールアドレス | アカウント登録時 | 認証・サポート対応 |
| User ID (Supabase UUID) | 自動生成 | 全サービス機能の識別 |
| 表示名・アバター | ユーザー任意入力 | 通話先への表示 |
| ネイティブ言語 | ユーザー選択 | 翻訳方向の判定 |
| 通話音声 | 通話中 | OpenAI への翻訳送信（同意取得済み） |
| トランスクリプト | 通話後 | 閲覧・エクスポート機能 |
| デバイストークン (APNs / FCM) | アプリ起動時 | 着信通知配信 |
| IP アドレス・User-Agent | 同意記録時 | 監査証跡 |
| 翻訳利用ログ (分数) | 通話中 | 課金計算 |
| クラッシュレポート | アプリ異常終了時 | 品質改善 (Sentry 等) |

Apple の Privacy Manifest (`NSPrivacyAccessedAPITypes`) に記載する情報と本条は完全整合する（`docs/app-store-submission.md` 参照）。

**第 2 条 利用目的**

- 本サービスの提供・運用・改善
- ユーザーサポートの対応
- 課金・決済処理
- 不正利用・セキュリティ侵害の防止
- 法令への対応
- サービスに関する重要通知の送信
- ユーザーが同意した場合のマーケティング目的の利用

**第 3 条 第三者提供**

以下の場合を除き、個人情報を第三者に提供しない:

| 提供先 | 情報の種類 | 法的根拠 |
|---|---|---|
| OpenAI (米国) | 通話音声 | 同意 (voice_to_openai) + 契約履行 |
| LiveKit (米国) | 音声メディアストリーム (中継のみ) | 契約履行 |
| Supabase (米国・EU) | DB 保存データ全般 | 契約履行 |
| Stripe (米国・EU) | 支払い情報 | 契約履行 |
| Apple (米国・EU) | IAP 購入情報 | 契約履行 |
| APNs / FCM | デバイストークン・着信通知 | 契約履行 |
| 法執行機関 | 法令で要求される情報 | 法令遵守 |

**第 4 条 海外移転**

第 3 条に記載の通り、OpenAI・LiveKit・Supabase・Stripe・Apple への情報移転は日本国外（主に米国・EU）へのデータ移転を伴う。GDPR 域外移転については標準契約条項 (SCC) を活用する（外部弁護士確認後に確定）。

**第 5 条 保管期間**

| データ | 保管期間 |
|---|---|
| プロフィール | 退会後 30 日間 (grace period) → 匿名化 |
| トランスクリプト | プラン別 (Free: 7d / Light: 30d / Standard: 90d / Business: 365d) |
| 通話音声 (OpenAI) | 零保持 (翻訳後に保存しない、OpenAI 零保持ポリシー) |
| 通話音声 (TranCall 側) | 保存しない |
| 課金利用ログ | 退会後 1 年間 (課金監査用) |
| 同意記録 | 退会後も法定保持期間 (GDPR 要件) |
| IP アドレス (同意記録時) | 退会後 30 日で削除 |
| クラッシュレポート | Sentry の設定に準拠 |

**第 6 条 ユーザーの権利**

ユーザーは以下の権利を有する:

- **アクセス権**: 保持されている個人情報の開示請求
- **訂正権**: 不正確な情報の訂正
- **削除権 (忘れられる権利)**: アカウント削除により実現 (§11)
- **データポータビリティ**: Settings → データをダウンロードで実現 (JSON 形式)
- **処理の制限**: transcript_retention 同意の取消で実現
- **異議申し立て**: マーケティングメールのオプトアウトで実現

行使するには privacy@trancall.app に連絡する。30 日以内に対応する。

**第 7 条 クッキー・トラッキング**

TranCall モバイルアプリは追跡用クッキーを使用しない。`NSPrivacyTracking=false`（Apple Privacy Manifest に記載）。

アプリ外の `trancall.app` ウェブサイトにおけるクッキー利用については別途ウェブサイト向けプライバシーポリシーを策定する（Phase 1c）。

**第 8 条 子どもの個人情報**

13 歳未満の方は本サービスを利用することができない。13 歳未満の方の個人情報を意図せず収集した場合、判明次第速やかに削除する。
米国の COPPA・EU の GDPR Article 8 (子どもの同意年齢) への準拠は外部弁護士確認後に確定する。

**第 9 条 セキュリティ対策**

TranCall は以下のセキュリティ対策を講じている:
- 全通信の TLS 1.3 暗号化
- 音声通話の SRTP 暗号化
- Supabase Row Level Security (RLS) による DB アクセス制御
- JWT による認証・認可
- HMAC-SHA256 による Agent-Server 間通信署名

詳細は `docs/security-detail.md` を参照。

**第 10 条 改訂手続き**

プライバシーポリシーの重要な変更は 30 日前にアプリ内バナーおよびメールで通知する。
変更後も本サービスを継続利用した場合は改訂後のポリシーに同意したものとみなす。
ただし第 3 条（第三者提供）の変更は再同意が必要。

**第 11 条 連絡先**

プライバシーに関するお問い合わせ: privacy@trancall.app

**第 12 条 施行日・適用法令**

- 施行日: 2026 年 XX 月 XX 日（法務確認後に確定）
- 日本: 個人情報保護法 (APPI) に準拠
- EU / 欧州経済領域: GDPR に準拠（サービス提供開始後）
- 米国カリフォルニア州: CCPA に準拠（サービス提供開始後）

### 8.2 OpenAI 音声送信の明示 (App Store Review Guideline 5.1.2 対策)

Apple は **App Store Review Guideline 5.1.2** において、ユーザーデータを第三者と共有する場合は明示的な開示とユーザーの同意を要求している。本サービスにおける OpenAI への音声送信は以下の方法で二重に開示する:

1. **プライバシーポリシー第 3 条**: OpenAI を明示的に記載
2. **同意画面 (§6.2)**: 通話前に UI 上で明示

本ポリシーに明記する内容:

```
通話中の音声は、リアルタイム翻訳のために OpenAI, Inc.（米国）が提供する
GPT-Realtime-Translate API（https://platform.openai.com）に送信されます。

OpenAI の零保持ポリシー（https://openai.com/policies/data-privacy）に基づき、
送信された音声データは翻訳処理後に OpenAI によって保存されません。

TranCall 側においても通話音声は保存しません。
文字起こし（トランスクリプト）のみ、プランごとに定められた保持期間保存されます。

音声送信に同意しない場合は「翻訳なしで通話」を選択することができます。
この場合、翻訳機能は使用できませんが通話自体は可能です。
```

---

## 9. OpenAI 音声送信同意

### 9.1 必要な理由

| 理由 | 根拠法令 |
|---|---|
| 音声データの第三者提供（OpenAI）の同意取得 | 個人情報保護法 第 27 条 (第三者提供の制限) |
| 特定処理の合法的根拠の確立 | GDPR 第 6 条 (処理の適法性) |
| App Store でのデータ収集開示要件 | App Store Review Guideline 5.1.2 |

GDPR における合法的処理の根拠は **同意 (consent, Art. 6(1)(a))** を主とし、
翻訳サービス提供の **契約履行 (Art. 6(1)(b))** を補として位置付ける（外部弁護士確認後）。

### 9.2 同意のタイミングと優先度

| フロー | タイミング | source |
|---|---|---|
| 発信 | 発信ボタンタップ直後、通話確立前 | `onboarding` (初回) |
| 着信応答 | CXAnswerCallAction 後、音声有効化前 | `incoming_call_first_time` |
| 2 回目以降の発信 | `voice_to_openai` が `isUpToDate=true` なら Consent Screen をスキップ | — |

### 9.3 同意の有効期限と再取得

| 状況 | 対応 |
|---|---|
| 通常利用 | 同意は永続（バージョン変更まで有効）|
| OpenAI のプライバシーポリシー改定 | 法務判断で `voice_to_openai` バージョンをインクリメント → 再同意要求 |
| ユーザーが Settings で取消 | 取消後は翻訳通話不可。次回発信時に再び Consent Screen を表示 |

### 9.4 「翻訳なしで通話」の実装

```typescript
// apps/mobile/src/screens/consent-screen.tsx

const handleCallWithoutTranslation = async () => {
  // voice_to_openai は記録しない
  // transcript_retention も記録しない
  // CallStore に「translation_disabled」フラグを立てる
  callStore.setTranslationEnabled(false);
  // 通常通話 (Translation Agent 不起動) で発信
  await callStore.startCallWithoutTranslation();
};
```

サーバー側は `translation_enabled=false` の Room では Translation Agent を起動しない。
`docs/architecture.md` §5.5 の言語ペア検出フローに基づき `shouldStartSession()` が `false` を返す。

### 9.5 着信者の同意フロー実装詳細

```typescript
// apps/mobile/src/lib/consent-gate.ts

export async function checkConsentBeforeCall(
  userId: UserId,
  callType: "outgoing" | "incoming",
): Promise<"proceed_with_translation" | "proceed_without_translation" | "cancel"> {
  const views = await authFacade.getRequiredConsents(userId);
  if (views.ok === false) return "cancel";

  const voiceConsent = views.data.find(v => v.scope === "voice_to_openai");
  if (voiceConsent?.isUpToDate) {
    return "proceed_with_translation";
  }

  // Consent Screen を表示し、ユーザーの選択を待つ
  const result = await ConsentScreenModal.show({
    callType,
    currentVersion: voiceConsent?.currentVersion ?? "2026-05-12",
  });

  return result; // "proceed_with_translation" | "proceed_without_translation" | "cancel"
}
```

---

## 10. トランスクリプト保持期間同意

### 10.1 プラン別保持期間

`docs/architecture.md` §6.2 `trancall_transcript.segments.retention_until` と完全整合。

| プラン | 保持期間 | `transcript_retention_days` (DB) |
|---|---|---|
| Free | 7 日 | 7 |
| Light | 30 日 | 30 |
| Standard | 90 日 | 90 |
| Business | 365 日 | 365 |

### 10.2 同意の記録方法

- `ConsentRecord.scope = "transcript_retention"` で記録する
- 保持日数自体は `trancall_billing.subscriptions.transcript_retention_days` で管理
- プランアップグレード時は保持期間が自動延長され、過去セグメントの `retention_until` も更新する（billing module の責務）
- プランダウングレード時は新しい保持期間を超えた過去分が次の日次 retention batch で削除される

### 10.3 同意取消の影響

```
ユーザーが transcript_retention 同意を取消
    ↓
mobile → POST /api/auth/consents/revoke
  Body: { scope: "transcript_retention" }
    ↓
server (auth module): revokeConsent() 実行
    ↓
server (orchestration): transcript.deleteAccess(roomIds, userId) 実行
    ↓
DB: transcript_access.deleted_at = now() (自分のアクセス行のみ)
    ↓
[日次 retention batch]: retention_until < now() の segments を物理削除
```

相手のアクセス行には影響しない（`docs/account-deletion.md` の片側削除ポリシーと整合）。

### 10.4 UI 表示

- 通話前 Consent Screen (§6.2) にプラン別保持日数を動的に表示する
- Settings のプライバシーと同意画面 (§6.4) で現在の保持日数確認とともに取消ボタンを提供する
- プランアップグレードは `docs/billing-ui-flow.md` の Subscription 画面に誘導する

---

## 11. 退会・データ削除同意

> **詳細な退会処理フロー**: `docs/account-deletion.md` が canonical。本章は同意 UI のみを規定し、技術的な削除処理の詳細は重複して記載しない。

### 11.1 退会フロー UI シーケンス

```
[SCR-006 Settings → アカウントを削除]
    ↓
[確認画面: 削除されるデータ一覧]
  ┌─────────────────────────────────────────────────────────┐
  │ アカウントを削除すると、以下のデータが削除されます:    │
  │                                                         │
  │ ✓ プロフィール (表示名、アバター)                        │
  │ ✓ 連絡先リスト                                          │
  │ ✓ 通話履歴へのアクセス                                   │
  │ ✓ トランスクリプト                                       │
  │ ✓ サブスクリプション (即時キャンセル)                    │
  │ ✓ デバイストークン (Push 通知停止)                       │
  │                                                         │
  │ 30 日間の猶予期間後に完全削除されます。                  │
  │ iOS / Android のサブスクを別途解約してください。         │
  │                                                         │
  │ [削除の確認画面へ]   [キャンセル]                        │
  └─────────────────────────────────────────────────────────┘
    ↓
[最終確認 dialog]
  "本当にアカウントを削除しますか?
   この操作は 30 日以内であれば取り消せます。"
  [アカウントを削除する]   [キャンセル]
    ↓ "アカウントを削除する" タップ
[パスワード再確認 (本人確認)]
    ↓
mobile → DELETE /api/auth/account
    ↓
server:
  1. アクティブ通話中か確認 (通話中なら拒否)
  2. ConsentRecord に scope: "data_deletion_request" を記録
  3. Stripe サブスクリプション即時キャンセル
  4. IAP 解約案内メール送信 (自動解約は不可)
  5. データ削除・匿名化処理 (docs/account-deletion.md に従う)
  6. grace period = 30 日 (ログイン可能、復元可能)
    ↓
[サインアウト → オンボーディング画面へ]
[「アカウントを削除しました。30 日以内にログインすると復元できます」]
```

### 11.2 `data_deletion_request` の ConsentRecord

```typescript
// 退会確認時に記録するレコード (退会処理前に記録)
await authFacade.recordConsent(
  userId,
  "data_deletion_request",
  "2026-05-12",
  "settings_screen",
  { ipAddress, userAgent },
);
```

退会後の監査証跡として `user_consents` テーブルに残す。同意記録は法定保持期間まで保持する（`docs/account-deletion.md` 参照）。

---

## 12. Apple アカウント削除要件遵守

### 12.1 App Store Review Guideline 5.1.1(v) の要件

2022 年 6 月以降、App Store Review Guideline **5.1.1(v)** により、アカウント作成機能を持つアプリはアプリ内からアカウント削除を提供することが**必須**となった。

要件の詳細:

| 要件 | TranCall での実装 |
|---|---|
| アプリ内からアカウントを削除できること | Settings → アカウントを削除 (§11.1) |
| 外部ウェブサイトへのリダイレクトのみは不可 | アプリ内で完結する (§11.1) |
| 削除リクエストの確認画面が必要 | 2 段階確認 (一覧 + dialog) (§11.1) |
| 1-2 タップでアクセス可能であること | Settings → アカウントを削除 (1 タップ) |
| IAP サブスクリプションをキャンセルする機能 | Stripe は自動キャンセル、IAP は誘導案内 |

### 12.2 grace period の取扱い

30 日間の grace period は Apple のガイドラインで許容されているが、以下の UI 要件を満たすこと:

1. **削除リクエスト完了直後**: 「アカウントを削除しました。30 日以内にログインすると復元できます」を表示
2. **再ログイン時 (grace period 中)**: バナーで「削除予定: 残り {N} 日」を表示
3. **grace period 内の復元**: Settings に「削除をキャンセルする」ボタンを表示

### 12.3 データダウンロード機能 (GDPR Art. 20)

Settings → プライバシーと同意 → データをダウンロード:

```
mobile → GET /api/auth/data-export
  Response: JSON (profile, contacts, transcripts, billing_history)
```

- Phase 1c でのみ必須（App Store 公開前）
- Phase 1a では「準備中」表示で OK
- データは ZIP + JSON 形式で端末にダウンロード
- エクスポート処理は非同期（30 分以内にメール通知）

---

## 13. 規約改訂時の再同意フロー

### 13.1 フロー概要

```
[運営チームが新バージョンの LegalDocumentVersion を INSERT]
  scope: "legal_terms", version: "2026-08-01", requires_reconsent: TRUE
    ↓
[アプリ起動時]
  mobile: authFacade.getRequiredConsents(userId)
  legal_terms が isUpToDate=false?
    ↓ YES
[Home 画面上部にバナー表示]
  "利用規約が更新されました。30 日以内にご確認ください。"
  [確認する]
    ↓ バナーをタップ
[Consent Update Screen]
  ┌────────────────────────────────────────────────────────────┐
  │ 利用規約が更新されました                                   │
  │                                                            │
  │ 改訂内容:                                                  │
  │ • changeSummary の内容を表示                               │
  │                                                            │
  │ [利用規約の全文を読む →] (ブラウザで開く)                   │
  │                                                            │
  │ [同意して続ける]                                            │
  └────────────────────────────────────────────────────────────┘
    ↓ "同意して続ける" タップ
mobile → POST /api/auth/consents
  Body: [{ scope: "legal_terms", version: "2026-08-01",
           source: "terms_revision_prompt" }]
    ↓
[バナー消失]
```

### 13.2 30 日経過後の強制再同意

```
[30 日経過後も未同意の場合]
  mobile: getRequiredConsents() で isRequired=true かつ isUpToDate=false
    ↓
[アプリ起動時に Consent Required Screen (フルスクリーン、スキップ不可)]
  "規約を確認してください"
  "30 日以内に同意いただけなかったため、一部機能が制限されています。"
  [同意して続ける] ← 同意するまでこの画面から離れられない
    ↓
[同意完了後に通常 Home へ遷移]
```

**機能制限の内容** (30 日経過後):
- 翻訳通話の開始ができない
- 新規 IAP 購入ができない
- 既存 IAP の利用は継続（課金停止は非倫理的なため）

### 13.3 バージョン管理の実装

```typescript
// server: apps/server/src/routes/legal-documents.ts

// 管理者が新バージョンを publish する内部 API
// (Phase 1 では手動 SQL で代替可)
router.post("/internal/legal-documents", requireAdminAuth, async (req) => {
  const parsed = LegalDocumentVersionSchema.safeParse(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  await legalDocVersionRepo.insert(parsed.data);
  // 全 active ユーザーへのバナー表示は getRequiredConsents() の呼び出し時に自動反映される
  // (Push 通知で能動的に知らせる実装は Phase 2)
  return res.status(201).json({ ok: true });
});
```

---

## 14. エラーハンドリング

### 14.1 エラーコード一覧

以下の 4 エラーコードを `docs/module-contracts.md` §5 に追記する:

| エラーコード | 所有モジュール | HTTP | retryable | 発生条件 | UI 動作 |
|---|---|---|---|---|---|
| `AUTH_CONSENT_REQUIRED` | auth | 403 | false | 必須 scope に未同意のまま機能を呼び出した | Consent Screen に遷移。通話は中断 |
| `AUTH_CONSENT_REVOKED` | auth | 403 | false | 通話中または機能利用中にユーザーが Settings で同意を取消した | 機能停止 toast + Consent Screen への誘導 |
| `AUTH_LEGAL_DOC_UNAVAILABLE` | auth | 503 | true | 規約本文の URL (trancall.app/terms 等) がサーバーエラー | 「サーバーが混雑しています。後で再試行してください」 |
| `AUTH_CONSENT_VERSION_MISMATCH` | auth | 409 | false | 同意済みのバージョンより新バージョンが公開済 | 再同意フロー (§13) を起動 |

`AUTH_CONSENT_REQUIRED` はすでに `docs/module-contracts.md` §5 に記載があるが、本書でより詳細な発生条件と UI 動作を canonical に確定する。

### 14.2 エラー文言 (i18n)

`packages/ui-kit/src/i18n/locales/{ja,en,zh}.json` に追記する:

```jsonc
// ja.json (追加分)
{
  "errors": {
    "AUTH_CONSENT_REQUIRED": {
      "title": "同意が必要です",
      "message": "この機能を使用するには、同意が必要です。"
    },
    "AUTH_CONSENT_REVOKED": {
      "title": "同意が取り消されました",
      "message": "この機能は現在ご利用いただけません。"
    },
    "AUTH_LEGAL_DOC_UNAVAILABLE": {
      "title": "接続できません",
      "message": "サーバーが混雑しています。しばらく後に再試行してください。"
    },
    "AUTH_CONSENT_VERSION_MISMATCH": {
      "title": "規約が更新されました",
      "message": "最新の規約にご同意いただく必要があります。"
    }
  }
}
```

```jsonc
// en.json (追加分)
{
  "errors": {
    "AUTH_CONSENT_REQUIRED": {
      "title": "Consent Required",
      "message": "Your consent is required to use this feature."
    },
    "AUTH_CONSENT_REVOKED": {
      "title": "Consent Revoked",
      "message": "This feature is currently unavailable."
    },
    "AUTH_LEGAL_DOC_UNAVAILABLE": {
      "title": "Connection Failed",
      "message": "The server is busy. Please try again later."
    },
    "AUTH_CONSENT_VERSION_MISMATCH": {
      "title": "Terms Updated",
      "message": "Please review and accept the updated terms."
    }
  }
}
```

```jsonc
// zh.json (追加分)
{
  "errors": {
    "AUTH_CONSENT_REQUIRED": {
      "title": "需要同意",
      "message": "使用此功能需要您的同意。"
    },
    "AUTH_CONSENT_REVOKED": {
      "title": "同意已撤销",
      "message": "此功能暂时不可用。"
    },
    "AUTH_LEGAL_DOC_UNAVAILABLE": {
      "title": "连接失败",
      "message": "服务器繁忙，请稍后重试。"
    },
    "AUTH_CONSENT_VERSION_MISMATCH": {
      "title": "条款已更新",
      "message": "请查看并接受最新条款。"
    }
  }
}
```

### 14.3 エラー発生時の遷移図

```
通話開始 API 呼び出し
    ↓
HTTP 403 + code: AUTH_CONSENT_REQUIRED
    ↓
mobile: ConsentScreen を表示 (§6.2)
    ↓ 同意 → POST /api/auth/consents
    ↓ 翻訳なし → callStore.setTranslationEnabled(false)
    ↓ キャンセル → 通話キャンセル

通話中 (voice_to_openai を Settings で取消)
    ↓
AUTH_CONSENT_REVOKED (WebSocket または polling で検知、Phase 2 実装)
    ↓
mobile: 通話中断 toast + Consent Screen へ誘導 (Phase 2)
(Phase 1 では通話終了後に Settings で変更した場合のみ対応)
```

---

## 15. テスト戦略 + 法務レビューチェックリスト

### 15.1 単体テスト

`packages/auth/src/__tests__/consent.test.ts` (Sprint 3 新規):

```typescript
describe("AuthFacade.recordConsent", () => {
  it("同一バージョンへの重複同意は冪等", async () => {
    const r1 = await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "onboarding");
    const r2 = await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "onboarding");
    expect(r1.data.id).toEqual(r2.data.id);
  });

  it("取消不可 scope の revokeConsent は AUTH_CONSENT_IRREVOCABLE を返す", async () => {
    const result = await facade.revokeConsent(userId, "legal_terms");
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("AUTH_CONSENT_IRREVOCABLE");
  });

  it("未同意ユーザーの hasConsent は false を返す", async () => {
    const result = await facade.hasConsent(userId, "voice_to_openai", "2026-05-12");
    expect(result.data).toBe(false);
  });

  it("getRequiredConsents は marketing_email を isRequired=false で返す", async () => {
    const result = await facade.getRequiredConsents(userId);
    const marketing = result.data?.find(v => v.scope === "marketing_email");
    expect(marketing?.isRequired).toBe(false);
  });
});

describe("ConsentScope Zod schema", () => {
  it("有効な scope を受け入れる", () => {
    expect(ConsentScopeSchema.safeParse("voice_to_openai").success).toBe(true);
  });

  it("不正な scope を拒否する", () => {
    expect(ConsentScopeSchema.safeParse("unknown_scope").success).toBe(false);
  });

  it("ConsentRecord の版形式が不正だと拒否する", () => {
    const record = { ...validConsentRecord, version: "v1.0" };
    expect(ConsentRecordSchema.safeParse(record).success).toBe(false);
  });
});
```

### 15.2 統合テスト

`packages/integration-tests/src/__tests__/consent-flow.integration.test.ts` (Sprint 3 新規):

```typescript
describe("同意フロー end-to-end", () => {
  it("Sign up → 同意 → 通話 → 取消 → 通話エラー のフルフロー", async () => {
    // 1. 新規ユーザー作成
    const user = await createTestUser();

    // 2. オンボーディング同意 (legal_terms + privacy_policy)
    const onboardingResult = await authFacade.recordConsent(
      user.id, "legal_terms", "2026-05-12", "onboarding",
    );
    expect(onboardingResult.ok).toBe(true);

    // 3. voice_to_openai 同意
    await authFacade.recordConsent(user.id, "voice_to_openai", "2026-05-12", "onboarding");

    // 4. hasConsent が true を返す
    const hasConsent = await authFacade.hasConsent(user.id, "voice_to_openai", "2026-05-12");
    expect(hasConsent.data).toBe(true);

    // 5. voice_to_openai を取消
    await authFacade.revokeConsent(user.id, "voice_to_openai");

    // 6. hasConsent が false を返す
    const afterRevoke = await authFacade.hasConsent(user.id, "voice_to_openai", "2026-05-12");
    expect(afterRevoke.data).toBe(false);

    // 7. room.createCall が AUTH_CONSENT_REQUIRED を返す (server layer)
    const callResult = await roomFacade.createCall(user.id, [otherUserId],
      { translationEnabled: true });
    expect(callResult.ok).toBe(false);
    expect(callResult.error.code).toBe("AUTH_CONSENT_REQUIRED");
  });
});
```

### 15.3 E2E テスト (Maestro)

`apps/mobile/e2e/flows/` (Sprint 3 新規、`docs/e2e-test-design.md` §13 のフレームワークに準拠):

**onboarding-consent.yaml**:
```yaml
appId: app.trancall
---
- launchApp
- assertVisible: "ようこそ TranCall へ"
- tapOn: "はじめる"
- assertVisible: "利用規約に同意します"
- tapOn: "利用規約に同意します"
- tapOn: "プライバシーポリシーに同意します"
- assertEnabled: "次へ"
- tapOn: "次へ"
- assertVisible: "ホーム"  # Home 画面に遷移済み
```

**first-call-consent.yaml**:
```yaml
appId: app.trancall
---
- launchApp
- tapOn: "連絡先"
- tapOn: "テストユーザー"  # E2E テスト用の固定連絡先
- tapOn: "通話"
- assertVisible: "翻訳通話には音声の送信が必要です"
- tapOn: "同意して翻訳通話を開始"
- assertVisible: "通話中"
```

**consent-revoke.yaml**:
```yaml
appId: app.trancall
---
- launchApp
- tapOn: "設定"
- tapOn: "プライバシーと同意"
- tapOn: "OpenAI への音声送信"
- tapOn: "取消"
- assertVisible: "取消しますか"
- tapOn: "取消する"
- assertVisible: "OpenAI への音声送信: 未同意"
- tapOn: "通話"
- assertVisible: "翻訳通話には音声の送信が必要です"  # 再び Consent Screen
```

### 15.4 法務レビューチェックリスト (外部弁護士向け)

> 以下のチェックリストを外部弁護士に提供し、App Store 提出前に全項目の確認を依頼する。

| # | 確認項目 | 期待結果 | ステータス |
|---|---|---|---|
| 1 | 利用規約 ja の準拠法・裁判管轄 | 日本法 / 東京地方裁判所。海外サービス提供時は別途検討 | 要確認 |
| 2 | 利用規約 en の準拠法・裁判管轄 | 日本法 / 東京地方裁判所。国際仲裁条項の要否を判断 | 要確認 |
| 3 | プライバシーポリシーの個人情報保護法準拠 | 第 1 条〜第 12 条の全項目が個人情報保護法に基づく開示要件を満たす | 要確認 |
| 4 | GDPR 第 6 条 lawful basis の適切な特定 | 同意 (Art. 6(1)(a)) と契約履行 (Art. 6(1)(b)) の使い分けが適切か | 要確認 |
| 5 | GDPR 域外移転 (OpenAI / Supabase / Stripe) の適法性 | SCC 等の適切な転送メカニズムを確認 | 要確認 |
| 6 | CCPA "Do Not Sell" 要件 | 「TranCall はユーザーの個人情報を販売しない」旨の明記 | 要確認 |
| 7 | OpenAI への音声送信の開示の十分性 | §8.2 の開示文言が App Store Review Guideline 5.1.2 を充足するか | 要確認 |
| 8 | 13 歳未満不可の実効性 | 年齢確認方法の有無（アカウント作成時の年齢自己申告のみで十分か） | 要確認 |
| 9 | Apple App Store 5.1.1(v) (アカウント削除) | §12 の実装が Guidelines の要件を完全に満たすか | 要確認 |
| 10 | Apple App Store 5.1.2 (Privacy Policy URL) | App Store Connect に `https://trancall.app/privacy` の登録 | 要確認 |
| 11 | Apple App Store 3.1.2 (Auto-Renewable Subscription) | 利用規約 §3 + Privacy §5 にサブスクリプション情報が適切に明示されているか | 要確認 |
| 12 | 損害賠償上限条項の有効性 | 第 11 条の「当月のサブスクリプション料金を限度」が日本法・各国法で有効か | 要確認 |
| 13 | 同意の撤回権の実装 | Settings からの revokeConsent() が GDPR Art. 7(3) の要件（同等の容易さで撤回可能）を満たすか | 要確認 |
| 14 | データポータビリティ (GDPR Art. 20) | §12.3 のデータダウンロード機能が機械可読な形式 (JSON) で提供されているか | 要確認 |
| 15 | 法定保持期間の根拠 | 同意記録の法定保持期間が日本法 / GDPR で適切に設定されているか | 要確認 |

---

## 16. 改訂履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-05-12 | Sprint 2 D7 設計書 初版。スコープ: `ConsentScope` (7 種) / `ConsentRecord` / `LegalDocumentVersion` / `RequiredConsentView` Zod スキーマ定義。`AuthFacade` 拡張 4 メソッド (`recordConsent` / `hasConsent` / `revokeConsent` / `getRequiredConsents`) の contract + 契約注釈。DB スキーマ拡張要件 (migration 00007 / 00008)。同意フロー UI シーケンス 4 種 (Onboarding / 初回通話前 / 規約改訂時 / Settings)。着信者同意フロー (M2-015 対応)。利用規約 15 条骨子 (ja/en/zh)。プライバシーポリシー 12 条骨子 (ja/en/zh)。OpenAI 音声送信同意 (App Store 5.1.2 対策、零保持ポリシー明示)。トランスクリプト保持期間同意 (プラン別)。退会・データ削除同意 (`docs/account-deletion.md` 参照)。Apple アカウント削除 5.1.1(v) 遵守、grace period UI 要件。規約改訂時の再同意フロー (30 日バナー + 強制再同意)。エラーコード 4 種 (`AUTH_CONSENT_REQUIRED` / `AUTH_CONSENT_REVOKED` / `AUTH_LEGAL_DOC_UNAVAILABLE` / `AUTH_CONSENT_VERSION_MISMATCH`)。i18n エラー文言 ja / en / zh。単体テスト・統合テスト・E2E Maestro フロー 3 種。法務レビューチェックリスト 15 項目。**法的有効性は外部弁護士確認後に確定。本書は骨子と実装 spec を提供する。** |
