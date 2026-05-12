# TranCall モジュール間契約 (Module Contracts)

| 項目 | 内容 |
|---|---|
| ドキュメント ID | CONTRACT-001 |
| バージョン | 1.0.0 |
| 作成日 | 2026-05-12 |
| ステータス | canonical (現実装に整合) |
| 対象 | Sprint 0 + Layer 1 完了モジュール (auth / media / billing / contact / notification / transcript / translation / shared-kernel / translation-agent) |
| 将来追加対象 | Layer 2 room / Layer 3 server / agent-audio / mobile (Layer 4) |

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
| `@trancall/auth` | Supabase Auth ラップ・プロフィール管理 | `trancall_auth.profiles`, `trancall_auth.consent_versions` | `auth.user_registered` | — | `AuthFacade` | shared-kernel |
| `@trancall/media` | LiveKit Room CRUD / Token 発行 / Track 命名 (C-005) | (LiveKit Cloud 側) | — | — | `MediaFacade` | shared-kernel, **auth** (Profile lookup) |
| `@trancall/billing` | サブスク / heartbeat 課金 / 3 チャネル決済 | `trancall_billing.subscriptions`, `trancall_billing.usage_windows`, `trancall_billing.usage_reservations`, `trancall_billing.webhook_events` | — (将来 `billing.balance_low`) | (将来 `translation.ended`) | `BillingFacade` | shared-kernel |
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
  getProfile: (userId: UserId) => Promise<Result<Profile, AppError>>;
}
```

要求 Repository:
```ts
export interface ProfileRepository {
  findByUserId: (userId: UserId) => Promise<Result<Profile, AppError>>;
}
```

`Profile` schema: `packages/auth/src/schemas.ts` の `ProfileSchema` 参照。

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
}
```

要求 Repository: `SubscriptionRepository` / `UsageRepository` / `ReservationRepository` / `WebhookEventRepository` + 3 アダプタ (`StripeAdapter` / `AppleIapAdapter` / `GooglePlayAdapter`)。

