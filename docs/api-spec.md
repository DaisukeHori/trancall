# TranCall API エンドポイント詳細設計

## 共通仕様

- ベースURL: `https://api.trancall.app/api`（Phase 1aではVercel or セルフホスト）
- 認証: `Authorization: Bearer <supabase_access_token>`（内部APIは`X-Agent-Token`）
- レスポンス: 全て `Result<T, AppError>` 形式のJSON
- エラーコード命名規約（レビュー v10 M-003-NEW で統一）:
  - **ドメイン共通**: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `INTERNAL_ERROR`, `NETWORK_ERROR`
  - **ドメイン固有**: `AUTH_*`, `ROOM_*`, `CONTACT_*`, `TRANSLATION_*`, `BILLING_*`
  - 旧名との対応: `INSUFFICIENT_BALANCE` → `BILLING_INSUFFICIENT_BALANCE`、`PROVIDER_ERROR` → `TRANSLATION_PROVIDER_ERROR`
- 完全なコード一覧と HTTP ステータス・retryable 判定・UI 表示文言は [docs/error-handling.md](./error-handling.md) を **単一の参照源** とする

## 認証（auth）

### POST /api/auth/signup

```
Request:
{
  "email": "user@example.com",
  "password": "secureP@ss123",
  "displayName": "田中太郎",
  "nativeLanguage": "ja"
}

Response 200:
{
  "ok": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "xxx",
    "expiresAt": "2026-05-11T12:00:00Z",
    "user": {
      "userId": "550e8400-...",
      "trancallId": "@tanaka_taro",
      "email": "user@example.com",
      "displayName": "田中太郎",
      "nativeLanguage": "ja",
      "avatarUrl": null,
      "consentVersion": null,
      "emailVerified": false,
      "createdAt": "2026-05-11T10:00:00Z"
    }
  }
}

Response 400:
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "retryable": false } }
```

### POST /api/auth/signin

```
Request: { "email": "...", "password": "..." }
Response: 同上
```

### GET /api/auth/profile

```
Headers: Authorization: Bearer <token>
Response: { "ok": true, "data": UserProfile }
```

### PATCH /api/auth/profile

```
Request: { "displayName"?: "...", "nativeLanguage"?: "ja", "avatarUrl"?: "..." }
Response: { "ok": true, "data": UserProfile }
```

### POST /api/auth/consent

```
Request: { "consentVersion": "v1.0" }
Response: { "ok": true, "data": true }
```

## 連絡先（contact）

### GET /api/contacts

```
Response: { "ok": true, "data": ContactEntry[] }
```

### POST /api/contacts

```
Request: { "contactUserId": "uuid" }
Response: { "ok": true, "data": ContactEntry }
Error: ALREADY_EXISTS, BLOCKED, NOT_FOUND
```

### DELETE /api/contacts/:id

```
Response: { "ok": true, "data": true }
```

### GET /api/contacts/search?q=tanaka

```
Query: q (TranCall ID完全一致 or 名前部分一致、opt-in discoverabilityのみ)
Response: { "ok": true, "data": UserProfile[] }
Rate limit: 10 req/min
```

### POST /api/contacts/invite-link

```
Response: { "ok": true, "data": { "url": "https://trancall.app/invite/abc123", "expiresAt": "..." } }
```

### POST /api/contacts/invites/:token/consume

Issue #72.4 で追加。招待リンクのトークンを消費し、リンク発行者を呼び出しユーザーの連絡先に追加する（`ContactFacade.consumeInviteLink` を呼ぶ）。

```
Path params: token (招待トークン、必須)
Response 200: { "ok": true, "data": ContactEntry }
Error: VALIDATION_ERROR (token 欠落), CONTACT_NOT_FOUND (トークン無効/期限切れ), CONTACT_ALREADY_EXISTS
```

### POST /api/contacts/block

```
Request: { "blockedUserId": "uuid", "reason"?: "..." }
Response: { "ok": true, "data": true }
```

### POST /api/contacts/report

