# TranCall Supabase Realtime / LiveKit Data Channel 設計

## チャンネル設計方針

| データ種別 | 配信手段 | 理由 |
|-----------|---------|------|
| 通話中字幕（partial delta） | **LiveKit data channel** | レイテンシー最優先、通話参加者のみ |
| 通話中字幕（final segment） | **LiveKit data channel** | 同上 |
| 翻訳状態変更（degraded/recovered） | **LiveKit data channel** | 通話参加者のみ、即時性必要 |
| Room状態変更（参加/退出/終了） | **Supabase Realtime** | Room一覧画面の更新 |
| 連絡先のオンライン状態 | **Supabase Realtime** (Presence) | 将来検討。Phase 1では実装しない |

## LiveKit Data Channel メッセージ形式

### 字幕（翻訳文）
```json
{
  "type": "subtitle.translated_delta",
  "sessionId": "uuid",
  "speakerParticipantId": "uuid",
  "delta": "ミーティングは来週の",
  "isFinal": false
}
```

### 字幕（原文）
```json
{
  "type": "subtitle.original_delta",
  "sessionId": "uuid",
  "speakerParticipantId": "uuid",
  "delta": "I think we should move the"
}
```

### 字幕（確定）
```json
{
  "type": "subtitle.finalized",
  "sessionId": "uuid",
  "speakerParticipantId": "uuid",
  "originalText": "I think we should move the meeting.",
  "translatedText": "ミーティングを移した方がいいと思います。",
  "sequenceNo": 42
}
```

### 翻訳状態
```json
{
  "type": "translation.degraded",
  "sessionId": "uuid",
  "reason": "ws_disconnect"
}
```
```json
{
  "type": "translation.recovered",
  "sessionId": "uuid"
}
```

### 残高不足警告
```json
{
  "type": "billing.low_balance",
  "remainingMinutes": 2
}
```

## Supabase Realtime チャンネル

### rooms:{userId}
ユーザーのRoom一覧の変更を監視。Home画面(SCR-002)で使用。
```typescript
supabase
  .channel(`rooms:${userId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'trancall_room',
    table: 'rooms',
    filter: `created_by=eq.${userId}`,
  }, handleRoomChange)
  .subscribe();
```

### participants:{roomId}
特定Roomの参加者変更を監視。通話中画面で使用。
```typescript
supabase
  .channel(`participants:${roomId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'trancall_room',
    table: 'participants',
    filter: `room_id=eq.${roomId}`,
  }, handleParticipantChange)
  .subscribe();
```