**契約注釈**:
- `createCheckoutSession` の `channel` 引数は `docs/schemas.ts` の元定義より拡張 (3 チャネル設計 v9 で必要)
- `reserveMinutes` は呼び出し側 (room/server) が事前生成した `sessionId` を受け取り、reservation と usage を 1 通話単位で紐付ける。同一 `sessionId` で 2 回 reserve しても冪等 (PR #15 で実装側を `reserveMinutesWithSession` 経由に統一済み)

### 2.4 ContactFacade
`packages/contact/src/facade.ts`

```ts
export interface ContactFacade {
  addContact(cmd: AddContactCommand): Promise<Result<ContactEntry, AppError>>;
  removeContact(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  listContacts(userId: UserId): Promise<ContactEntry[]>;
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
  ): Promise<Result<{ contentBase64: string; mime: string }, AppError>>;
  validateLiveDelta(rawDelta: unknown): Result<LiveSubtitleDelta, AppError>;
}
```

**契約注釈**:
- DB 保存は `isFinal=true` segment のみ (v9 設計、`is_final` 列なし)
- `appendFinalSegment` は `UNIQUE(room_id, participant_id, sequence_no)` 制約に従い冪等
- `getTranscript` / `searchSegments` は `transcript_access.can_view=true AND deleted_at IS NULL` でフィルタ
- `deleteAccess` は呼び出し元 user の access 行のみ論理削除、相手の access は維持
- `exportTranscript` は Sprint 2 で実装、Sprint 1 では常に `TRANSCRIPT_EXPORT_NOT_IMPLEMENTED` を返す stub
- `validateLiveDelta` は mobile 側の LiveKit Data Channel 受信時バリデーション用 (DB 書込みなし)
- 旧 `docs/schemas.ts` 定義の `getLiveSubtitles(roomId): AsyncIterable<LiveSubtitleDelta>` は廃止 (LiveKit Data Channel 配信なので facade 側に AsyncIterable は不要)

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
}
```

依存先: `BillingFacade` (canStartCall)、`MediaFacade` (createRoom / deleteRoom)、`NotificationFacade` (sendIncomingCall)。

要求 Repository:
- `RoomRepository`: `insert` / `findById` / `updateStatus`
- `ParticipantRepository`: `upsert` / `findByRoomId` / `setLeftAtForAll`

要求: `EventBus` (publish インターフェース)

**契約注釈**:
- `createCall` は `billing.canStartCall` 失敗時、billing が返す `AppError` をそのまま pass-through する (room module は独自 error code を作らない、billing owner code を再利用)
- `media.createRoom` 失敗時は rooms を status='ended' にロールバックして `ROOM_MEDIA_CREATE_FAILED` を返す
- `sendIncomingCall` は best-effort (失敗しても createCall は成功)
- `joinCall` は `waiting → active` 状態遷移を担う (最初の non-host join 時)
- `endCall` は冪等 (既に ended なら OK を返す)
- `media.deleteRoom` は best-effort (失敗しても endCall は成功)
- `billing.reserveMinutes` / `billing.reconcile` は Layer 3 server 側の責務 (room facade では呼ばない)
- `notification.sendMissedCall` は Layer 3 server 側の責務 (inviteeIds を room が保持しないため)

---

## 3. DomainEvent Contract

### 3.1 イベント発行・購読マトリクス

| イベント名 | 発行モジュール | 購読モジュール | payload schema | 同期/非同期 | 配信手段 |
|---|---|---|---|---|---|
| `auth.user_registered` | auth | (将来) analytics | `UserRegisteredEvent` | 非同期 | EventBus (in-process pub/sub) |
| `room.created` | room (Layer 2) | notification | `RoomCreatedEvent` | 非同期 | EventBus |
| `room.participant_joined` | room (Layer 2) | translation | `ParticipantJoinedEvent` | 非同期 | EventBus |
| `room.participant_left` | room (Layer 2) | translation | `ParticipantLeftEvent` | 非同期 | EventBus |
| `translation.started` | translation | transcript | `TranslationStartedEvent` | 非同期 | EventBus |
| `translation.ended` | translation | **billing**, transcript | `TranslationEndedEvent` | 非同期 | EventBus |
| `translation.degraded` | translation | (a) server: billing(課金除外候補) / metrics、(b) client UI: 直接配信 | `TranslationDegradedEvent` (EventBus 経由) / `TranslationStatusChannelPayload` (Data Channel 経由) — §3.3 §3.4 参照 | 非同期 | **2 系統並列**: (a) EventBus (server 内)、(b) LiveKit Data Channel (Agent → mobile 直接) |
| `translation.recovered` | translation | 同上 | `TranslationRecoveredEvent` / `TranslationStatusChannelPayload` | 非同期 | 同上 |

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

- `UserRegisteredEvent` → `packages/auth/src/schemas.ts` (Sprint 1 では未 export、Layer 3 で追加予定)
- `Room*Event` → `docs/schemas.ts` の Room セクション (Layer 2 で実装)
- `TranslationStartedEvent` / `TranslationEndedEvent` → `packages/translation/src/schemas.ts`
- `TranslationDegradedEvent` / `TranslationRecoveredEvent` — v1.1.0 で追加、下記:

```ts
// packages/translation/src/schemas.ts (v1.1.0 で追加)
export const TranslationDegradedEventSchema = DomainEventBase.extend({
  type: z.literal("translation.degraded"),
  payload: z.object({
    sessionId: TranslationSessionId,
    agentJobId: AgentJobId,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    reason: z.enum(["openai_ws_reconnecting", "high_latency", "output_silence"]),
    degradedAt: z.iso.datetime(),
    // 観測値 (degraded 判定の根拠、metrics 結合に使う)
    latencyP95Ms: z.number().int().nonnegative().nullable(),
    consecutiveSilenceMs: z.number().int().nonnegative().nullable(),
  }),
});