```
Request: { "reportedUserId": "uuid", "reason": "spam", "details"?: "..." }
Response: { "ok": true, "data": true }
```

## 通話（room）

### POST /api/rooms

```
Request: {
  "inviteeIds": ["uuid"],
  "roomType": "audio",
  "translationEnabled": true
}
Response: { "ok": true, "data": RoomState }
Side effects:
  - billingFacade.canStartCall() チェック
  - billingFacade.reserveMinutes() 予約
  - notificationFacade.sendIncomingCall() 相手に着信通知
```

### GET /api/rooms/:id

```
Response: { "ok": true, "data": RoomState }
```

### POST /api/rooms/:id/join

```
Response: { "ok": true, "data": RoomState }
Side effects:
  - Translation Agent に翻訳セッション開始を通知
```

### POST /api/rooms/:id/leave

```
Response: { "ok": true, "data": RoomState }
Side effects:
  - 全員退出時: Room status → "ended"
  - billingFacade.reconcile() 利用量確定
```

### GET /api/rooms/history?limit=20&before=2026-05-11T00:00:00Z

> **実装完了 (L-13)**。`RoomFacade.getRoomHistory` (`packages/room/src/services/history-service.ts`) が実データを返す。`RoomRepository.findEndedByParticipantId` が room モジュール所有の `trancall_room.rooms`/`participants` のみを参照し (2 クエリ)、`RoomHistoryEnrichmentRepository` (apps/server 実装、room 自己定義の read-only インターフェース) が `trancall_auth.public_profiles` VIEW / `trancall_billing.usage_windows` SUM / transcript の既存 `AccessRepository.canView` を参照して displayName・costYen・hasTranscript を補完する (best-effort、取得失敗時はフォールバック値)。`mobile/recent-calls-store` からの REST 経由取得も有効化済み。

**Query parameters**:
- `limit`: integer, 1-50, default 20
- `before`: ISO8601 datetime (`startedAt < before` フィルタ、初回呼出は省略可)

**Response Zod schema** (`packages/room/src/schemas.ts`、L-13 で実装):

```ts
export const RoomHistoryParticipantSchema = z.object({
  userId: UserIdSchema,
  displayName: z.string(),
  // 実装では他モジュールの trancallId 表現 (PublicProfile 等) と同様 z.string() のまま
  // (canonical な正規表現バリデーション付き TrancallId 型は現状リポジトリ内に存在しない)
  trancallId: z.string(),
  avatarUrl: z.url().nullable(),
  isHost: z.boolean(),
});

export const RoomHistoryEntrySchema = z.object({
  roomId: RoomIdSchema,
  status: z.enum(["ended"]),                                  // history は ended のみ返す
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
  startedAt: z.iso.datetime(),                                // status='active' 遷移時刻
  endedAt: z.iso.datetime(),                                  // history は必ず非 null
  durationSeconds: z.number().int().nonnegative(),
  participants: z.array(RoomHistoryParticipantSchema).min(1), // 自分を含む参加者全員
  myRole: z.enum(["host", "member"]),
  costYen: z.number().int().nonnegative(),                    // 当該通話の billing usage 合計 (heartbeat 集計)
  hasTranscript: z.boolean(),                                 // transcript_access.can_view=true なら true
});
export type RoomHistoryEntry = z.infer<typeof RoomHistoryEntrySchema>;

export const RoomHistoryResponseSchema = z.object({
  rooms: z.array(RoomHistoryEntrySchema),
  nextCursor: z.iso.datetime().nullable(),                    // 次ページ取得用 (最古 entry の startedAt、null = これ以上なし)
});
export type RoomHistoryResponse = z.infer<typeof RoomHistoryResponseSchema>;
```

**Response** (HTTP 200):

