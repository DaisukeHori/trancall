# TranCall セキュリティ詳細設計

## 1. JWT Claims 構造

### Supabase Access Token（クライアント→API Server）

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "aud": "authenticated",
  "role": "authenticated",
  "email": "user@example.com",
  "app_metadata": {
    "provider": "email"
  },
  "user_metadata": {
    "trancall_id": "@tanaka_taro",
    "native_language": "ja"
  },
  "iat": 1747000000,
  "exp": 1747003600
}
```

### LiveKit Token（クライアント→LiveKit SFU）

```json
{
  "sub": "participant-uuid",
  "iss": "APIxxxxxxxx",
  "nbf": 1747000000,
  "exp": 1747007200,
  "video": {
    "roomJoin": true,
    "room": "room-uuid",
    "canPublish": true,
    "canSubscribe": true,
    "canPublishData": true,
    "canUpdateOwnMetadata": true
  },
  "metadata": "{\"nativeLanguage\":\"ja\",\"displayName\":\"田中太郎\"}"
}
```

LiveKit token生成（media/adapters/livekit.ts）:
```typescript
import { AccessToken, VideoGrant } from "livekit-server-sdk";

function generateLivekitToken(
  roomId: string,
  participantId: string,
  metadata: { nativeLanguage: string; displayName: string },
): string {
  const grant: VideoGrant = {
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  };

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantId,
      ttl: "2h",
      metadata: JSON.stringify(metadata),
    },
  );
  token.addGrant(grant);
  return token.toJwt();
}
```

## 2. Agent認証（Agent→API Server内部API）

### HMAC-SHA256 署名

```typescript
import { createHmac } from "crypto";

function signAgentRequest(
  agentSecret: string,
  body: string,
  timestamp: string,
): string {
  const payload = `${timestamp}.${body}`;
  return createHmac("sha256", agentSecret)
    .update(payload)
    .digest("hex");
}

// リクエスト送信時
const timestamp = new Date().toISOString();
const body = JSON.stringify(eventPayload);
const signature = signAgentRequest(AGENT_SECRET, body, timestamp);

fetch(INTERNAL_API_URL + "/internal/translation/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Agent-Token": signature,
    "X-Agent-Timestamp": timestamp,
    "X-Idempotency-Key": `${sessionId}:${eventType}:${timestamp}`,
  },
  body,
});

// サーバー側検証
function verifyAgentSignature(
  agentSecret: string,
  body: string,
  timestamp: string,
  receivedSignature: string,
): boolean {
  // タイムスタンプが5分以内か確認（リプレイ攻撃防止）
  const ts = new Date(timestamp).getTime();
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  const expected = signAgentRequest(agentSecret, body, timestamp);
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(receivedSignature, "hex"),
  );
}
```

## 3. OpenAI Safety Identifier

```typescript
import { createHmac } from "crypto";

// peppered hash（ソルトなしの単純SHA-256ではなく、APP_SECRETでペッパー化）
function generateSafetyIdentifier(userId: string, appSecret: string): string {
  return createHmac("sha256", appSecret)
    .update(userId)
    .digest("hex");
}

// 使用: OpenAI WebSocket接続時のヘッダー
// "OpenAI-Safety-Identifier": generateSafetyIdentifier(userId, APP_SECRET)
```

## 4. API Rate Limiting

| エンドポイント | 制限 | 理由 |
|-------------|------|------|
| POST /api/auth/signup | 5/hour/IP | アカウント大量作成防止 |
| POST /api/auth/signin | 10/min/IP | ブルートフォース防止 |
| GET /api/contacts/search | 10/min/user | ユーザー列挙防止 |
| POST /api/contacts/invite-link | 10/hour/user | 招待リンク大量生成防止 |
| POST /api/rooms | 5/min/user | 大量発信防止 |
| POST /internal/* | 100/min/agent | Agent暴走防止 |

## 5. データ保護

| データ | 保存場所 | 暗号化 | アクセス制御 |
|--------|---------|--------|------------|
| 音声ストリーム | 保存しない | SRTP (in transit) | — |
| 翻訳済み音声 | 保存しない | SRTP (in transit) | — |
| Transcript segments | Supabase (PostgreSQL) | TLS at rest + RLS | transcript_access テーブル |
| ユーザープロフィール | Supabase | TLS at rest + RLS | 本人のみ書き込み、公開フィールドは参照可 |
| 課金情報 | Stripe + Supabase | Stripe PCI DSS + RLS | 本人のみ参照 |
| デバイストークン | Supabase | TLS at rest + RLS | 本人のみ |
| OpenAI API Key | 環境変数（Agent） | — | Agentプロセスのみ |
