# TranCall API エンドポイント詳細設計

## 共通仕様

- ベースURL: `https://api.trancall.app/api`（Phase 1aではVercel or セルフホスト）
- 認証: `Authorization: Bearer <supabase_access_token>`（内部APIは`X-Agent-Token`）
- レスポンス: 全て `Result<T, AppError>` 形式のJSON
- エラーコード: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `INSUFFICIENT_BALANCE`, `PROVIDER_ERROR`, `INTERNAL_ERROR`

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

```
Response: { "ok": true, "data": RoomState[] }
```

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
Request: { "tier": "standard", "paymentMethod": "stripe" | "iap" }
Response: { "ok": true, "data": { "url": "https://checkout.stripe.com/..." } }

MSCA対応（日本市場）:
- IAPとStripe（代替決済）を**併設**可能。アプリ内に両方の決済ボタンを置ける
- IAP手数料: MSCA 21%（SBP適用時10%）
- Stripe手数料: 3.6%（ただしStoreKit External Purchase Entitlement経由で26% Appleコミッション含む場合あり）
- B2B向け: Webサブスク（Stripe 3.6%のみ）を優先提案

日本以外の市場: IAP一本化（MSCA非適用）
```

### POST /api/billing/webhook/stripe

```
Stripe Signature 検証
idempotent by event.id
```

### POST /api/billing/webhook/apple

```
App Store Server Notifications V2
idempotent by signedTransactionInfo
```

### POST /api/billing/webhook/google

```
Google Play Real-Time Developer Notifications
idempotent by purchaseToken
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
