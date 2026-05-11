# TranCall プッシュ通知詳細設計

## APNs VoIP Push Payload (iOS)

```json
{
  "aps": {},
  "trancall": {
    "type": "incoming_call",
    "roomId": "550e8400-e29b-41d4-a716-446655440000",
    "callerName": "John Wang",
    "callerAvatarUrl": "https://...",
    "callerTrancallId": "@johnwang_sf",
    "roomType": "audio",
    "translationEnabled": true,
    "languagePair": "en-ja",
    "callerLanguage": "en",
    "timestamp": "2026-05-11T10:00:00Z"
  }
}
```

VoIP Push受信後のiOS側処理:
```
1. PushKit didReceiveIncomingPush → 即座にCallKit報告（遅延厳禁）
2. CXProvider.reportNewIncomingCall(
     uuid: UUID(roomId),
     update: CXCallUpdate(
       remoteHandle: CXHandle(type: .generic, value: callerTrancallId),
       localizedCallerName: callerName,
       hasVideo: false
     )
   )
3. ユーザー応答 → performAnswerCallAction → アプリ起動 → Room参加
4. ユーザー拒否 → performEndCallAction → 何もしない
```

## FCM Payload (Android)

```json
{
  "message": {
    "token": "fcm-device-token",
    "data": {
      "type": "incoming_call",
      "roomId": "550e8400-...",
      "callerName": "John Wang",
      "callerAvatarUrl": "https://...",
      "callerTrancallId": "@johnwang_sf",
      "roomType": "audio",
      "translationEnabled": "true",
      "languagePair": "en-ja",
      "timestamp": "2026-05-11T10:00:00Z"
    },
    "android": {
      "priority": "high",
      "ttl": "30s"
    }
  }
}
```

Android側処理:
```
1. FirebaseMessagingService.onMessageReceived
2. ConnectionService.addNewIncomingConnection(
     phoneAccount,
     Bundle(callerName, roomId)
   )
3. IncomingCallActivity表示（フルスクリーンIntent）
4. ユーザー応答 → Room参加
5. ユーザー拒否 → Connection.onDisconnect
```

## 不在着信通知

```json
{
  "notification": {
    "title": "Missed call",
    "body": "John Wang (@johnwang_sf)"
  },
  "data": {
    "type": "missed_call",
    "roomId": "...",
    "callerName": "John Wang",
    "timestamp": "2026-05-11T10:00:00Z"
  }
}
```