```json
{
  "ok": true,
  "data": {
    "rooms": [
      {
        "roomId": "550e8400-...",
        "status": "ended",
        "roomType": "audio",
        "translationEnabled": true,
        "startedAt": "2026-05-11T10:00:00.000Z",
        "endedAt": "2026-05-11T10:15:32.000Z",
        "durationSeconds": 932,
        "participants": [
          { "userId": "u_self", "displayName": "自分", "trancallId": "@me", "avatarUrl": null, "isHost": true },
          { "userId": "u_abc", "displayName": "John", "trancallId": "@john", "avatarUrl": "https://...", "isHost": false }
        ],
        "myRole": "host",
        "costYen": 0,
        "hasTranscript": true
      }
    ],
    "nextCursor": "2026-05-11T09:30:00.000Z"
  }
}
```

**実装側の制約** (L-13 実装済み):
- ソート: `startedAt (= rooms.created_at) DESC`
- 表示対象: `rooms.status = 'ended' AND <自分が participant に含まれ、実際に join した (joined_at IS NOT NULL)>`
- 上限: 過去 90 日 (Free/Light) / 365 日 (Standard/Business、subscription tier に従う、`billing.getSubscription` 経由)。この日数は `@trancall/billing` の `PlanConfig.transcriptRetentionDays` (7/30/90/365、トランスクリプト本文の保持期間) とは別概念であり、`packages/room/src/services/history-service.ts` の `HISTORY_WINDOW_DAYS` で独自に定義する (混同注意)
- `startedAt` は `rooms` テーブルに `status='active'` 遷移時刻を持つ列がないため、現状 `rooms.created_at` で近似する
- 必要 Repository メソッド: `RoomRepository.findEndedByParticipantId(userId, opts)` (実装済み、`apps/server/src/adapters/repositories/room/room-repository.supabase.ts`)
- `costYen` / `hasTranscript` / participant profile は `RoomHistoryEnrichmentRepository` (room 自己定義の read-only インターフェース、`apps/server/src/adapters/repositories/room/room-history-enrichment-repository.supabase.ts` が実装) 経由で解決する。未注入時は costYen=0 / hasTranscript=false / displayName="Unknown" にフォールバックする
- **未反映**: `docs/module-contracts.md` §2.8 RoomFacade の contract に `getRoomHistory` がまだ追加されていない (Opus によるフォローアップが必要、メモリポリシー「設計書は Opus 自身が直接書く」)

**エラー**: HTTP 401 `AUTH_TOKEN_EXPIRED` のみ (空配列は正常系、`rooms: [], nextCursor: null`)

### POST /api/rooms/:id/token

```
Response: {
  "ok": true,
  "data": {
    "token": "livekit-jwt-token",
    "livekitUrl": "wss://livekit.trancall.app"
  }
}
注: LiveKit token には TrackPermissions が埋め込まれる
  - 翻訳ON: 相手の raw mic track の subscribe 不可（translated track のみ）
  - 翻訳OFF: 通常の subscribe policy
```

## 課金（billing）

### GET /api/billing/subscription

```
Response: { "ok": true, "data": SubscriptionState }
```

### POST /api/billing/checkout

```
Request: {
  "tier": "standard",
  "paymentMethod": "iap" | "storekit_external" | "stripe_web"
}

Response (paymentMethod="iap"):
{ "ok": true, "data": { "method": "iap", "productId": "trancall_standard_monthly" } }
  → クライアントが App Store / Google Play の IAP フローを起動

Response (paymentMethod="storekit_external"):
{ "ok": true, "data": {
    "method": "storekit_external",
    "url": "https://checkout.stripe.com/...",
    "externalPurchaseToken": "ept_...",     // Apple StoreKit External API用
    "disclosureSheetRequired": true          // クライアントは Apple disclosure sheet を表示してから外部リンクを開く
  }
}

Response (paymentMethod="stripe_web"):
{ "ok": true, "data": { "method": "stripe_web", "url": "https://checkout.stripe.com/..." } }
  → Web ブラウザで開く。アプリ外サイト / B2B 法人向け。
```

MSCA対応（日本市場）:
- アプリ内で **IAP + StoreKit External Purchase** を**併設必須**（MSCAルール: side-by-side model）
- 同じ画面に "Appleで購入" / "Webで購入" ボタンを並べる
- 海外市場: `iap` のみ。`storekit_external` リクエストは `FORBIDDEN_IN_REGION` エラー
- `stripe_web`: アプリ外サイトでの直接購入。B2B契約や年間プラン用