export const TranslationRecoveredEventSchema = DomainEventBase.extend({
  type: z.literal("translation.recovered"),
  payload: z.object({
    sessionId: TranslationSessionId,
    agentJobId: AgentJobId,
    sourceLang: OutputLanguage,
    targetLang: OutputLanguage,
    degradedDurationMs: z.number().int().nonnegative(),
    recoveredAt: z.iso.datetime(),
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

Data Channel は **reliable** モードで送信 (字幕損失防止)。バイト数を抑えるため flat な discriminated union:

```ts
// packages/translation/src/schemas.ts (v1.1.0 で追加)
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
- `AccessRepository`: `canView` / `softDelete` (自分の `transcript_access.deleted_at` をセット) / `findOne`

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
| `ROOM_NOT_FOUND` | room (Layer 2) | 404 | false | 「通話が見つかりません」 |
| `ROOM_ALREADY_ENDED` | room (Layer 2) | 410 | false | 「この通話は終了しました」 |
| `ROOM_FULL` | room (Layer 2) | 409 | false | 「通話が満員です」 |
| `ROOM_USER_BLOCKED` | room (Layer 2) | 403 | false | 「この相手には発信できません」 |
| `BILLING_INSUFFICIENT_BALANCE` | billing | 402 | false | 「翻訳分数が不足しています」 |
| `BILLING_SUBSCRIPTION_EXPIRED` | billing | 402 | false | 「サブスクリプションが期限切れです」 |
| `BILLING_PAYMENT_FAILED` | billing | 402 | true | 「決済に失敗しました」 |
| `BILLING_INVALID_RECEIPT` | billing | 400 | false | 「購入情報の検証に失敗しました」 |
| `BILLING_CHANNEL_NOT_AVAILABLE` | billing | 400 | false | 「この地域では選択された購入チャネルを利用できません」 |
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
  x-trancall-signature: <hex HMAC-SHA256 of (body || "|" || idempotencyKey)>
  x-trancall-idempotency-key: <UUID>
```

### 7.2 認証

- HMAC-SHA256 共有鍵 `TRANCALL_AGENT_HMAC_SECRET` (32 文字以上、Agent / Server 両環境変数に同じ値)
- Signature 計算: `createHmac("sha256", secret).update(body + "|" + idempotencyKey).digest("hex")`
- Server 側で `timingSafeEqual` で比較
- (任意) `X-Agent-Timestamp` + 5 分以内チェックでリプレイ攻撃防止 — `docs/security-detail.md` 参照、Sprint 1 では未実装

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
  reason: "participant_left" | "agent_shutdown" | "openai_fatal_error" | "client_requested"
}
```
Server 処理: `trancall_event.translation_sessions` を update。**フィールド `reason` → DB 列 `ended_reason` へマッピング** (DB 列名は予約語回避とセマンティクス明示のため別名を採用、`supabase/migrations/00002_add_translation_sessions_table.sql` のコメント参照)。

Server で `translation.ended` DomainEvent を発行 → billing が購読して `recordUsage` (将来実装)。

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
    openAIFirstDelta: number[],   // session.update → 最初の response.audio.delta
    agentPublish: number[],       // OpenAI delta → LiveKit Publish
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

| 契約 | Phase 1 | Phase 2 | 影響 |
|---|---|---|---|
| `CreateRoomCommand.inviteeIds` の `max(49)` | 1 人のみ前提 (`min(1).max(49)` だが 1 名のみテスト) | 真にグループ通話 49 名対応 | room facade |
| `BillingFacade.createCheckoutSession` の `channel` | `stripe_web` / `storekit_external` | + 海外向け `iap_apple` / `iap_google` の追加 | billing facade |
| `TranslationFacade` への WebRTC pipeline 切替 | WebSocket 一本 | WebRTC option 並走 | translation, agent |
| `ContactFacade` グループ連絡先 | 個別連絡先のみ | group_contact_lists 追加 | contact facade、新規 schema |
| Transport Adapter 追加 (TRTC / SIP) | LiveKit のみ | TRTC / SIP adapter 抽象化 | media adapters/ |

詳細は `docs/requirements.md` 2. Phase 定義 参照。

---

## 10. 変更履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-12 | 1.0.0 | 初版作成 (Layer 1 完了時点の canonical 抽出) |
| 2026-05-12 | 1.1.0 | D3 反映: `translation.degraded` / `translation.recovered` の DomainEvent payload schema 確定 (§3.3)、LiveKit Data Channel Payload Schema 新規セクション §3.4、`translation.degraded/recovered` の発行を **EventBus + Data Channel 2 系統並列** に明示。判定条件は `docs/translation-pipeline-design.md` §7 に委譲。|

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
