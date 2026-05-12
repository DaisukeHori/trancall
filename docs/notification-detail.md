# TranCall プッシュ通知詳細設計

| 項目 | 内容 |
|------|------|
| ドキュメント ID | NOTIFICATION-DETAIL-001 |
| Status | v1.3 (2026-05-12) |
| Canonical | APNs / FCM の payload 構造、HMAC 署名仕様の正本 |
| 関連 | `docs/native-call-bridge.md` (CallKit/Telecom bridge 側の canonical)、`docs/security-detail.md` (HMAC 全般)、`packages/notification/src/schemas.ts` (実装スキーマ) |

## 1. APNs VoIP Push Payload (iOS)

```json
{
  "aps": {},
  "trancall": {
    "type": "incoming_call",
    "uuid": "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
    "roomId": "550e8400-e29b-41d4-a716-446655440000",
    "callerId": "u_abc123",
    "callerName": "John Wang",
    "callerAvatarUrl": "https://...",
    "callerTrancallId": "@johnwang_sf",
    "roomType": "audio",
    "translationEnabled": true,
    "languagePair": "en-ja",
    "callerLanguage": "en",
    "issuedAt": "2026-05-11T10:00:00.000Z",
    "expiresAt": "2026-05-11T10:00:30.000Z",
    "signature": "<HMAC-SHA256 of canonical string, 64 hex chars>"
  }
}
```

- 上位は `aps` (APNs プロトコルが要求、VoIP では空オブジェクトでよい) + `trancall` (アプリ独自フィールド)。
- `uuid` = CallKit `reportNewIncomingCall(with: UUID)` に渡す UUID。`roomId` と独立 (1 通話 = 1 CallKit UUID、roomId は LiveKit room 識別子)。
- `issuedAt` / `expiresAt` で **30 秒 TTL** を確保 (リプレイ攻撃対策、Mobile bridge が `expiresAt` 超過 payload を黙殺)。
- `signature` は §3 の HMAC 計算式で生成し Mobile bridge が再計算検証。検証失敗時は CallKit に何も投入しない。

### 1.1 iOS 側受信処理 (PushKitDelegate)

```
1. PushKit didReceiveIncomingPushWith → 5 秒以内厳守 (iOS 13+)
2. payload.dictionaryPayload["trancall"] を [String: Any] として取得
3. Codable で構造体にデコード (Swift では JSONDecoder + Codable)
4. HMAC signature 検証 (CryptoKit `HMAC<SHA256>.isValidAuthenticationCode`、constant-time、§3.4 参照)
5. expiresAt 検証 (現在時刻と比較)
6. CXProvider.reportNewIncomingCall(
     uuid: UUID(uuidString: trancall.uuid),  // ← roomId ではなく uuid
     update: CXCallUpdate(
       remoteHandle: CXHandle(type: .generic, value: trancall.callerTrancallId),
       localizedCallerName: trancall.callerName,
       hasVideo: false
     ),
     completion: { _ in completion() }
   )
```

詳細な bridge 設計は `docs/native-call-bridge.md` §4 を参照。

## 2. FCM Payload (Android、HTTP v1 API)

```json
{
  "message": {
    "token": "<fcm-device-token>",
    "data": {
      "type": "incoming_call",
      "uuid": "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
      "roomId": "550e8400-...",
      "callerId": "u_abc123",
      "callerName": "John Wang",
      "callerAvatarUrl": "https://...",
      "callerTrancallId": "@johnwang_sf",
      "roomType": "audio",
      "translationEnabled": "true",
      "languagePair": "en-ja",
      "callerLanguage": "en",
      "issuedAt": "2026-05-11T10:00:00.000Z",
      "expiresAt": "2026-05-11T10:00:30.000Z",
      "signature": "<HMAC-SHA256, 64 hex chars>"
    },
    "android": {
      "priority": "high",
      "ttl": "30s"
    }
  }
}
```

- FCM Legacy HTTP API (v0、`"to": "<token>"` 形式) は 2024-06 廃止済。**v1 API** (`message.token` + `message.data` + `message.android`) を必須採用。
- data フィールド値は **string 型のみ** (FCM の制約)。boolean は `"true"` / `"false"`、object は serialize 不可なため使わない (uuid / roomId 等は string 化済)。
- `priority: "high"` + `data` のみ (`notification` キーなし) で Doze を突破し `onMessageReceived` を起動。

### 2.1 Android 側受信処理 (TranCallFirebaseMessagingService)

```
1. FirebaseMessagingService.onMessageReceived(RemoteMessage)
2. remoteMessage.data を Map<String, String> として取得し JSON schema 検証
3. HMAC signature 検証 (javax.crypto.Mac)
4. expiresAt 検証
5. TelecomManager.addNewIncomingCall(phoneAccountHandle, extras)
6. ConnectionService.onCreateIncomingConnection → SelfManaged Connection 生成
```

詳細な bridge 設計は `docs/native-call-bridge.md` §5 を参照。

## 3. HMAC 署名仕様 (incoming_call payload)

### 3.1 共有鍵

- 環境変数 `TRANCALL_PUSH_HMAC_SECRET` (32 文字以上、Server / Mobile bridge の両方に同じ値を配布)。
- Mobile bridge では encrypted at rest (`expo-secure-store` 経由) で保管。
- rotation: `TRANCALL_PUSH_HMAC_SECRET_NEXT` を併走発行可能、Mobile は 24h 期間中、両方の鍵を試行 (古い鍵が一致したら log 警告)、24h 経過後に新鍵単独。詳細は `docs/security-detail.md` HMAC rotation 節参照。