実効手数料:
- IAP: MSCA 21% (SBP適用時 10%)
- StoreKit External Purchase: 実効15-20% (Store Services Fee + Initial Acquisition Fee + CTC + Stripe 3.6%)
- Stripe Web (アプリ外): 3.6%

### POST /api/billing/storekit-external/report

> **実装済み (P-2)**: `BillingFacade.reportExternalPurchaseTransaction` (内部で
> `ExternalPurchaseAdapter.reportMonthlyTransaction` に委譲) 経由で実装。
> `externalPurchaseToken` は `ExternalPurchaseAdapter.generateRedirectToken()` が発行する
> redirectToken (64 文字 hex) を指す。所有者一致・stripeSessionId 一致を検証してから
> Apple 月次レポートキューへ登録する。Apple External Purchase Server API への実際の HTTP
> 呼び出しは Phase 1a はログ出力のみ、Phase 1b で実装 (他の Apple External Purchase 報告
> メソッドと同じ方針、`packages/billing/src/adapters/external-purchase-adapter.ts` 参照)。

```
Apple StoreKit External Purchase で発生した取引を Apple に月次報告するための内部記録エンドポイント。
クライアント or Stripe Webhook 経由で取引完了通知を受け、その後に Apple External Purchase Server API に転送する。

Request: {
  "externalPurchaseToken": "ept_...",
  "stripeSessionId": "cs_...",
  "amountYen": 2980,
  "occurredAt": "2026-05-11T10:00:00Z"
}

Response: { "ok": true, "data": { "queuedForAppleReport": true } }

Apple月次レポート:
- 毎月Appleが請求書を送付
- 開発者は30日以内にApple-issued invoiceを支払う必要あり
- 監査用に取引データを保持
```

### POST /api/billing/webhook/stripe

```
Stripe Signature 検証
idempotent by event.id (webhook_events.external_event_id で永続化)
```

### POST /api/billing/webhook/apple

```
App Store Server Notifications V2
idempotent by signedTransactionInfo (webhook_events.external_event_id で永続化)
```

### POST /api/billing/webhook/google

```
Google Play Real-Time Developer Notifications
idempotent by purchaseToken (webhook_events.external_event_id で永続化)
```

## トランスクリプト（transcript）

### GET /api/transcripts/:roomId

```
Response: { "ok": true, "data": FullTranscript }
RLS: transcript_access で可視性チェック
```

### DELETE /api/transcripts/:roomId

```
自分のtranscript_access.deleted_at を設定
相手のアクセスは維持
Response: { "ok": true, "data": true }
```

## 通知（notification）

### POST /api/notifications/register

```
Request: { "platform": "ios", "voipToken": "...", "bundleId": "com.trancall.app" }
     or: { "platform": "android", "fcmToken": "..." }
Response: { "ok": true, "data": true }
```

## 内部API（Agent → Server）

### POST /internal/translation/events

```
Headers:
  X-Agent-Token: <署名付きAgent token>
  X-Idempotency-Key: <session_id>:<event_type>:<timestamp>

Request: DomainEvent (translation.started | translation.ended | translation.degraded | translation.recovered)

Response: { "ok": true }

認証: HMAC-SHA256(agent_secret, request_body)
冪等: idempotency_key で重複排除
```

### POST /internal/translation/heartbeat

```
Headers: X-Agent-Token, X-Idempotency-Key

Request: {
  "sessionId": "uuid",
  "userId": "uuid",
  "roomId": "uuid",
  "windowStart": "2026-05-11T10:00:00Z",
  "durationSeconds": 30,
  "languagePair": "ja-en"
}

Response: {
  "ok": true,
  "data": {
    "remainingMinutes": 45,
    "shouldContinue": true
  }
}

remainingMinutes が 0 の場合 shouldContinue=false → Agent は翻訳停止、原音 fallback
```
