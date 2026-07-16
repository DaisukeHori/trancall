# TranCall モジュール間契約 (Module Contracts)

| 項目 | 内容 |
|---|---|
| ドキュメント ID | CONTRACT-001 |
| バージョン | 1.6.2 |
| 作成日 | 2026-05-12 |
| ステータス | canonical (Sprint 2 D5/D7/D8 設計拡張統合済、Issue #69 でリアルタイム品質トラッキング残課題 4 項目を実装済に同期、Issue #67/#72 で auth/contact facade 拡張・新規 HTTP ルートを実装済に同期、M-1/M-9/P-2 実装完了に同期、P-1 (2026-07) で §9 Phase1→2 契約変更 5 件の設計メモ追記・iap チャネル実装済への訂正、Issue #78 でレガシー `recordLegacyConsentVersion`/`LegacyConsentRepository`/`POST /api/auth/consent` を削除し scope 単位の同意フローに一本化) |
| 対象 | Sprint 0 + Layer 1 完了モジュール + Sprint 2 D5/D7/D8 設計フェーズで拡張する billing / auth / shared-kernel 契約 |
| 将来追加対象 | Sprint 3 で `packages/billing/src/facade.ts` (拡張 7 メソッド) / `packages/auth/src/facade.ts` (拡張 4 メソッド) / `packages/shared-kernel/src/schemas/native-call.ts` (新規) を実装、実装完了状態に同期 |

---

## 0. このドキュメントの位置付け

モジュラーモノリスにおいて、Zod スキーマは「**値**の契約」を表すが、それだけでは「**どのモジュールが何を呼べるか / 何を発行するか / 何に依存できるか**」という「**関係**の契約」が不足する。本ドキュメントはその関係の契約を **canonical な単一のソース**として集約する。

### 0.1 関係する設計書との位置関係

| ドキュメント | 役割 |
|---|---|
| **docs/module-contracts.md (本書)** | モジュール間の関係 (canonical) |
| docs/schemas.ts | 全モジュールの Zod 公開境界 (値の契約) |
| docs/architecture.md | アーキテクチャ全体像 + DB スキーマ |
| docs/error-handling.md | エラーコード詳細 (HTTP / retryable / UI 文言) |
| docs/api-spec.md | REST API エンドポイント |
| docs/agent-flow.md | Translation Agent 内部フロー + Server 内部 API |
| docs/call-lifecycle.md | 発信→着信→通話→終話のシーケンス |
| docs/billing-detail.md | reservation → heartbeat → reconcile シーケンス |
| docs/realtime-channels.md | LiveKit Data Channel / Supabase Realtime |
| docs/security-detail.md | JWT / HMAC / RLS 仕様 |
| docs/account-deletion.md | 退会・データ削除フロー |
| packages/\*/CLAUDE.md | 各モジュールの責務と禁止依存 |

### 0.2 ドキュメントの優先順位

実装と本書が乖離した場合の真実のソース:

1. **コードが正**: facade interface (`packages/*/src/facade.ts`) / Zod schema (`packages/*/src/schemas.ts`) / migration (`supabase/migrations/*.sql`)
2. 本書 (canonical) は「コードから抽出された契約集」として **必要な時点で更新する**
3. 設計時の前提・トレードオフは `docs/review-responses-v*.md` を参照

---

## 1. モジュール責務・所有・依存マトリクス

| モジュール | 責務 (1 行) | 所有 DB schema/table | 発行 DomainEvent | 購読 DomainEvent | 公開 Facade | 依存先 |
|---|---|---|---|---|---|---|
| `@trancall/shared-kernel` | Branded Type / Result / Zod ヘルパー / DomainEventBase | — | — | — | (個別関数 export) | (なし、依存される側) |
| `@trancall/auth` | Supabase Auth ラップ・プロフィール管理・**[Sprint 2 D7]** 同意管理 | `trancall_auth.profiles`, `trancall_auth.consent_versions`, **[D7]** `trancall_auth.user_consents` | `auth.user_registered`, **[D7]** `auth.consent_recorded`, `auth.consent_revoked` | — | `AuthFacade` | shared-kernel |
| `@trancall/media` | LiveKit Room CRUD / Token 発行 / Track 命名 (C-005) | (LiveKit Cloud 側) | — | — | `MediaFacade` | shared-kernel, **auth** (Profile lookup) |
| `@trancall/billing` | サブスク / heartbeat 課金 / 4 チャネル決済 (stripe_web / iap_apple / iap_google / **[D5]** storekit_external) | `trancall_billing.subscriptions`, `trancall_billing.usage_windows`, `trancall_billing.usage_reservations`, `trancall_billing.webhook_events`, **[D5]** `trancall_billing.external_purchase_tokens` | **[D5]** `billing.subscription_upgraded`, `billing.subscription_canceled` (将来 `billing.balance_low`) | (将来 `translation.ended`) | `BillingFacade` | shared-kernel |
| `@trancall/contact` | 連絡先 / ブロック / 通報 / 招待 | `trancall_contact.contacts`, `trancall_contact.block_list`, `trancall_contact.report_events`, `trancall_contact.invite_links` | — | — | `ContactFacade` | shared-kernel |
| `@trancall/notification` | APNs VoIP Push / FCM 配信 | `trancall_notification.device_tokens`, `trancall_notification.push_logs` | — | (将来 `room.created`) | `NotificationFacade` | shared-kernel |
| `@trancall/transcript` | 字幕 final segment 永続化 / FTS / Export skeleton | `trancall_transcript.segments`, `trancall_transcript.transcript_access` | — | (将来 `translation.ended`) | `TranscriptFacade` | shared-kernel |
| `@trancall/translation` | Agent event 受信 / session 永続化 / 同言語判定 | `trancall_event.translation_sessions`, `trancall_event.agent_metrics`, `trancall_event.translation_events` (outbox) | `translation.started`, `translation.ended`, `translation.degraded`, `translation.recovered` | — | `TranslationFacade` | shared-kernel |
| `@trancall/ui-kit` | React Native コンポーネント + デザイントークン + i18n | — | — | — | (個別 export) | shared-kernel (型のみ) |
| `@trancall/app-translation-agent` | LiveKit Agent (別プロセス) | (なし、HMAC 経由 Server 送信) | — | — | (CLI entry) | shared-kernel (型のみ) |

### 1.1 所有原則

- **1 テーブル = 1 モジュール所有**: 列追加・migration は所有モジュールの責務
- **共有テーブルなし** (Phase 1 では): 他モジュールの DB を直接読まない、必ず facade 経由
- 例外: `trancall_event.*` (outbox / translation_sessions / agent_metrics) は translation モジュール所有だが、Server の Agent event ハンドラから直接 write される (HMAC 認証経由)

### 1.2 依存方向の原則 (DEPENDENCY-001)

- **shared-kernel ← 全モジュールが依存可** (上位レイヤー)
- **media → auth** (Token metadata 焼き込み時に `getProfile`、C-005)
- **room → billing, media** (Layer 2、`canStartCall` + `createRoom` + `issueAccessToken`)
- **その他のモジュール同士は基本 facade 直接呼び出し禁止** (server オーケストレーション層が組み合わせる、もしくは EventBus 経由)

---

## 2. Facade Contract (TypeScript interface)

各 facade の正式な interface 定義 (Layer 1 完了時点の実装と完全一致)。

### 2.1 AuthFacade
`packages/auth/src/facade.ts`

```ts
export interface AuthFacade {
  // Sprint 1 既存
  getProfile: (userId: UserId) => Promise<Result<Profile, AppError>>;

  // [Issue #67] ユーザー登録完了通知 — `auth.user_registered` DomainEvent を発行 (副作用のみ)
  publishUserRegistered(
    userId: UserId,
    email: string,
    nativeLanguage: string,
  ): Promise<Result<true, AppError>>;

  // [Issue #72.1] facade バイパス是正: 書き込み系メソッド (省略可依存が未注入なら *_NOT_CONFIGURED)
  updateProfile(
    userId: UserId,
    updates: ProfileUpdateFields,
  ): Promise<Result<Profile, AppError>>;

  getProfileDeletionStatus(
    userId: UserId,
  ): Promise<Result<ProfileDeletionStatus | null, AppError>>;

  setProfileDeletedAt(
    userId: UserId,
    deletedAt: string | null,
  ): Promise<Result<true, AppError>>;

  // [Sprint 2 D7 拡張] 同意管理 — `docs/legal-and-consent.md` v1.1 §4 が canonical 詳細
  recordConsent(
    userId: UserId,
    scope: ConsentScope,
    version: string,
    source: ConsentRecord["source"],
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<Result<ConsentRecord, AppError>>;

  hasConsent(
    userId: UserId,
    scope: ConsentScope,
    requiredVersion: string,
  ): Promise<Result<boolean, AppError>>;

  revokeConsent(
    userId: UserId,
    scope: ConsentScope,
  ): Promise<Result<true, AppError>>;

  getRequiredConsents(
    userId: UserId,
  ): Promise<Result<RequiredConsentView[], AppError>>;
}
```

要求 Repository:
```ts
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile, AppError>>;
}

// [Sprint 2 D7 拡張] — canonical 定義は docs/legal-and-consent.md v1.1 §4.2 / §4.3
export interface ConsentRepository {
  upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord, AppError>>;
  findActive(userId: UserId, scope: ConsentScope): Promise<Result<ConsentRecord | null, AppError>>;
  revoke(userId: UserId, scope: ConsentScope): Promise<Result<true, AppError>>;
}

export interface LegalDocumentVersionRepository {
  findLatest(scope: ConsentScope): Promise<Result<LegalDocumentVersion, AppError>>;
  findAllLatest(): Promise<Result<LegalDocumentVersion[], AppError>>;  // 全 scope 一括取得
}

// [Issue #72.1 追加] facade バイパス是正で新設した「省略可能な追加依存」。
// いずれも CreateAuthFacadeOptions で optional 注入 (未注入なら該当メソッドが *_NOT_CONFIGURED を返す)。
export interface ProfileUpdateFields {
  displayName?: string;
  nativeLanguage?: string;
  avatarUrl?: string;
}

export interface ProfileWriteRepository {
  // 差分のみ更新 (undefined フィールドは更新しない)。更新後値の取得は facade が findByUserId で別途行う
  update(userId: UserId, updates: ProfileUpdateFields): Promise<Result<void, AppError>>;
}

export interface ProfileDeletionStatus {
  deletedAt: string | null;
}

export interface ProfileDeletionRepository {
  // 行が存在しない場合は ok(null) を返す (エラーにしない)
  findStatus(userId: UserId): Promise<Result<ProfileDeletionStatus | null, AppError>>;
  // null を渡すと退会状態を解除する (POST /api/account/restore・サブスク変更失敗時ロールバック)
  setDeletedAt(userId: UserId, deletedAt: string | null): Promise<Result<true, AppError>>;
}
```

`Profile` schema: `packages/auth/src/schemas.ts` の `ProfileSchema` 参照。
`ConsentScope` / `ConsentRecord` / `LegalDocumentVersion` / `RequiredConsentView` schema: 同上 (Sprint 3 で追加、canonical 定義は `docs/legal-and-consent.md` v1.1 §3)。

**契約注釈** (D7 由来):
- `recordConsent` は同一 `(userId, scope, version)` で冪等 (UNIQUE 制約)、副作用として `auth.consent_recorded` DomainEvent を EventBus に発行
- `hasConsent` は `revokedAt IS NULL AND version == requiredVersion` を返す
- `revokeConsent` は `legal_terms` / `privacy_policy` scope に対しては `AUTH_CONSENT_IRREVOCABLE` (422) を返す。`docs/account-deletion.md` のアカウント削除フロー経由が必須
- `getRequiredConsents` はアプリ起動時 + 通話開始前にチェックして UI 表示

**契約注釈** (Issue #67 / #72.1 由来):
- `publishUserRegistered` は「登録が完了したこと」を受け取り `auth.user_registered` DomainEvent を発行する副作用のみを担う (サインアップ処理本体は `apps/server` の signup ハンドラ側)。eventBus 未設定時・発行失敗時・`nativeLanguage` が `OutputLanguage` として不正な場合はサイレントに無視し、常に `ok(true)` を返す (`recordConsent` と同方針、呼び出し側のサインアップを止めない)
- `updateProfile` は `ProfileWriteRepository.update` (差分書き込み) 後に `ProfileRepository.findByUserId` で最新値を再取得して返す。`profileWriteRepo` 未注入時は `AUTH_PROFILE_WRITE_NOT_CONFIGURED`
- `getProfileDeletionStatus` / `setProfileDeletedAt` は退会 (soft delete) 状態の read/write。`getProfileDeletionStatus` は行が無くても `ok(null)` を返す (`ProfileRepository` の「行無し = エラー」セマンティクスと異なるため別 Repository)。`profileDeletionRepo` 未注入時は `AUTH_PROFILE_WRITE_NOT_CONFIGURED`
- これら 4 メソッドはいずれも Issue #67 (`auth.user_registered` 発行) / Issue #72.1 (直接 supabase 呼び出しの facade 経由化) で追加。`AuthEventBus` の narrowed interface は `AuthUserRegisteredEvent | AuthConsentRecordedEvent | AuthConsentRevokedEvent` を publish 対象とする

**[Issue #78] レガシー `recordLegacyConsentVersion` / `LegacyConsentRepository` は削除済み**:
Sprint 1 由来のレガシー `POST /api/auth/consent` (単数形) が使っていた書き込み経路。以下の三重の契約不一致が判明したため、facade メソッド・repository・route ごと削除した:
1. mobile `revokeConsent()` は `{revoke: true}` を送るが、サーバーの `ConsentSchema` は `{consentVersion: string}` を要求 (常時 400)
2. 書き込み先 `trancall_auth.consent_versions` は `(version, scope)` を PK とする同意文書バージョンのマスタテーブルで、`user_id` 列を持たない (仮に body を直しても 500)
3. 成功レスポンス `{ok: true, data: true}` と mobile 側の parse スキーマ `{success: boolean}` も不一致
ユーザー単位の同意記録は scope 単位の `recordConsent` / `user_consents` テーブル (D7) に一本化されており、mobile は `apps/mobile/src/api/consent-api.ts` の `recordConsent` / `revokeConsentByScope` / `getRequiredConsents` (`POST/GET /api/auth/consents`, `DELETE /api/auth/consents/:scope`) のみを使う。

### 2.2 MediaFacade
`packages/media/src/facade.ts`

```ts
export interface MediaFacade {
  issueAccessToken: (rawRequest: unknown) => Promise<Result<IssueAccessTokenResponse, AppError>>;
  createRoom: (
    roomId: RoomId,
    options?: { emptyTimeoutSec?: number; maxParticipants?: number },
  ) => Promise<Result<void, AppError>>;
  deleteRoom: (roomId: RoomId) => Promise<Result<void, AppError>>;
}
```

要求依存: `LiveKitAdapterConfig` (LiveKit Server SDK 接続情報 + AuthFacade)。

**C-005 重要契約**: `issueAccessToken` は client 入力の `nativeLanguage` を**使わない**。Auth facade の `getProfile(userId)` で DB から取得した値を metadata に焼き込む。`grant.canUpdateOwnMetadata = false`。

### 2.3 BillingFacade
`packages/billing/src/facade.ts`

```ts
export interface BillingFacade {
  // Sprint 1 既存
  getSubscription(userId: UserId): Promise<Result<SubscriptionState, AppError>>;
  recordUsage(cmd: RecordUsageCommand): Promise<Result<SubscriptionState, AppError>>;
  canStartCall(userId: UserId): Promise<Result<true, AppError>>;
  reserveMinutes(
    userId: UserId,
    sessionId: TranslationSessionId,
    minutes: number,
  ): Promise<Result<true, AppError>>;
  reconcile(
    userId: UserId,
    sessionId: TranslationSessionId,
  ): Promise<Result<SubscriptionState, AppError>>;
  refundMinutes(sessionId: TranslationSessionId): Promise<Result<true, AppError>>;
  createCheckoutSession(
    userId: UserId,
    tier: PlanTier,
    channel: "stripe_web" | "storekit_external",
  ): Promise<Result<{ url: string }, AppError>>;
  handleStripeWebhook(rawBody: string, signature: string): Promise<Result<true, AppError>>;
  handleAppleIapWebhook(payload: unknown): Promise<Result<true, AppError>>;
  handleGoogleIapWebhook(payload: unknown): Promise<Result<true, AppError>>;

  // [Sprint 2 D5 拡張] UI フロー連携 — `docs/billing-ui-flow.md` v1.2 §5 が canonical 詳細
  getPlanComparison(userId: UserId): Promise<Result<PlanComparisonView, AppError>>;
  previewUpgrade(userId: UserId, targetTier: PlanTier): Promise<Result<UpgradePreview, AppError>>;
  recordIapTransaction(userId: UserId, transaction: IapTransactionResult): Promise<Result<SubscriptionState, AppError>>;
  startExternalPurchase(userId: UserId, targetTier: PlanTier): Promise<Result<{ redirectUrl: string }, AppError>>;
  completeExternalPurchase(userId: UserId, redirect: StoreKitExternalRedirectResult): Promise<Result<SubscriptionState, AppError>>;
  cancelSubscription(userId: UserId, atPeriodEnd: boolean): Promise<Result<SubscriptionState, AppError>>;
  restorePurchases(
    userId: UserId,
    transactions: IapTransactionResult[],
  ): Promise<Result<{ restoredCount: number; subscription: SubscriptionState | null }, AppError>>;
}
```

要求 Repository: `SubscriptionRepository` / `UsageRepository` / `ReservationRepository` / `WebhookEventRepository` + 3 アダプタ (`StripeAdapter` / `AppleIapAdapter` / `GooglePlayAdapter`)。
**[Sprint 2 D5 拡張]** `ExternalPurchaseTokenRepository` (新規、`trancall_billing.external_purchase_tokens` テーブル所有、`docs/billing-ui-flow.md` v1.2 §15.3 が canonical)。

**契約注釈**:
- `createCheckoutSession` の `channel` 引数は `docs/schemas.ts` の元定義より拡張 (3 チャネル設計 v9 で必要)
- `reserveMinutes` は呼び出し側 (room/server) が事前生成した `sessionId` を受け取り、reservation と usage を 1 通話単位で紐付ける。同一 `sessionId` で 2 回 reserve しても冪等 (PR #15 で実装側を `reserveMinutesWithSession` 経由に統一済み)
- **[D5 拡張]** `previewUpgrade` は同一プラン指定で `BILLING_INVALID_PLAN_CHANGE` (400)、ネットワーク失敗で `BILLING_UPGRADE_PREVIEW_FAILED` (503, retryable)
- **[D5 拡張]** `recordIapTransaction` は `originalTransactionId` UNIQUE で冪等。AppleIapAdapter で JWS 検証、検証失敗で `BILLING_IAP_RECEIPT_INVALID` (400)
- **[D5 拡張]** `startExternalPurchase` / `completeExternalPurchase` は `redirectToken` 5 分 TTL + 1 回限り使い切り (`external_purchase_tokens` で管理)。TTL 切れ / 使用済みは `BILLING_PAYMENT_FAILED`
- **[D5 拡張]** `cancelSubscription` は `atPeriodEnd=true` で期末キャンセル、`false` (即時) は IAP チャネルでは拒否される
- **[D5 拡張]** `restorePurchases` は Apple `StoreKit.Transaction.currentEntitlements` を mobile が列挙して transactions 配列で渡す。restoredCount=0 + subscription=null は正常な空結果として返し、エラーにしない (`BILLING_RESTORE_NO_PURCHASE` は UI 文言テーブルでのみ参照、facade 戻り値ではない)
- **[D5 拡張]** 副作用: `billing.subscription_upgraded` / `billing.subscription_canceled` DomainEvent を EventBus に発行

### 2.4 ContactFacade
`packages/contact/src/facade.ts`

```ts
export interface ContactFacade {
  addContact(cmd: AddContactCommand): Promise<Result<ContactEntry, AppError>>;
  removeContact(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  listContacts(userId: UserId): Promise<Result<ContactEntry[], AppError>>;  // [Issue #72.2] 旧 `Promise<ContactEntry[]>` から変更
  searchUsers(query: string, callerId: UserId): Promise<PublicProfile[]>;
  blockUser(cmd: BlockUserCommand): Promise<Result<true, AppError>>;
  unblockUser(userId: UserId, blockedUserId: UserId): Promise<Result<true, AppError>>;
  reportUser(cmd: ReportUserCommand): Promise<Result<true, AppError>>;
  toggleFavorite(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  createInviteLink(
    userId: UserId,
  ): Promise<Result<{ url: string; token: string; expiresAt: string }, AppError>>;
  consumeInviteLink(token: string, newUserId: UserId): Promise<Result<ContactEntry, AppError>>;
}
```

**契約注釈**:
- **[Issue #72.2 追加]** `listContacts` は `Result<ContactEntry[], AppError>` を返す (旧 `Promise<ContactEntry[]>`)。旧実装は DB エラーを空配列と誤認して握りつぶしていたため、`Result.err` で伝播するよう変更。呼び出し元 (`apps/server/src/routes/contact-routes.ts` の `GET /api/contacts`) も `!result.ok` 時に `getHttpStatus(result.error.code)` で 500 等を返すよう合わせて対応済み
- `consumeInviteLink` は招待トークンを受け取り新規ユーザーを連絡先に追加する。HTTP ルート `POST /api/contacts/invites/:token/consume` (Issue #72.4) から呼ばれる (`docs/api-spec.md` 参照)
- `searchUsers` は呼び出し元 `callerId` を引数で受け取り、callerId がブロックしているユーザーを結果から除外
- `PublicProfile` は `packages/contact/src/schemas.ts` 内で**自前定義**。`email` を含まない (情報露出最小化)
- Rate limit (`searchUsers` 10 req/min/user、`createInviteLink` 10 req/hour/user) は **server middleware で実装** (facade 側では非実装、JSDoc で明示)

### 2.5 NotificationFacade
`packages/notification/src/facade.ts`

```ts
export interface NotificationFacade {
  registerDevice(userId: UserId, target: NotificationTarget): Promise<Result<true, AppError>>;
  unregisterDevice(
    userId: UserId,
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true, AppError>>;
  sendIncomingCall(
    targetUserId: UserId,
    notification: IncomingCallNotification,
  ): Promise<Result<true, AppError>>;
  sendMissedCall(
    targetUserId: UserId,
    payload: MissedCallPayload,
  ): Promise<Result<true, AppError>>;
}
```

**契約注釈**:
- `MissedCallPayload` は `callerTrancallId` を必須 (body フォーマット `"{callerName} ({callerTrancallId})"`、`docs/notification-detail.md` 厳守)
- 配信失敗時は exponential backoff retry (500ms→1000ms→2000ms、最大 3 回)、最終失敗で `NOTIFICATION_PUSH_DELIVERY_FAILED`
- APNs 410 Gone → `NOTIFICATION_DEVICE_TOKEN_INVALID`、トークンを `is_active=false` で revoke
- iOS VoIP Push の topic suffix `.voip` は adapter 内で自動付与

### 2.6 TranscriptFacade
`packages/transcript/src/facade.ts`

```ts
export interface TranscriptFacade {
  appendFinalSegment(segment: TranscriptSegment): Promise<Result<true, AppError>>;
  getTranscript(roomId: RoomId, userId: UserId): Promise<ResultOf<typeof FullTranscriptSchema>>;
  searchSegments(
    roomId: RoomId,
    userId: UserId,
    query: string,
  ): Promise<Result<TranscriptSegment[], AppError>>;
  deleteAccess(roomId: RoomId, userId: UserId): Promise<Result<true, AppError>>;
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: "pdf" | "txt",
  ): Promise<Result<{ contentBase64: string; mime: string; filename: string }, AppError>>;
  validateLiveDelta(rawDelta: unknown): Result<LiveSubtitleDelta, AppError>;
  // [Issue #69 (2)] アクセス権の作成 (冪等)。既存行 (deleteAccess 済みを含む) は上書きしない。
  grantAccess(
    roomId: RoomId,
    userId: UserId,
    consentVersion: string,
  ): Promise<Result<true, AppError>>;
}
```

**契約注釈**:
- DB 保存は `isFinal=true` segment のみ (v9 設計、`is_final` 列なし)
- `appendFinalSegment` は `UNIQUE(room_id, participant_id, sequence_no)` 制約に従い冪等
- `getTranscript` / `searchSegments` は `transcript_access.can_view=true AND deleted_at IS NULL` でフィルタ
- `deleteAccess` は呼び出し元 user の access 行のみ論理削除、相手の access は維持
- `exportTranscript` は Sprint 3 T-9 で実装完了。戻り型に `filename` を追加 (canonical: `transcript-export-spec.md §2.1`、命名規則 `trancall-transcript-YYYYMMDD-HHmm-XXXXXXXX.{pdf|txt}`)。v1.3.0 では `{contentBase64, mime}` のみだったが v1.4.0 で `filename` 追加
- `validateLiveDelta` は mobile 側の LiveKit Data Channel 受信時バリデーション用 (DB 書込みなし)
- 旧 `docs/schemas.ts` 定義の `getLiveSubtitles(roomId): AsyncIterable<LiveSubtitleDelta>` は廃止 (LiveKit Data Channel 配信なので facade 側に AsyncIterable は不要)
- **[Issue #69 (2) 追加]** `grantAccess` は insert-if-absent (`UNIQUE(room_id, user_id)` に既存行があれば何もしない、`deleteAccess` 済みの明示的な opt-out を自動 grant が復活させないため)。`apps/server/src/adapters/transcript-access-subscriber.ts` が `room.participant_joined` を購読し、通話成立時 (2人目以降の参加) に room の現在 join 済み参加者全員へ呼ぶ。詳細は §3.1 / §4.6 参照

### 2.7 TranslationFacade
`packages/translation/src/facade.ts`

```ts
export interface TranslationFacade {
  handleAgentEvent: (event: unknown) => Promise<Result<true, AppError>>;
  getUsage: (agentJobId: string) => Promise<Result<TranslationUsage, AppError>>;
  shouldStartSession: (
    sourceNativeLanguage: OutputLanguage,
    targetNativeLanguage: OutputLanguage,
  ) => boolean;
  validateLiveDelta: (rawDelta: unknown) => Result<LiveSubtitleDelta, AppError>;
}
```

**契約注釈**:
- このパッケージは Server 側で動く軽量パッケージ。OpenAI WebSocket 接続・音声フレーム処理は `apps/translation-agent` 側 (別プロセス)
- `handleAgentEvent` は `event.type` で分岐: `translation.session_started` / `translation.session_ended` / `transcript.delta` / `agent.metrics`
- HMAC 検証・冪等性チェックは呼び出し元 (server の `/internal/agent/events` ハンドラ) の責務
- `shouldStartSession(ja, ja) === false` (同言語ペアは翻訳セッション不要)
- `getUsage` の引数は `agentJobId` (UUID 文字列)、`TranslationSessionId` ではない (Agent 側で生成される job ID と一致)

### 2.8 RoomFacade (Sprint 1 Layer 2 実装済み)

`packages/room/src/facade.ts`

```ts
export interface RoomFacade {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: { translationEnabled: boolean },
  ): Promise<Result<RoomState, AppError>>;
  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState, AppError>>;
  endCall(roomId: RoomId): Promise<Result<RoomState, AppError>>;
  getState(roomId: RoomId): Promise<Result<RoomState, AppError>>;
  // [Issue #104 (L-13) 追加] 通話履歴一覧 (GET /api/rooms/history のバックエンド)
  getRoomHistory(
    userId: UserId,
    query: GetRoomHistoryQuery,
  ): Promise<Result<RoomHistoryResponse, AppError>>;
}
```

依存先: `BillingFacade` (canStartCall)、`MediaFacade` (createRoom / deleteRoom)、`NotificationFacade` (sendIncomingCall)。

要求 Repository:
- `RoomRepository`: `insert` / `findById` / `updateStatus` / **[Issue #104 追加]** `findEndedByParticipantId` (room 所有テーブルのみ参照、終了済み通話をページングで取得)
- `ParticipantRepository`: `upsert` / `findByRoomId` / `setLeftAtForAll` / `findOne` / `markJoined`
- **[Issue #69 (1) 追加]** `BlockListRepository`: `isBlocked(userId, targetUserId): Promise<Result<boolean>>`。`@trancall/contact` が所有する `block_list` テーブルへの read-only view。room は contact を直接 import できない (§6 依存方向マトリクス、room → contact ❌) ため room 側で自己定義したインターフェースであり、`packages/contact` が要求する `ProfileSearchRepository` (§4.4、auth 所有 profiles への read-only view) と同型パターン。apps/server (`adapters/repositories/room/block-list-repository.adapter.ts`) が contact の `BlockRepository` 実装をそのまま包んで満たす
- **[Issue #104 (L-13) 追加]** `RoomHistoryEnrichmentRepository`: 通話履歴一覧に付随する相手ユーザー表示名等を、auth / billing / transcript の所有テーブルから **read-only** で取得する room 自己定義インターフェース。`BlockListRepository` と同型パターン (room は他モジュールを直接 import しない)。apps/server (`adapters/repositories/room/room-history-enrichment-repository.supabase.ts`) が実装を提供する。history-service (`packages/room/src/services/history-service.ts`) が `RoomRepository.findEndedByParticipantId` の結果をこのエンリッチャで補完する

要求: `EventBus` (publish インターフェース)

**契約注釈**:
- `createCall` は `billing.canStartCall` 失敗時、billing が返す `AppError` をそのまま pass-through する (room module は独自 error code を作らない、billing owner code を再利用)
- `media.createRoom` 失敗時は rooms を status='ended' にロールバックして `ROOM_MEDIA_CREATE_FAILED` を返す
- `sendIncomingCall` は best-effort (失敗しても createCall は成功)
- `joinCall` は `waiting → active` 状態遷移を担う (最初の non-host join 時)
- `endCall` は冪等 (既に ended なら OK を返す)
- `media.deleteRoom` は best-effort (失敗しても endCall は成功)
- `billing.reserveMinutes` / `billing.reconcile` は Layer 3 server 側の責務 (room facade では呼ばない)
- **[Issue #69 (1) 追加]** `createCall` は発信者 (creatorId) と各 invitee の間にブロック関係 (双方向) があれば `ROOM_USER_BLOCKED` (403) を返し、DB 書き込み前に中断する
- **[Issue #69 (1) 追加]** `joinCall` は初回 join 時のみ、(a) 現在 join 済みの参加者数が `ROOM_MAX_PARTICIPANTS` (`packages/room/src/constants.ts`、`50`、host 1 + invitee 最大49 の技術的上限) に達していれば `ROOM_FULL` (409)、(b) join しようとしているユーザーと既に join 済みの誰かがブロック関係にあれば `ROOM_USER_BLOCKED` (403) を返す。既に join 済みのユーザーの再 join (冪等パス) はどちらのチェックも通らない
- `notification.sendMissedCall` は Layer 3 server 側の責務 (inviteeIds を room が保持しないため)
- **[Issue #104 (L-13) 追加]** `getRoomHistory` は呼び出しユーザーが参加した終了済み通話を新しい順に返す (`GetRoomHistoryQuery` = `{ limit?; cursor? }`、`RoomHistoryResponse` = `{ rooms: RoomHistoryEntry[]; nextCursor: string | null }`、schema は `packages/room/src/schemas.ts`)。room 所有の rooms/participants からの取得を主とし、相手表示名等の他モジュール所有データは `RoomHistoryEnrichmentRepository` 経由で read-only 補完する (直接 import しない)。エンリッチ失敗は best-effort (表示名欠落でも履歴自体は返す)

---

## 3. DomainEvent Contract

### 3.1 イベント発行・購読マトリクス

| イベント名 | 発行モジュール | 購読モジュール | payload schema | 同期/非同期 | 配信手段 |
|---|---|---|---|---|---|
| `auth.user_registered` | auth | (将来) analytics | `UserRegisteredEvent` | 非同期 | EventBus (in-process pub/sub) |
| `room.created` | room (Layer 2) | notification | `RoomCreatedEvent` | 非同期 | EventBus |
| `room.participant_joined` | room (Layer 2) | translation, **[Issue #69 (2)]** transcript (apps/server の `transcript-access-subscriber.ts` 経由、`transcript.grantAccess` を room の現在参加者全員に呼ぶ) | `ParticipantJoinedEvent` | 非同期 | EventBus |
| `room.participant_left` | room (Layer 2) | translation | `ParticipantLeftEvent` | 非同期 | EventBus |
| `translation.started` | translation | transcript | `TranslationStartedEvent` | 非同期 | EventBus |
| `translation.ended` | translation | **billing**, transcript | `TranslationEndedEvent` | 非同期 | EventBus |
| `translation.degraded` | translation | (a) server: billing(課金除外候補) / metrics、(b) client UI: 直接配信 | `TranslationDegradedEvent` (EventBus 経由) / `TranslationStatusChannelPayload` (Data Channel 経由) — §3.3 §3.4 参照 | 非同期 | **2 系統並列**: (a) EventBus (server 内)、(b) LiveKit Data Channel (Agent → mobile 直接) |
| `translation.recovered` | translation | 同上 | `TranslationRecoveredEvent` / `TranslationStatusChannelPayload` | 非同期 | 同上 |
| `billing.subscription_upgraded` | **[Sprint 2 D5]** billing | (将来) analytics / notification (案内 push) | `BillingSubscriptionUpgradedEvent` | 非同期 | EventBus |
| `billing.subscription_canceled` | **[Sprint 2 D5]** billing | (将来) analytics | `BillingSubscriptionCanceledEvent` | 非同期 | EventBus |
| `auth.consent_recorded` | **[Sprint 2 D7]** auth | (将来) analytics / audit log | `AuthConsentRecordedEvent` | 非同期 | EventBus |
| `auth.consent_revoked` | **[Sprint 2 D7]** auth | (将来) analytics、billing (subscription への影響判定) | `AuthConsentRevokedEvent` | 非同期 | EventBus |

各 event の payload schema canonical:
- `Billing*Event` → `docs/billing-ui-flow.md` v1.2 §4.8
- `Auth*Event` → `docs/legal-and-consent.md` v1.1 §3 (DomainEventBase 拡張型)

### 3.2 EventBus 契約

```ts
// Layer 3 server で提供する統合 EventBus 型 (publish + subscribe)
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent["type"]>(
    eventType: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>,
  ): () => void;  // unsubscribe 関数を返す
}

// 各 publisher module (room など) は publish のみを要求する narrowed interface を内部定義する。
// 例: packages/room/src/event-bus.ts は `interface EventBus { publish(event: RoomDomainEvent) }` のみ。
// これにより room モジュールは自身が発行するイベント型のみを知る (Interface Segregation)。
// Layer 3 server で提供する統合 EventBus 実装は、各モジュール固有 narrowed interface を満たす。
```

実装場所: Layer 3 server で in-process EventBus を提供 (`apps/server/src/event-bus.ts` 予定)。

### 3.3 EventBus payload schema (in-process pub/sub)

各イベントの payload 構造は `docs/schemas.ts` および各モジュールの `schemas.ts` を参照:

- `UserRegisteredEvent` → **[Issue #67] 実装済**: `packages/auth/src/events.ts` の `AuthUserRegisteredEventSchema` (`DomainEventBase.extend`、`type: z.literal("auth.user_registered")`、`payload: { userId: UserIdSchema, email: z.email(), nativeLanguage: OutputLanguage }`)。`AuthFacade.publishUserRegistered` が発行し、`AuthDomainEvent` union (`AuthUserRegisteredEvent | AuthConsentRecordedEvent | AuthConsentRevokedEvent`) の一員として `AuthEventBus` から publish される
- `Room*Event` → `docs/schemas.ts` の Room セクション (Layer 2 で実装)
- `TranslationStartedEvent` / `TranslationEndedEvent` → `packages/translation/src/schemas.ts`
- `TranslationDegradedEvent` / `TranslationRecoveredEvent` — v1.1.0 で追加、下記:

```ts
// packages/translation/src/schemas.ts (v1.1.0 で追加)
// import { DomainEventBase } from "@trancall/shared-kernel/schemas/events";
// import { TranslationSessionId, OutputLanguage } from "@trancall/shared-kernel/schemas/brand";
// NOTE: `AgentJobId` は v1.1.0 時点で shared-kernel に未 brand 化のため当面 `z.uuid()` を使用。
//       Sprint 2 で `AgentJobIdSchema = z.uuid().brand("AgentJobId")` を shared-kernel/brand.ts に追加予定 (別 PR)。
export const TranslationDegradedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.degraded"),
  payload: z.object({
    sessionId: TranslationSessionId,
    agentJobId: z.uuid(),  // 将来 AgentJobId branded type に置換
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
    timestamp: z.iso.datetime(),  // 統一キー名 (EventBus / Data Channel 両系統で突き合わせ可能)
    // 観測値 (degraded 判定の根拠、metrics 結合に使う)
    latencyP95Ms: z.number().int().nonnegative().nullable(),
    consecutiveSilenceMs: z.number().int().nonnegative().nullable(),
  }),
});

export const TranslationRecoveredEventSchema = DomainEventBase.extend({
  type: z.literal("translation.recovered"),
  payload: z.object({
    sessionId: TranslationSessionId,
    agentJobId: z.uuid(),  // 将来 AgentJobId branded type に置換
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    degradedDurationMs: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),  // 統一キー名
  }),
});
```

判定条件と発火タイミングは `docs/translation-pipeline-design.md` §7 が canonical。本書は **契約 (schema + 発行/購読)** のみを規定する。

### 3.4 LiveKit Data Channel Payload Schema (UI 配信用)

EventBus (in-process) は **server プロセス内** の購読しか届かない。mobile UI に低遅延で配信する必要がある以下のイベントは **LiveKit Data Channel** で Agent → クライアント直接配信する:

| event | 用途 | 発行元 | 発行頻度 |
|---|---|---|---|
| `subtitle.delta` | 字幕 (translation の output_transcript.delta) | translation-agent | 翻訳テキスト到着のたび |
| `translation.degraded` | UI に degraded バッジ表示 | translation-agent | degraded 判定瞬間 1 回 |
| `translation.recovered` | UI を normal 表示に復帰 | translation-agent | recovered 判定瞬間 1 回 |

上記 3 種は topic `translation.status` の discriminated union で配信する。M-9 で追加した以下の 1 種は **別 topic** で配信する (通話課金の残量情報を字幕系イベントと混在させないため):

| topic | event | 用途 | 発行元 | 発行頻度 |
|---|---|---|---|---|
| `billing.status` | `{ shouldContinue: boolean, remainingMinutes: number }` | 通話中残量ライブ表示 (M-10 が購読) | translation-agent | heartbeat 応答受信のたび (`heartbeatIntervalMs`、デフォルト 30 秒ごと) |

`billing.status` の発行元は `TranslationSession.sendHeartbeat()` (`apps/translation-agent/src/translation-session.ts`) が `POST /internal/translation/heartbeat` の応答 (M-9 §7.4.2 参照) を受けて `"billing-status"` イベントを emit し、`agent.ts` の `session.on("billing-status", ...)` が `publishBillingStatusChannelData()` で `reliable: true` 送信する (`translation.status` と同じ best-effort 方針)。`shouldContinue=false` の場合は同時に翻訳セッションが `insufficient_balance` で停止するが、Data Channel publish 自体は `shouldContinue` の真偽に関わらず毎回行う。

Data Channel は **reliable** モードで送信 (字幕損失防止)。バイト数を抑えるため flat な discriminated union:

```ts
// packages/translation/src/schemas.ts (v1.1.0 で追加)
// EventBus 側の TranslationDegradedEvent / TranslationRecoveredEvent と timestamp フィールド名を統一済 (突き合わせ用)
export const TranslationStatusChannelPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subtitle.delta"),
    sessionId: TranslationSessionId,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    text: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    isFinal: z.boolean(),
    timestamp: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("translation.degraded"),
    sessionId: TranslationSessionId,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
    timestamp: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("translation.recovered"),
    sessionId: TranslationSessionId,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    degradedDurationMs: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  }),
]);
```

mobile 側 (`apps/mobile/src/lib/livekit/subtitles.ts`) は同 schema で **Zod safeParse** してから Zustand に反映。検証失敗は log のみで UI を更新しない (字幕一発で UI 破綻させない)。

**EventBus 経路と Data Channel 経路は同時発行**: degraded/recovered イベントを Agent は (a) `/internal/agent/events` 経由で server に POST (EventBus 発行) と (b) LiveKit Data Channel publish の両方を実行する。a は metrics / 課金例外処理用、b は UI 即時更新用。両者は **同一の sessionId / timestamp** で対応付け可能。

---

## 4. Repository Contract (DI 要求)

各 facade が外部に求める Repository interface 一覧。実装は `apps/server` (Layer 3) で Supabase ベースの concrete implementation を提供する。

### 4.1 auth が要求する Repository
- `ProfileRepository.findByUserId(userId): Promise<Result<Profile, AppError>>`
- **[Issue #72.1 追加, 省略可]** `ProfileWriteRepository.update(userId, updates)` — `updateProfile` 用の差分書き込み (読み取り専用の `ProfileRepository` とは別 interface に分離)
- **[Issue #72.1 追加, 省略可]** `ProfileDeletionRepository.findStatus(userId)` / `setDeletedAt(userId, deletedAt)` — 退会 (soft delete) 状態の read/write (行無し = `ok(null)` セマンティクス)
- 上記 2 つはいずれも `CreateAuthFacadeOptions` の optional 依存。未注入時は該当メソッドが `AUTH_PROFILE_WRITE_NOT_CONFIGURED` を返す (§2.1 契約注釈参照)。本番実装は `apps/server/src/adapters/repositories/auth/*.supabase.ts`
- **[Issue #78 で削除]** `LegacyConsentRepository.recordConsentVersion(userId, consentVersion)` — レガシー `POST /api/auth/consent` (単数形) 用だったが、三重の契約不一致 (§2.1 参照) のため route ごと削除した

### 4.2 media が要求する依存
- `LiveKitAdapter` (LiveKit Server SDK ラッパー、HTTP/WSS URL + API key/secret + AuthFacade)
- (auth の Facade を受け取るので、auth Repository を間接的に依存)

### 4.3 billing が要求する Repository / Adapter

実装メソッド名と完全一致 (`packages/billing/src/repositories/*.ts` / `packages/billing/src/adapters/*.ts`):

- `SubscriptionRepository`: `findByUserId` / `upsert` / `updatePlan` / `getUsedSecondsInPeriod`
- `UsageRepository`: `insertWindowIdempotent` / `findBySessionId` / `sumDurationSecondsInPeriod`
- `ReservationRepository`: `create` / `findActiveBySessionId` / `reconcile` / `expire` (facade の `refundMinutes` から呼ばれる)
- `WebhookEventRepository`: `insertIdempotent` (UNIQUE(provider, external_event_id) で重複弾き) / `markProcessed` / `markFailed`
- `StripeAdapter` (`createStripeAdapter` factory): `createCheckoutSession` / `verifyWebhook` / `parseCheckoutCompleted` / `parseSubscriptionDeleted`
- `AppleIapAdapter` (`createAppleIapAdapter` factory): JWS デコード (`signedTransactionInfo` の `payload` を Base64URL → JSON)、署名検証は server 側委譲
- `GooglePlayAdapter` (`createGooglePlayAdapter` factory): RTDN Pub/Sub `data` を Base64 → JSON デコード

### 4.4 contact が要求する Repository

実装メソッド名と完全一致 (`packages/contact/src/repositories/*.ts`):

- `ContactRepository`: `add` / `remove` / `list` / `exists` / `toggleFavorite`
- `BlockRepository`: `block` / `unblock` / `isBlocked` / `getBlockedUserIds`
- `InviteRepository`: `create` / `findByToken` / `markUsed`
- `ProfileSearchRepository`: `findByTrancallId` / `searchByDisplayName` (外部 auth の profiles テーブルを検索する read-only ビュー、PublicProfile を返す)
- `ReportRepository`: `create` / `exists`

### 4.5 notification が要求する Repository / Adapter

実装メソッド名と完全一致 (`packages/notification/src/repositories/*.ts` / `adapters/*.ts`):

- `DeviceTokenRepository`: `upsert` / `findActiveByUserId` / `revoke` / `delete`
- `PushLogRepository`: `write`
- `ApnsAdapter` (`createApnsAdapter` factory): `sendVoipPush` / `sendNormalPush` (410 Gone → `NOTIFICATION_DEVICE_TOKEN_INVALID`、`.voip` topic suffix を自動付与)
- `FcmAdapter` (`createFcmAdapter` factory): `sendData` (firebase-admin の `messaging.send` ラッパー、data-only payload)

### 4.6 transcript が要求する Repository

実装メソッド名と完全一致 (`packages/transcript/src/repositories/*.ts`):

- `SegmentRepository`: `upsert` (UNIQUE(room_id, participant_id, sequence_no) 制約で冪等) / `findByRoomId` / `getNextSequenceNo` / `searchByFts`
- `AccessRepository`: `canView` / `softDelete` (自分の `transcript_access.deleted_at` をセット) / `findOne` / **[Issue #69 (2) 追加]** `grant` (insert-if-absent、`UNIQUE(room_id, user_id)` に既存行があれば何もしない)

### 4.7 translation が要求する Repository

実装メソッド名と完全一致 (`packages/translation/src/repositories/*.ts`):

- `TranslationSessionRepository`: `insert` (session_started 受信時) / `updateEnded` (session_ended 受信時) / `findByAgentJobId`
- `AgentMetricsRepository`: `insert` (agent.metrics 受信時)
- `TranslationEventOutboxRepository`: `insert` / `findUnprocessed` / `markProcessed` (DomainEvent outbox パターン用、`trancall_event.translation_events` テーブル、Layer 3 で server から利用)

---

## 5. Error Code Ownership

各モジュールが返すエラーコードの一覧 (`docs/error-handling.md` の完全版にモジュール所有列を加えた表)。

| エラーコード | 所有モジュール | HTTP | retryable | UI 表示文言 |
|---|---|---|---|---|
| `VALIDATION_ERROR` | shared-kernel (共通) | 400 | false | フィールド別エラーメッセージ |
| `RATE_LIMITED` | server (middleware) | 429 | true | 「リクエストが多すぎます」 |
| `INTERNAL_ERROR` | (各モジュール) | 500 | true | 「エラーが発生しました」 |
| `NETWORK_ERROR` | (各 adapter) | — | true | 「接続できません」 |
| `AUTH_INVALID_CREDENTIALS` | auth | 401 | false | 「メールアドレスまたはパスワードが正しくありません」 |
| `AUTH_EMAIL_NOT_VERIFIED` | auth | 403 | false | 「メール認証を完了してください」 |
| `AUTH_TOKEN_EXPIRED` | auth | 401 | true | 自動リフレッシュ |
| `AUTH_CONSENT_REQUIRED` | auth | 403 | false | 同意画面を表示 |
| `AUTH_CONSENT_REVOKED` | **[Sprint 2 D7]** auth | 403 | false | 機能停止 + 再同意画面 |
| `AUTH_LEGAL_DOC_UNAVAILABLE` | **[Sprint 2 D7]** auth | 503 | true | 「接続できません、後で再試行」 |
| `AUTH_CONSENT_VERSION_MISMATCH` | **[Sprint 2 D7]** auth | 409 | false | 再同意フロー起動 |
| `AUTH_CONSENT_IRREVOCABLE` | **[Sprint 2 D7]** auth | 422 | false | 「この同意は取り消せません、退会必要」 |
| `ROOM_NOT_FOUND` | room (Layer 2) | 404 | false | 「通話が見つかりません」 |
| `ROOM_ALREADY_ENDED` | room (Layer 2) | 410 | false | 「この通話は終了しました」 |
| `ROOM_FULL` | room (Layer 2) | 409 | false | 「通話が満員です」 |
| `ROOM_USER_BLOCKED` | room (Layer 2) | 403 | false | 「この相手には発信できません」 |
| `ROOM_USER_NOT_INVITED` | **[確定#2]** room (Layer 2) | 403 | false | 「この通話には招待されていません」(招待されていないユーザーの POST /api/rooms/:id/join を拒否) |
| `BILLING_INSUFFICIENT_BALANCE` | billing | 402 | false | 「翻訳分数が不足しています」 |
| `BILLING_SUBSCRIPTION_EXPIRED` | billing | 402 | false | 「サブスクリプションが期限切れです」 |
| `BILLING_PAYMENT_FAILED` | billing | 402 | true | 「決済に失敗しました」 |
| `BILLING_INVALID_RECEIPT` | billing | 400 | false | 「購入情報の検証に失敗しました」 |
| `BILLING_CHANNEL_NOT_AVAILABLE` | billing | 400 | false | 「この地域では選択された購入チャネルを利用できません」 |
| `BILLING_IAP_RECEIPT_INVALID` | **[Sprint 2 D5]** billing | 400 | false | 「レシート検証エラー、購入を復元」 |
| `BILLING_UPGRADE_PREVIEW_FAILED` | **[Sprint 2 D5]** billing | 503 | true | 「見積取得失敗、再試行」 |
| `BILLING_RESTORE_NO_PURCHASE` | **[Sprint 2 D5]** billing | (UI 文言のみ、HTTP は 200 正常系で `restoredCount=0` を返す) | false | 「復元できる購入がありません」 |
| `BILLING_INVALID_PLAN_CHANGE` | **[Sprint 2 D5]** billing | 400 | false | 「このプラン変更は実行できません」 |
| `TRANSLATION_PROVIDER_ERROR` | translation | 502 | true | 「翻訳サービスに接続できません」 |
| `TRANSLATION_RATE_LIMITED` | translation | 429 | true | 翻訳一時停止 |
| `TRANSLATION_SAFETY_STOP` | translation | 451 | false | 「翻訳が停止しました」 |
| `TRANSLATION_SESSION_LIMIT` | translation | 503 | true | 「現在混雑しています」 |
| `CONTACT_ALREADY_EXISTS` | contact | 409 | false | 「すでに連絡先に追加されています」 |
| `CONTACT_NOT_FOUND` | contact | 404 | false | 「ユーザーが見つかりません」 |
| `CONTACT_SELF_ADD` | contact | 400 | false | 「自分を連絡先に追加できません」 |
| `CONTACT_USER_BLOCKED` | contact | 403 | false | 操作不可 (理由非明示) |
| `NOTIFICATION_PUSH_DELIVERY_FAILED` | notification | 502 | true | サーバー内部リトライ |
| `NOTIFICATION_DEVICE_TOKEN_INVALID` | notification | 400 | false | トークン再登録を要求 |
| `TRANSCRIPT_EXPORT_NOT_IMPLEMENTED` | transcript | 501 | false | 「Sprint 2 で実装予定」 |
| `TRANSLATION_SESSION_NOT_FOUND` | translation | 404 | false | (内部エラー、`getUsage` で agentJobId 不一致時) |

### 5.1 AppError 構造 (shared-kernel)

```ts
const AppError = z.object({
  code: z.string(),               // 上記表の code
  message: z.string(),            // ログ用詳細
  retryable: z.boolean().default(false),
  httpStatus: z.number().int().optional(),
  provider: z.string().optional(),  // 外部 API 由来の場合 ("stripe" / "openai" 等)
  details: z.record(z.string(), z.unknown()).optional(),
});
```

---

## 6. 依存方向マトリクス (DEPENDENCY-002)

縦軸 = 呼び出し元、横軸 = 呼び出し先 (facade import / type import を含む)。

| ↓呼び出し元 / →呼び出し先 | shared-kernel | auth | media | billing | contact | notification | transcript | translation | room | ui-kit | agent |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **shared-kernel** | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **auth** | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **media** | ✅ | ✅ (C-005 Profile lookup) | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **billing** | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ | ⚠️ event (購読 `translation.ended`) | ❌ | ❌ | ❌ |
| **contact** | ✅ | ❌ (型のみ独自 PublicProfile) | ❌ | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **notification** | ✅ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ⚠️ event (購読 `room.created`) | ❌ | ❌ |
| **transcript** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ⚠️ event (購読 `translation.ended`) | ❌ | ❌ | ❌ |
| **translation** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ❌ (Agent からは HMAC API 経由) |
| **room** (Layer 2) | ✅ | ❌ | ✅ (facade) | ✅ (facade) | ❌ | ⚠️ event (発行 `room.*`) | ❌ | ⚠️ event (発行 `room.participant_*`) | — | ❌ | ❌ |
| **ui-kit** | ✅ (型のみ) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| **agent (apps)** | ✅ (型のみ) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (HMAC API 経由) | ❌ | ❌ | — |
| **server (apps)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **mobile (apps)** | ✅ | ❌ (REST API 経由) | ❌ (REST API 経由) | ❌ (REST API 経由) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**凡例**:
- ✅ = facade import 許可
- ❌ = 直接 import 禁止
- ⚠️ event = EventBus 経由のみ許可 (publish or subscribe)

### 6.1 依存違反検出

ESLint `no-restricted-imports` or import 静的解析で違反を検出する CI ジョブを Layer 3 (`L3-3 CI/CD`) で導入予定。

### 6.2 既存設計書との矛盾 (本書 canonical を優先)

`packages/media/CLAUDE.md` の「禁止依存」セクションに「`auth を直接importしない`」という記述が残っているが、これは **C-005 (Token metadata server-side 焼き込み) 解決前の古い記述**である。

現在の正しい契約 (本書 Section 6 の媒体行 + Section 2.2 の MediaFacade 注釈):
- **`@trancall/media` → `@trancall/auth` は許可** (C-005 対応で `AuthFacade.getProfile` を呼び、DB の `nativeLanguage` を LiveKit Token metadata に焼き込むため)
- `packages/media/package.json` の `dependencies` にも `"@trancall/auth": "workspace:*"` が記載済み

`packages/media/CLAUDE.md` の禁止依存記述は次回 docs sweep で削除予定。本書 (canonical) と CLAUDE.md が矛盾した場合は本書を優先する。

---

## 7. Agent ⇔ Server 内部 API Contract

Translation Agent (`apps/translation-agent`) は独立プロセスなので、Server (Layer 3) との通信は HTTP + HMAC で行う。

### 7.1 エンドポイント

```
POST https://api.trancall.app/internal/agent/events
Headers:
  content-type: application/json
  x-trancall-agent: trancall-translation-agent
  x-trancall-signature: <hex HMAC-SHA256 of (body || "|" || idempotencyKey || "|" || timestamp)>
  x-trancall-idempotency-key: <UUID>
  x-trancall-timestamp: <ISO8601, 必須>
```

### 7.2 認証

- HMAC-SHA256 共有鍵 `TRANCALL_AGENT_HMAC_SECRET` (32 文字以上、Agent / Server 両環境変数に同じ値)
- Signature 計算: `createHmac("sha256", secret).update(body + "|" + idempotencyKey + "|" + timestamp).digest("hex")`
- Server 側で `timingSafeEqual` で比較
- `x-trancall-timestamp` (ISO8601) は必須ヘッダー、5 分以内チェックでリプレイ攻撃防止
  (`docs/security-detail.md` §2 参照)。
  **確定#4 (2026-07 敵対的レビュー)**: 旧実装は timestamp を鮮度チェックのみに使い
  署名対象に含めていなかったため、signature をそのままに timestamp だけ「現在時刻」に
  書き換えるリプレイが可能だった。timestamp を署名対象に含め、ヘッダー自体も必須化した
  (Agent 側 `internal-api-client.ts` / Server 側 `hmac-middleware.ts` を同時に更新済み)。

### 7.3 冪等性

- `x-trancall-idempotency-key` (UUID) で重複処理排除
- 冪等性の保証は **event type に応じた個別テーブル** で行う:
  - `translation.session_started` / `session_ended`: `trancall_event.translation_sessions.agent_job_id` (UNIQUE 制約は `supabase/migrations/00006_add_translation_sessions_agent_job_unique.sql` で追加) で重複弾き、既存ならスキップして 200 を返す
  - `transcript.delta`: `trancall_transcript.segments` の `UNIQUE(room_id, participant_id, sequence_no)` 制約で冪等 (final segment のみ DB 保存、partial delta は LiveKit Data Channel)
  - `agent.metrics`: 重複は許容 (時系列ログとして全件保存)
- `trancall_event.translation_events` (outbox テーブル、`event_type CHECK (event_type IN ('translation.started', 'translation.ended', 'translation.degraded', 'translation.recovered'))`) は **Server 内 DomainEvent 発行の outbox パターン用**で、Agent → Server の HTTP 冪等性とは別目的。混同しないこと。

### 7.4 Event Type 一覧

#### 7.4.1 `translation.session_started`
```ts
{
  type: "translation.session_started",
  agentJobId: UUID,
  roomId: UUID,
  sourceParticipantId: UUID,
  targetParticipantId: UUID,
  outputLanguage: string,
  startedAt: ISO8601
}
```
Server 処理: `trancall_event.translation_sessions` に INSERT。`outputLanguage` は `OutputLanguage.safeParse()` で検証 (Agent 側は `string` で送るため)。

#### 7.4.2 `translation.session_ended`
```ts
{
  type: "translation.session_ended",
  agentJobId: UUID,
  roomId: UUID,
  sourceParticipantId: UUID,
  outputLanguage: string,
  endedAt: ISO8601,
  durationMs: int (>=0),
  billableSeconds: int (>=0),  // ceil(durationMs / 1000)
  reason: "participant_left" | "agent_shutdown" | "openai_fatal_error" | "client_requested" | "agent_publish_failed" | "insufficient_balance"
}
```
Server 処理: `trancall_event.translation_sessions` を update。**フィールド `reason` → DB 列 `ended_reason` へマッピング** (DB 列名は予約語回避とセマンティクス明示のため別名を採用、`supabase/migrations/00002_add_translation_sessions_table.sql` のコメント参照)。

`agent_publish_failed` は v1.1.0 で **契約上拡張** (Agent → LiveKit Track publish が連続失敗した場合の終了理由、判定条件は `docs/translation-pipeline-design.md` §10.3)。T8 (Sprint 2) で実装側 Zod schema (`apps/translation-agent/src/internal-api-client.ts` の `TranslationSessionEndedSchema.reason` / `packages/translation/src/schemas.ts` の `TranslationSessionEndedReasonSchema`) と同期済み。

`insufficient_balance` は M-9 で **契約上拡張** (heartbeat 応答 `shouldContinue=false`、残高不足による翻訳セッション停止理由、`docs/billing-detail.md`「通話中断時のフロー」)。通話自体は継続し翻訳のみ停止する。実装側 Zod schema (上記 2 ファイル) は同期済み (reason enum は計 6 値)。

Server で `translation.ended` DomainEvent を発行 → billing が購読して `recordUsage` (実装済み、`apps/server/src/adapters/usage-metering-subscriber.ts`)。

#### 7.4.3 `transcript.delta`
```ts
{
  type: "transcript.delta",
  agentJobId: UUID,
  roomId: UUID,
  sourceParticipantId: UUID,
  outputLanguage: string,
  sequenceNo: int (>=0),
  text: string,
  isFinal: boolean,
  spokenAt: ISO8601
}
```
Server 処理: `isFinal=true` のみ `trancall_transcript.segments` に `appendFinalSegment` 経由で upsert。`isFinal=false` (delta) は受信ログのみ、DB 書き込みなし (LiveKit Data Channel で client に直接配信)。

#### 7.4.4 `agent.metrics`
```ts
{
  type: "agent.metrics",
  agentJobId: UUID,
  roomId: UUID,
  latencyMs: {
    captureToAgent: number[],     // mic capture → Agent 到達
    agentToOpenAI: number[],      // Agent → OpenAI WS 送信
    openAIFirstDelta: number[],   // session.input_audio_buffer.append 送信 → 最初の session.output_audio.delta 受信
    agentPublish: number[],       // audioSource.captureFrame 呼び出し → LiveKit publish 完了
    totalEndToEnd: number[]       // mic capture → Callee 再生
  },
  memoryRssBytes: int (>=0),
  collectedAt: ISO8601
}
```
Server 処理: `trancall_event.agent_metrics` に INSERT (latencyMs は JSONB)。

### 7.5 Schema の単一ソース

Agent 側 (`apps/translation-agent/src/internal-api-client.ts`) の Zod schema が**実装の真**。translation モジュール側 (`packages/translation/src/schemas.ts` の `AgentEventSchema` discriminatedUnion) は Server で再バリデーションするために**独立に Zod 定義**しており、両者は意味的に互換でなければならない (CI で互換性 test を回す予定、Layer 3-3)。

### 7.6 軽微な現状差異 (互換性に影響なし、record only)

- Agent side: `AgentMetricsPayloadSchema.latencyMs[*]` の各配列要素は `z.number()`
- Server side: `AgentMetricsRecordSchema.latencyMs[*]` の各配列要素は `z.number().nonnegative()`
- Agent は正値しか送らないため実害なし。将来統一する場合は Agent 側を `.nonnegative()` に揃える方が安全

---

## 8. 結合シーケンス Index

各 cross-module シナリオがどのドキュメントに記述されているか:

| シナリオ | 関係モジュール | 主要ドキュメント |
|---|---|---|
| 発信→着信→通話→終話 | room, billing, media, notification, translation, transcript | `docs/call-lifecycle.md` |
| 翻訳パイプライン (Agent) | translation, media, agent | `docs/agent-flow.md` |
| heartbeat 課金 (30s window) | billing, agent (heartbeat 送信), server | `docs/billing-detail.md` |
| 字幕配信 (Data Channel) | transcript, agent, mobile | `docs/realtime-channels.md` |
| 退会・データ削除 | auth, contact, billing, transcript, notification | `docs/account-deletion.md` |
| RLS / JWT / HMAC | auth, media, all | `docs/security-detail.md` |
| API エンドポイント (REST) | all (server オーケストレーション) | `docs/api-spec.md` |

---

## 9. Phase 1 → 2 で変更予定の契約

| 契約 | Phase 1 | Phase 2 | 影響 | 状態 (P-1 監査 2026-07) |
|---|---|---|---|---|
| `CreateRoomCommand.inviteeIds` の `max(49)` | 1 人のみ前提 (`min(1).max(49)` だが 1 名のみテスト) | 真にグループ通話 49 名対応 | room facade | 未着手 (大規模、§9.1a) |
| `BillingFacade.createCheckoutSession` の `channel` | `stripe_web` / `storekit_external` | + 海外向け `iap_apple` / `iap_google` の追加 | billing facade | **済 (訂正、§9.1b)** |
| `TranslationFacade` への WebRTC pipeline 切替 | WebSocket 一本 | WebRTC option 並走 | translation, agent | 未着手 (大規模、§9.1c) |
| `ContactFacade` グループ連絡先 | 個別連絡先のみ | group_contact_lists 追加 | contact facade、新規 schema | 未着手 (中〜大規模、§9.1d) |
| Transport Adapter 追加 (TRTC / SIP) | LiveKit のみ | TRTC / SIP adapter 抽象化 | media adapters/ | 未着手 (大規模、§9.1e) |

詳細は `docs/requirements.md` 2. Phase 定義 参照。

### 9.1 各契約変更の実装着手点 (P-1 設計メモ、2026-07 追記)

> **方針**: 上記 5 件は相互依存が強く実装規模も大きいため、本追記では「実装できる非破壊的な
> ものは実装し、大規模なものは契約を明文化して着手点・影響範囲を整理するに留める」方針を採る
> (半端な実装は既存の安定した Phase 1 実装を壊すリスクの方が大きいため)。実装したのは
> **9.1b (billing iap チャネル) のみ**で、これは監査の結果「Phase 1 で既に実装済み」と判明した
> ため §9 表を訂正した (新規コード実装ではなくドキュメント訂正)。他 4 件は設計メモに留める。

#### 9.1a `CreateRoomCommand.inviteeIds` グループ通話 49 名対応 — 【大規模、未着手】

- **現状**: `packages/room/src/facade.ts` の `createCall(creatorId, inviteeIds: UserId[], opts)` は
  型上は複数 `inviteeIds` を受け付け、`apps/server/src/routes/room-routes.ts` の
  `CreateRoomSchema.inviteeIds` も `.min(1).max(49)` (`packages/room/src/constants.ts` の
  `ROOM_MAX_PARTICIPANTS=50` と整合)。しかし Sprint 2 時点のテスト・実装検証は **1 対 1 (1 名招待)**
  のみ。N>1 招待時の以下が未検証・未実装:
  - `notification` への招待 fanout (`NotificationFacade` は 1 対 1 push 前提の可能性、N 名同時送信の
    リトライ/部分失敗ハンドリング未設計)
  - `billing` の複数参加者同時課金 (heartbeat が 1 セッション=1 translation pair 前提、grup call では
    N×(N-1) の翻訳セッションが同時発生し得る、または SFU 側で mixdown する設計判断が必要)
  - `translation` (Agent) の N 者間翻訳ペアリング (現行 `TranslationSession` は 1 発話者 → 1 出力言語
    の 1:1 前提、group call では発話者ごとに複数ターゲット言語への同時翻訳が必要)
  - mobile UI (`apps/mobile/src/screens/in-call-screen.tsx` 等) の N 名グリッド表示・字幕多重表示
- **Phase 2 案**: `RoomFacade.createCall` の `inviteeIds` を実際に 2-49 名で動作させる。
- **影響範囲**: room, billing (heartbeat/reserveMinutes の N 者拡張), translation/agent (N×M
  翻訳セッション管理), notification (fanout), transcript (N 話者分の segment 記録), mobile UI 全面。
- **契約スケルトン (着手点の型シグネチャ、未実装)**:
  ```ts
  // packages/room/src/schemas.ts (案、未実装)
  export interface RoomParticipantState {
    userId: UserId;
    nativeLanguage: OutputLanguage;
    joinedAt: string;
  }
  // RoomFacade.getState() の戻り値を単一 peer 前提から participants: RoomParticipantState[] へ拡張
  ```
- **実装着手点**: (1) `docs/requirements.md` に group call の N 上限・翻訳ペアリング方式 (mixdown か
  N×M セッションか) を確定する設計書セクションを追加 → (2) billing の heartbeat 課金単位を
  「room 単位」か「participant-pair 単位」か確定 → (3) その後 room → translation → billing →
  notification → mobile の順に段階実装。
- **リスクにより見送り**: 課金ロジック (billing) と翻訳セッション管理 (translation/agent) の根幹前提
  (1:1) を変更するため、半端に `inviteeIds` だけ拡張すると「型は複数対応だが実際には課金が壊れる」
  事故になる。設計書確定を優先すべき。

#### 9.1b `BillingFacade.createCheckoutSession` の `iap_apple`/`iap_google` — 【監査の結果、実装済と判明・表を訂正】

- **監査結果**: `packages/billing/src/schemas.ts` の `PurchaseChannel` enum は当初から
  `["free", "iap_apple", "iap_google", "storekit_external", "stripe_web"]` の 5 値を持ち、
  `iap_apple` / `iap_google` は Phase 1 で既に稼働中 (未実装ではない)。実装済みの経路:
  - `BillingFacade.recordIapTransaction()` — StoreKit 2 Transaction をサーバー検証し `purchase_channel: "iap_apple"` でサブスク更新 (`facade.ts:783,807`)
  - `BillingFacade.handleAppleIapWebhook()` / `handleGoogleIapWebhook()` — Apple/Google の webhook を受信・処理 (`facade.ts:566,615`)
  - `packages/billing/src/adapters/apple-iap-adapter.ts` / `iap-adapter.ts` (StoreKit2 canonical) / `google-play-adapter.ts` — 各ストア API アダプタ実装済み
  - `cancelSubscription()` / `reactivateSubscription()` は `channel === "iap_apple" || "iap_google"` の分岐を持ち、Store 側に解約 API が無い制約 (ユーザーは設定アプリ経由でのみ解約) を正しく扱う (`facade.ts:937`)
- **なぜ `createCheckoutSession` だけ `"stripe_web" | "storekit_external"` のままなのか (意図的、Phase 2 でも変更しない)**:
  `createCheckoutSession` は Stripe Checkout Session の **URL を生成する** メソッド
  (`stripeAdapter.createCheckoutSession()` を直接呼ぶ、`facade.ts:368-379`)。ネイティブ IAP
  (`iap_apple`/`iap_google`) は Apple/Google 側のネイティブ購入 UI から開始するもので、
  「Checkout Session URL」という概念が存在しない。したがって `channel` に `iap_apple`/`iap_google`
  を追加することは **設計として誤り** であり、当初の §9 の記載自体が実装と設計意図を正しく
  反映していなかった (ドキュメント側の不備)。本追記でこの認識を訂正する。
- **結論**: コード変更は不要 (既存実装が正)。本表 (§9) の記載を「済」に訂正し、実装着手点が
  必要な項目としては扱わない。関連する残課題 (2 実装 `apple-iap-adapter.ts`/`iap-adapter.ts` の
  統合) は別途 issue 化済 (`sprint3-known-issues.md` §2.2、本 workstream の M-8 に対応、P-1 スコープ外)。

#### 9.1c `TranslationFacade` WebRTC pipeline 切替 — 【大規模、未着手】

- **現状**: `apps/translation-agent` は OpenAI GPT-Realtime-Translate への接続を
  **WebSocket のみ** (`openai-ws-client.ts`) で実装。`packages/translation/src/facade.ts` に
  WebRTC 関連の型・分岐は存在しない (`grep WebRTC` 0 件)。`apps/translation-agent/CLAUDE.md` に
  「Sprint 2 で WebRTC 経路を比較計測し、レイテンシ改善が出れば Phase 1b で切替」という条件付き
  計画のみ記載。
- **Phase 2 案**: OpenAI Realtime API の WebRTC 経路 (`/v1/realtime/translations/client_secrets`
  で短命トークン発行 → クライアント/Agent が直接 WebRTC 接続) を WebSocket と並走させ、
  レイテンシ計測に基づき切替可能にする。
- **影響範囲**: `packages/translation` (facade の接続方式抽象化)、`apps/translation-agent`
  (`openai-ws-client.ts` と並ぶ `openai-webrtc-client.ts` 新設想定)、レイテンシ計測 5 点
  (T3-T6, `translation-session.ts`) の WebRTC 版再定義。
- **契約スケルトン (着手点の型シグネチャ、未実装)**:
  ```ts
  // packages/translation/src/schemas.ts (案、未実装)
  export const TranslationTransport = z.enum(["websocket", "webrtc"]);
  export type TranslationTransport = z.infer<typeof TranslationTransport>;
  // TranslationSessionConfig (apps/translation-agent) に transport?: TranslationTransport を追加、
  // 省略時は "websocket" (既存動作を破壊しない default)
  ```
- **実装着手点**: (1) Sprint 2 計測タスク (`apps/translation-agent/CLAUDE.md` 記載の比較計測) を
  先に実施しレイテンシ改善が実証されてから着手すべき (計測なしの実装は無意味)。(2) 計測後、
  `openai-webrtc-client.ts` を `openai-ws-client.ts` と同一インターフェース
  (`connect`/`sendAudioFrame`/イベント `audio.delta`/`transcript.delta`) で新設し、
  `TranslationSession` からアダプタ選択可能にする。
- **リスクにより見送り**: 翻訳パイプラインの根幹 (音声送出経路) を変更するため、計測データなしに
  実装すると既存の安定した WebSocket 経路を壊すリスクが高い。計測タスクが前提条件。

#### 9.1d `ContactFacade` グループ連絡先 (`group_contact_lists`) — 【中〜大規模、未着手】

- **現状**: `packages/contact/src` に `group_contact_lists` / `GroupContact` 等のグループ関連の
  型・テーブルは存在しない (`grep` 0 件)。`ContactFacade` は個別連絡先 (1 対 1) のみを扱う。
- **Phase 2 案**: 連絡先をグループ化し、グループ単位で一括招待・一括ブロック等ができるようにする。
- **影響範囲**: contact facade (新規メソッド群)、新規 DB スキーマ (`trancall_contact.group_contact_lists`
  / `group_contact_members` 等、要 migration)、room facade (グループ一括招待との連携、9.1a の
  49 名対応と直接依存)、notification (グループ一括通知)。
- **契約スケルトン (着手点の型シグネチャ、未実装)**:
  ```ts
  // packages/contact/src/schemas.ts (案、未実装)
  export const GroupContactListId = z.uuid().brand<"GroupContactListId">();
  export type GroupContactListId = z.infer<typeof GroupContactListId>;

  export const GroupContactList = z.object({
    id: GroupContactListId,
    ownerId: UserIdSchema,
    name: z.string().min(1).max(100),
    memberContactIds: z.array(ContactIdSchema).max(49), // 9.1a のグループ通話上限と整合させる
    createdAt: z.iso.datetime(),
  });
  export type GroupContactList = z.infer<typeof GroupContactList>;

  // ContactFacade 追加メソッド案 (未実装、シグネチャのみ)
  // createGroupContactList(ownerId, name, memberContactIds) => Promise<Result<GroupContactList>>
  // addGroupMember(listId, contactId) => Promise<Result<GroupContactList>>
  // removeGroupMember(listId, contactId) => Promise<Result<GroupContactList>>
  // listGroupContactLists(ownerId) => Promise<Result<GroupContactList[]>>
  // deleteGroupContactList(listId) => Promise<Result<true>>
  ```
- **実装着手点**: (1) migration でテーブル 2 つ (`group_contact_lists`, `group_contact_members`)
  を追加 → (2) `packages/contact/src/repositories/group-contact-repository.ts` 新設 → (3) 上記
  facade メソッド実装 + `__tests__` → (4) `apps/server/src/routes/contact-routes.ts` に
  `POST/GET/DELETE /api/contacts/groups` 系ルート追加 → (5) 9.1a のグループ通話と連携する場合は
  room facade 側の `createCall` に `groupContactListId` オプション引数を追加。
- **中〜大規模と判断し見送った理由**: 新規 DB migration + 新規 repository + 新規 facade メソッド
  群 + 新規 HTTP ルートを要し、「既存 schema への非破壊的追加」の範囲を超える。9.1a (グループ
  通話 49 名) と機能的に強く連動するため、9.1a の設計確定 (N 名時の課金/翻訳/通知方式) を先に
  終えてから着手する方が手戻りが少ない。

#### 9.1e Transport Adapter 追加 (TRTC / SIP) — 【大規模、未着手】

- **現状**: `packages/media/src/adapters/` は `livekit.ts` の 1 実装のみ。`packages/media/src/facade.ts`
  冒頭コメントに「Phase 2 で TRTC を併用する際は…」という将来コメントが 1 箇所あるのみで、
  TRTC/SIP 向けの抽象化・型は未着手 (`grep TRTC/SIP` で他に 0 件)。
- **Phase 2 案**: LiveKit 以外の SFU (Tencent TRTC、中国国内向け) や SIP トランク (固定電話/PSTN
  連携) を Transport Adapter として追加し、`MediaFacade` から抽象化された形で選択可能にする。
- **影響範囲**: `packages/media` (Transport Adapter インターフェース抽出)、`apps/translation-agent`
  (LiveKit 前提の `@livekit/rtc-node` 直接依存を抽象化経由に変更)、room (地域/規制による
  transport 自動選択ロジック)。
- **契約スケルトン (着手点の型シグネチャ、未実装)**:
  ```ts
  // packages/media/src/adapters/transport-adapter.ts (案、未実装)
  export interface TransportAdapter {
    readonly transportKind: "livekit" | "trtc" | "sip";
    createRoom(roomId: RoomId, opts: CreateRoomOptions): Promise<Result<TransportRoomHandle>>;
    generateAccessToken(roomId: RoomId, userId: UserId): Promise<Result<string>>;
    // ... 既存 livekit.ts の公開関数群を interface 化したもの
  }
  ```
- **実装着手点**: (1) 現行 `packages/media/src/adapters/livekit.ts` の公開関数を
  `TransportAdapter` interface として抽出 (LiveKit 実装はそのまま `LiveKitTransportAdapter` として
  interface に適合させる、振る舞い変更なし) → (2) `MediaFacade` の DI を具象 `livekit.ts` 直接依存
  から `TransportAdapter` 経由に変更 → (3) TRTC/SIP は個別の adapter 実装として (2) の後に追加。
- **リスクにより見送り**: 中国向け TRTC・PSTN 向け SIP は現行ユーザー要件 (`docs/requirements.md`)
  で優先度が確定していない上、`@livekit/rtc-node` への直接依存を抽象化する変更は
  `apps/translation-agent` の音声パイプライン全体に触れるため、要件確定前の着手はリスクが高い。

---

## 10. 変更履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-07-11 | 1.6.0 | **P-1 (§9 Phase1→2 契約変更 5 件の監査・設計メモ追記)**。§9.1 に各契約変更の実装着手点セクションを新設し、5 件それぞれについて現状監査・Phase2 案・影響範囲・契約スケルトン (未実装の型シグネチャ例)・実装着手点・見送り理由を明文化した。うち **`BillingFacade.createCheckoutSession` の `iap_apple`/`iap_google`** は監査の結果 **Phase 1 で既に実装済み** (`PurchaseChannel` enum・`recordIapTransaction`・`handleAppleIapWebhook`/`handleGoogleIapWebhook`・`apple-iap-adapter.ts`/`google-play-adapter.ts` が稼働中) と判明したため §9 表の状態列を「済」に訂正した (`createCheckoutSession` 自体が `iap_apple`/`iap_google` を受け付けない設計は意図的、Checkout Session URL という概念がネイティブ IAP に存在しないため)。他 4 件 (グループ通話 49 名対応・WebRTC pipeline 切替・`group_contact_lists`・TRTC/SIP Transport Adapter) は相互依存が強く実装規模が大きい (課金/翻訳パイプラインの根幹前提変更、新規 DB migration、既存音声パイプラインへの抽象化導入を伴う) ため、半端な実装による既存 Phase 1 実装破壊リスクを避け、契約定義・影響範囲整理のみに留めた (コード変更なし、ドキュメントのみ)。|
| 2026-05-12 | 1.0.0 | 初版作成 (Layer 1 完了時点の canonical 抽出) |
| 2026-05-12 | 1.1.0 | D3 反映: `translation.degraded` / `translation.recovered` の DomainEvent payload schema 確定 (§3.3)、LiveKit Data Channel Payload Schema 新規セクション §3.4、§3.1 表の当該行を 2 系統並列 (EventBus + LiveKit Data Channel) に更新、§7.4.2 session_ended の `reason` enum に `agent_publish_failed` を **契約上追加** (実装側 Zod 同期は T8 で実施)、§7.4.4 `openAIFirstDelta` のコメントを公式仕様 (`session.input_audio_buffer.append` → `session.output_audio.delta`) に修正、ヘッダーのバージョン 1.0.0 → 1.1.0、`AgentJobId` を `z.uuid()` で当面運用 (Sprint 2 で brand 化予定)、EventBus / Data Channel 両系統で `timestamp` キー名を統一。判定条件は `docs/translation-pipeline-design.md` §7 に委譲。`architecture.md` §5.3 の旧 Track 名 `mic-a` 表記は本 PR スコープ外、Sprint 2 別 PR で `raw-{participantId}` 形式に統一予定。|
| 2026-05-12 | 1.3.0 | Sprint 2 D5/D7/D8 設計フェーズ統合: **§2.1 AuthFacade 拡張** (`recordConsent` / `hasConsent` / `revokeConsent` / `getRequiredConsents` 4 メソッド追加、`ConsentRepository` / `LegalDocumentVersionRepository` を要求、`docs/legal-and-consent.md` v1.1 §3 §4 が canonical)。**§2.3 BillingFacade 拡張** (`getPlanComparison` / `previewUpgrade` / `recordIapTransaction` / `startExternalPurchase` / `completeExternalPurchase` / `cancelSubscription` / `restorePurchases` 7 メソッド追加、`ExternalPurchaseTokenRepository` を要求、`docs/billing-ui-flow.md` v1.2 §5 が canonical)。**§3.1 DomainEvent 追加** (`billing.subscription_upgraded` / `billing.subscription_canceled` / `auth.consent_recorded` / `auth.consent_revoked` 4 種)。**§5 Error Code 追加** (`AUTH_CONSENT_REVOKED` / `AUTH_LEGAL_DOC_UNAVAILABLE` / `AUTH_CONSENT_VERSION_MISMATCH` / `AUTH_CONSENT_IRREVOCABLE` / `BILLING_IAP_RECEIPT_INVALID` / `BILLING_UPGRADE_PREVIEW_FAILED` / `BILLING_RESTORE_NO_PURCHASE` / `BILLING_INVALID_PLAN_CHANGE` 8 種)。新規 DB schema 所有 (billing が `trancall_billing.external_purchase_tokens`、auth が `trancall_auth.user_consents` を追加所有、Sprint 3 migration 00007/00008 で実装)。すべて設計書としての契約定義であり、実装側 (`packages/auth/src/facade.ts` / `packages/billing/src/facade.ts` / migrations) は Sprint 3 で順次実装、v1.4.0 で実装完了状態に同期する。v1.2.0 は欠番 (D5 単独 PR 時に未発行、D5+D7+D8 を本 v1.3.0 で統合)。|
| 2026-07-12 | 1.6.1 | **Issue #104 (L-13 通話履歴 API) の契約を §2.8 に追記** (WS-2 実装分の doc 同期漏れ補完)。`RoomFacade.getRoomHistory(userId, query: GetRoomHistoryQuery): Promise<Result<RoomHistoryResponse>>` を interface に追加。要求 Repository に `RoomRepository.findEndedByParticipantId` と新規 `RoomHistoryEnrichmentRepository` (auth/billing/transcript 所有データへの read-only view、`BlockListRepository` と同型パターン、apps/server が実装) を追加。契約注釈: 履歴取得は room 所有テーブルを主とし、相手表示名等は best-effort エンリッチ (`packages/room/src/schemas.ts` の `GetRoomHistoryQuery`/`RoomHistoryResponse`/`RoomHistoryEntry`、`history-service.ts` が実装)。|
| 2026-07-12 | 1.6.0 | **未Issue化課題 M-1/M-9/P-2 実装完了に同期**。(1) **M-9 heartbeat 完全版**: `POST /internal/translation/heartbeat` が `{ok:true}` のみ返す簡易版から、billing facade 経由で残量を算出し `{shouldContinue, remainingMinutes}` を返す完全版に変更 (`docs/billing-detail.md`「通話中: heartbeat」step 2, 5 準拠)。`HeartbeatPayload` に `roomId` を追加 (billing 予約の userId 解決に必要、`RoomReservationSessionRepository.findByRoomId` を usage-metering-subscriber.ts (#46) と共用)。shouldContinue は既存の `billing.canStartCall` (残り1分以上 OR 支払い方法ありの超過課金プラン) を再利用。§7.4.2 `session_ended` の `reason` enum に `insufficient_balance` を追加 (heartbeat shouldContinue=false による翻訳セッション停止、`apps/translation-agent/src/translation-session.ts` の `sendHeartbeat()`/`end()` が対応)。**§3.4 に新規 topic `billing.status` を追加** (`{shouldContinue, remainingMinutes}`、mobile 側 M-10 の通話中残量ライブ表示と対をなすクロスモジュール契約、`TranslationSession` の `"billing-status"` イベント → `agent.ts` の `publishBillingStatusChannelData()` で publish)。(2) **M-1 previewUpgrade**: `packages/billing/src/adapters/stripe-adapter.ts` に残っていた未使用の `previewUpgrade` スタブ (proratedAmountYen:0/currentTier:'free' 固定) を削除。実装は既に `stripe-web-checkout-adapter.ts` の `getUpgradePreview` (`stripe.invoices.retrieveUpcoming` による実日割り計算) に一本化済みで facade から正しく呼ばれていたが、テストカバレッジが無かったため追加。(3) **P-2 storekit-external/report**: `BillingFacade.reportExternalPurchaseTransaction` を新規追加 (`ExternalPurchaseAdapter.reportMonthlyTransaction` に委譲、externalPurchaseToken の所有者/stripeSessionId 一致検証後 Apple 月次レポートキューへ登録)。`POST /api/billing/storekit-external/report` (`docs/api-spec.md`) を実装し「未実装 (Phase 2 予定)」の注記を解消。(4) **M-8 (調査のみ、実装変更なし)**: `apple-iap-adapter.ts` (Webhook 解析) と `iap-adapter.ts` (Client Transaction 検証) の「二重実装」課題を調査した結果、両者は productId マッピングを canonical (`APPLE_IAP_PRODUCT_ID_MAP`) に既に一本化済みで、責務分離 (Webhook vs Transaction) が正しい設計であることを確認。未使用の重複ヘルパー (`mapProductIdToTier` / `APPLE_PRODUCT_ID_MAP` 再エクスポート) のみ削除。(5) **L-12 (調査のみ、変更なし)**: `computeHistoryAverageMinutes` (通話履歴平均を pre-call 見積りの想定分数に使用、5 件未満は `DEFAULT_EXPECTED_MINUTES=15` にフォールバック) が既に実装・配線済みであることを確認、`docs/billing-ui-flow.md` §10.1 準拠。|
| 2026-07-11 | 1.5.0 | **Issue #67 / #72 (auth/contact facade バイパス是正・エラー握りつぶし是正・新規 HTTP ルート) 実装完了に同期**。(1) **§2.1 AuthFacade**: 5 メソッド追加 — `publishUserRegistered` (Issue #67、`auth.user_registered` DomainEvent 発行の副作用のみ)、`updateProfile` / `recordLegacyConsentVersion` / `getProfileDeletionStatus` / `setProfileDeletedAt` (Issue #72.1、直接 supabase 呼び出しを facade 経由に是正)。要求 Repository に `ProfileWriteRepository` / `LegacyConsentRepository` / `ProfileDeletionRepository` (+ `ProfileUpdateFields` / `ProfileDeletionStatus` 型) を「省略可能な追加依存」として追加 (§4.1 にも反映、未注入時は `AUTH_PROFILE_WRITE_NOT_CONFIGURED` / `AUTH_CONSENT_NOT_CONFIGURED`)。(2) **§2.4 ContactFacade**: `listContacts` の戻り型を `Promise<ContactEntry[]>` → `Promise<Result<ContactEntry[], AppError>>` に変更 (Issue #72.2、旧実装が DB エラーを空配列と誤認して握りつぶしていた問題の是正。呼び出し元 `GET /api/contacts` も 500 伝播に対応済)。`consumeInviteLink` を呼ぶ新規 HTTP ルート `POST /api/contacts/invites/:token/consume` (Issue #72.4) を追加 (`docs/api-spec.md` にも記載)。(3) **§3.3**: `UserRegisteredEvent` の payload schema 参照を「Layer 3 で追加予定」から実装済 (`packages/auth/src/events.ts` の `AuthUserRegisteredEventSchema`、`AuthDomainEvent` union に `auth.user_registered` を含む) に更新 (Issue #67)。いずれもコード (`packages/auth/src/facade.ts` / `events.ts`、`packages/contact/src/facade.ts`、`apps/server/src/routes/contact-routes.ts`) が正で、本書はそれに同期。|
| 2026-07-11 | 1.4.0 | **Issue #69 (リアルタイム品質トラッキング残課題 4 項目) 実装完了に同期**。(1) **§2.8 RoomFacade**: `createCall`/`joinCall` に `ROOM_USER_BLOCKED` (ブロック関係チェック) / `ROOM_FULL` (`ROOM_MAX_PARTICIPANTS=50` 定員チェック、`packages/room/src/constants.ts`) の実装を反映。新規 `BlockListRepository` (room 自己定義、`@trancall/contact` の `block_list` への read-only view、`ProfileSearchRepository` §4.4 と同型パターン) を要求 Repository に追加。(2) **§2.6 TranscriptFacade**: `grantAccess` メソッド新規追加 (insert-if-absent、冪等)。**§3.1**: `room.participant_joined` の購読モジュールに transcript を追加 (`apps/server/src/adapters/transcript-access-subscriber.ts` が room.getState + transcript.grantAccess を組み合わせるオーケストレーション、room→transcript 直接依存は追加しない)。**§4.6**: `AccessRepository` に `grant` メソッド追加。(3) `apps/translation-agent`: `TranslationSession.end()` が LiveKit `LocalAudioTrack.unpublishTrack` / `AudioSource.close` (`LocalAudioTrack.close(true)` 経由) を呼ぶよう修正 (`attachPublishedAudioResources()` で agent.ts から cleanup コールバックを注入)。旧実装はセッション終了時にこれらを一切呼んでおらずリソースリークしていた。(4) `apps/translation-agent`: `InternalApiClient.postHeartbeat` を新規追加し `TranslationSession` が `heartbeatIntervalMs` (デフォルト 30000ms、`docs/billing-detail.md` の heartbeat 30秒間隔に整合) ごとに `POST /internal/translation/heartbeat` (既存の server 側受信実装 `apps/server/src/routes/agent-routes.ts` の `HeartbeatBodySchema` に合わせた `agentJobId`/`sessionId`/`alive: true`/`occurredAt`/`metrics?` payload、既存の HMAC 署名方式を流用) を送信するよう実装。エージェント側ハートビート送信が従来存在しなかった。|

---

## 付録 A: 契約変更プロセス

新規 facade メソッド追加・既存 signature 変更時の手順:

1. 該当モジュールの implementer が `packages/{module}/src/facade.ts` を変更
2. 同 PR 内で `__tests__/*.test.ts` 更新 (単体)
3. `packages/integration-tests/__tests__/*.integration.test.ts` も更新 (結合)
4. 本書 (`docs/module-contracts.md`) を更新 (Opus 直接編集、メモリポリシー「設計書は Opus 自身が直接書く」)
5. tester で 2 回連続 PASS (メモリポリシー「2 回連続 PASS で完了」)
6. マージ

## 付録 B: モジュール責務の境界判断

「新機能を追加する時、どのモジュールに置くか」の判断基準:

| 判断軸 | 答え |
|---|---|
| 通話/会議のライフサイクル管理 | room |
| 課金・利用量計測 | billing |
| ユーザー・プロフィール | auth |
| 連絡先・ブロック | contact |
| Push 通知配信 | notification |
| 字幕・トランスクリプト | transcript |
| 翻訳エンジン連携 (Server 側) | translation |
| 音声・SFU 接続 | media |
| UI 表示・i18n | ui-kit |
| Translation Agent (別プロセス) | apps/translation-agent |
| HTTP API ハンドラ・DI 組立 | apps/server |
| iOS/Android クライアント | apps/mobile |

複数モジュールにまたがる場合は **server オーケストレーション層で組み合わせる** (各 facade を呼ぶ Use Case クラスを作る)。