### 3.2 canonical string の作り方

署名対象は `trancall` キー配下のフィールドを **以下の順序で `|` 区切りに結合した文字列**:

```
canonical = type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
```

- 値は **JSON エンコード前のプレーン文字列** (string 型はそのまま、UUID は小文字 hex、datetime は ISO8601 `.000Z` 形式)。
- 順序は本書 §3.2 で確定。新フィールド追加時は本書を更新し、`signatureVersion` フィールドの追加で互換性管理する (Sprint 3 以降検討)。
- `callerName` / `callerAvatarUrl` / `languagePair` / `callerLanguage` / `roomType` / `translationEnabled` 等の **表示用 / 設定系フィールドは署名対象外** (国際化や軽微な変更で signature 不一致を起こさないため)。

### 3.3 計算式

```
signature = HMAC-SHA256(key = TRANCALL_PUSH_HMAC_SECRET, message = canonical)
          .digest("hex")  // 小文字 64 文字
```

| 実装 | API |
|---|---|
| Node.js (server) | `crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex")` |
| Swift (mobile) | 計算: `HMAC<SHA256>.authenticationCode(for: Data(canonical.utf8), using: SymmetricKey(data: secret.data(using: .utf8)!))` を `.map { String(format: "%02x", $0) }.joined()` で hex 化。**検証**: `HMAC<SHA256>.isValidAuthenticationCode(receivedMacBytes, authenticating: Data(canonical.utf8), using: key)` を必ず使う (CryptoKit が constant-time 比較を内部実装、手動の `==` / byte ループは short-circuit リスクあり) |
| Kotlin (mobile) | 計算: `Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(secret.toByteArray(), "HmacSHA256")) }.doFinal(canonical.toByteArray()).joinToString("") { "%02x".format(it) }` で hex 化。**検証**: 受信した signature を `byte[]` に decode し `MessageDigest.isEqual(computedBytes, receivedBytes)` で必ず比較 (Java 6 以降 constant-time 保証、`Arrays.equals` や手動ループは short-circuit リスクあり) |

### 3.4 検証手順 (Mobile bridge)

1. payload の `trancall` を取り出す
2. canonical string を §3.2 順序で組み立て
3. HMAC を再計算
4. constant-time 比較: **Swift は `HMAC<SHA256>.isValidAuthenticationCode(_:authenticating:using:)` を使う** (CryptoKit が内部で constant-time 比較を保証、`Data` の `==` や手動ループは short-circuit のため不採用)。**Kotlin は `java.security.MessageDigest.isEqual(byte[], byte[])`** (Java 6 以降で constant-time 保証) を使う。`signature` の hex を `byte[]` にデコードしてから比較
5. 不一致なら **CallKit / Telecom に何も投入せず**、log only で破棄

## 4. 不在着信通知 (missed_call)

`apns-push-type: alert` の通常 push (VoIP ではない)。CallKit は使わない。

```json
{
  "aps": {
    "alert": {
      "title": "不在着信",
      "body": "John Wang (@johnwang_sf)"
    },
    "sound": "default",
    "badge": 1
  },
  "trancall": {
    "type": "missed_call",
    "roomId": "...",
    "callerId": "u_abc123",
    "callerName": "John Wang",
    "callerTrancallId": "@johnwang_sf",
    "issuedAt": "2026-05-11T10:00:30.000Z"
  }
}
```

不在着信通知には HMAC 署名を **付けない** (CallKit に直結しないため攻撃面が小さい、Phase 1b で signature 追加検討)。

## 5. 改訂履歴

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-05-11 | 初版。APNs VoIP / FCM data / 不在着信の payload 仕様 |
| v1.1 | 2026-05-12 | D4 ネイティブ通話 Bridge 設計書 (PR #30) との整合で以下を追加: `uuid` (CallKit 用 UUID、roomId と分離) / `callerId` (内部 ID) / `issuedAt` / `expiresAt` (30s TTL、リプレイ攻撃対策) / `signature` (HMAC-SHA256、§3) フィールドを `trancall` キー配下に追加。FCM payload を v0 Legacy から v1 API (`message.token` + `message.data` + `message.android`) に明示。HMAC canonical string の field 順序 §3.2 を確定。実装 (`packages/notification/src/schemas.ts`) への適用は Sprint 3 で別 PR が実施予定。 |
| v1.2 | 2026-05-12 | D4 PR #30 Round 2 指摘 W-1 を反映: §3.3 §3.4 の Swift constant-time 比較を `HMAC<SHA256>.isValidAuthenticationCode(_:authenticating:using:)` 使用に修正 (CryptoKit が constant-time 比較を内部実装、`Data` の `==` や手動ループは short-circuit リスクあり)。Kotlin は `MessageDigest.isEqual` (Java 6 以降 constant-time 保証) を明示。 |
| v1.3 | 2026-05-12 | D4 PR #30 Round 3 指摘を反映: (A Suggestion) §1.1 ステップ 4 の `authenticationCode` を `isValidAuthenticationCode` に統一 (検証側の API 名、計算用 API との混同を解消)。(B Suggestion) §3.3 Kotlin 行に `MessageDigest.isEqual` による検証コード例を追記し Swift 行との対称性を確保。
