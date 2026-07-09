# TranCall 通話ライフサイクル詳細設計

## 1. 発信フロー（Caller側）

```
Caller App          API Server              Supabase           LiveKit SFU          Translation Agent
    │                   │                      │                   │                      │
    │ 1. POST /rooms    │                      │                   │                      │
    │ {inviteeIds,      │                      │                   │                      │
    │  translationEnabled}                     │                   │                      │
    │──────────────────>│                      │                   │                      │
    │                   │ 2. canStartCall()    │                   │                      │
    │                   │─────────────────────>│ SELECT remaining  │                      │
    │                   │<─────────────────────│ minutes           │                      │
    │                   │                      │                   │                      │
    │                   │ 3. reserveMinutes(5) │                   │                      │
    │                   │─────────────────────>│ INSERT reservation│                      │
    │                   │                      │                   │                      │
    │                   │ 4. createRoom()      │                   │                      │
    │                   │─────────────────────────────────────────>│                      │
    │                   │                      │                   │ Room created         │
    │                   │                      │                   │                      │
    │                   │ 5. INSERT rooms      │                   │                      │
    │                   │─────────────────────>│                   │                      │
    │                   │                      │                   │                      │
    │                   │ 6. sendIncomingCall() │                  │                      │
    │                   │ (APNs VoIP Push / FCM)│                  │                      │
    │                   │──────────────────────────────────────────────────> Callee Device │
    │                   │                      │                   │                      │
    │ 7. {roomId, token}│                      │                   │                      │
    │<─────────────────│                      │                   │                      │
    │                   │                      │                   │                      │
    │ 8. room.connect(url, token)              │                   │                      │
    │─────────────────────────────────────────────────────────────>│                      │
    │                   │                      │ WebRTC established │                      │
    │                   │                      │                   │                      │
    │ 9. publishTrack(mic)                     │                   │                      │
    │─────────────────────────────────────────────────────────────>│                      │
    │                   │                      │                   │                      │
    │ SCR-010 Calling   │                      │                   │                      │
    │ (ringing画面表示)  │                      │                   │                      │
```

## 2. 着信フロー（Callee側）

**確定#2 (2026-07 敵対的レビュー) 追記**: `POST /rooms/:id/join` は「発信フロー §1
createCall が invitee を participants に事前登録済み (joined_at: NULL の
招待済み・未参加状態) であること」を前提にした認可チェックを行う。
招待されていない (= participants 行が存在しない) ユーザーの join は
`ROOM_USER_NOT_INVITED` (403) で拒否される。下図の「INSERT participant」は
実際には「事前登録済み行の joined_at を更新 (markJoined)」であり、新規行の
INSERT ではない。

```
Callee Device      Callee App        API Server        LiveKit SFU       Translation Agent
    │                   │                │                  │                    │
    │ VoIP Push受信     │                │                  │                    │
    │──────────────────>│                │                  │                    │
    │                   │                │                  │                    │
    │ [iOS] CallKit     │                │                  │                    │
    │ reportNewIncoming │                │                  │                    │
    │ CallWithUUID      │                │                  │                    │
    │ ※必ず即座に呼ぶ   │                │                  │                    │
    │ (遅延→エンタイトルメント剥奪)        │                  │                    │
    │                   │                │                  │                    │
    │ [Android]         │                │                  │                    │
    │ ConnectionService │                │                  │                    │
    │ addNewIncomingCall │               │                  │                    │
    │                   │                │                  │                    │
    │ SCR-004 着信画面   │                │                  │                    │
    │ (CallerName,      │                │                  │                    │
    │  翻訳方向表示)     │                │                  │                    │
    │                   │                │                  │                    │
    │ ユーザー応答       │                │                  │                    │
    │──────────────────>│                │                  │                    │
    │                   │                │                  │                    │
    │                   │ [初回のみ]      │                  │                    │
    │                   │ 同意画面表示    │                  │                    │
    │                   │ 「音声がOpenAI  │                  │                    │
    │                   │  に送信されます」│                  │                    │
    │                   │                │                  │                    │
    │                   │ POST /rooms/:id/join               │                    │
    │                   │───────────────>│                  │                    │
    │                   │                │ INSERT participant│                    │
    │                   │                │──────────────────>│                    │
    │                   │ {token}        │                  │                    │
    │                   │<──────────────│                  │                    │
    │                   │                │                  │                    │
    │                   │ room.connect(url, token)           │                    │
    │                   │───────────────────────────────────>│                    │
    │                   │                │                  │                    │
    │                   │ publishTrack(mic)                  │                    │
    │                   │───────────────────────────────────>│                    │
    │                   │                │                  │                    │
    │                   │                │                  │ participant_joined  │
    │                   │                │                  │───────────────────>│
    │                   │                │                  │                    │
    │                   │                │                  │ Agent: 2人目参加検出│
    │                   │                │                  │ → 翻訳セッション開始│
    │                   │                │                  │ (agent-flow.md参照) │
```

## 3. 通話中フロー

```
Caller App        LiveKit SFU      Translation Agent       OpenAI RT        Callee App
    │                 │                   │                    │                │
    │ mic audio       │                   │                    │                │
    │ (48kHz Opus)    │                   │                    │                │
    │────────────────>│                   │                    │                │
    │                 │ raw-callerA track  │                    │                │
    │                 │──────────────────>│                    │                │
    │                 │                   │ resample 48→24kHz  │                │
    │                 │                   │ session.input_audio│                │
    │                 │                   │ _buffer.append     │                │
    │                 │                   │───────────────────>│                │
    │                 │                   │                    │                │
    │                 │                   │ session.output_    │                │
    │                 │                   │ audio.delta        │                │
    │                 │                   │ (200ms PCM16 24kHz)│                │
    │                 │                   │<───────────────────│                │
    │                 │                   │ resample 24→48kHz  │                │
    │                 │ trans-A-to-{lang}  │                    │                │
    │                 │<─────────────────│                    │                │
    │                 │                   │                    │                │
    │                 │ translated track (90% vol)             │ subscribe      │
    │                 │────────────────────────────────────────────────────────>│
    │                 │                   │                    │                │
    │                 │ raw-callerA track (30% vol, ambient)   │ subscribe      │
    │                 │────────────────────────────────────────────────────────>│
    │                 │                   │                    │                │
    │                 │                   │ session.output_    │                │
    │                 │                   │ transcript.delta   │                │
    │                 │                   │<───────────────────│                │
    │                 │                   │                    │                │
    │                 │ data channel: subtitle.translated_delta│                │
    │                 │────────────────────────────────────────────────────────>│
    │                 │                   │                    │                │ SCR-003
    │                 │                   │                    │                │ 字幕表示
    │                 │                   │                    │                │
    │                 │                   │ [30秒ごと]          │                │
    │                 │                   │ POST /internal/    │                │
    │                 │                   │ translation/       │                │
    │                 │                   │ heartbeat          │                │
    │                 │                   │──────> API Server  │                │
    │                 │                   │ {shouldContinue}   │                │
    │                 │                   │<────── API Server  │                │
```

## 4. 終話フロー

```
Either User        Their App        API Server        LiveKit SFU      Translation Agent
    │                  │                │                  │                   │
    │ 終話ボタン        │                │                  │                   │
    │─────────────────>│                │                  │                   │
    │                  │                │                  │                   │
    │                  │ POST /rooms/:id/leave              │                   │
    │                  │───────────────>│                  │                   │
    │                  │                │                  │                   │
    │                  │ room.disconnect()                  │                   │
    │                  │──────────────────────────────────>│                   │
    │                  │                │                  │                   │
    │                  │                │                  │ participant_left   │
    │                  │                │                  │──────────────────>│
    │                  │                │                  │                   │
    │                  │                │                  │ 最後の参加者退出?   │
    │                  │                │                  │ Yes → Agent退出    │
    │                  │                │                  │                   │
    │                  │                │                  │                   │ WebSocket close
    │                  │                │                  │                   │──────> OpenAI
    │                  │                │                  │                   │
    │                  │                │                  │                   │ POST /internal/
    │                  │                │                  │                   │ translation/events
    │                  │                │                  │                   │ {type: "ended",
    │                  │                │                  │                   │  durationSeconds}
    │                  │                │ <────────────────────────────────────│
    │                  │                │                  │                   │
    │                  │                │ reconcile()      │                   │
    │                  │                │ - 予約と実使用の差分精算               │
    │                  │                │ - usage_reservation.status='reconciled'
    │                  │                │ - 超過があれば超過料金計算             │
    │                  │                │                  │                   │
    │                  │                │ UPDATE rooms     │                   │
    │                  │                │ SET status='ended', ended_at=now()   │
    │                  │                │                  │                   │
    │                  │ SCR-011 Call Summary               │                   │
    │                  │ {duration, cost,│                  │                   │
    │                  │  remaining,     │                  │                   │
    │                  │  transcript概要}│                  │                   │
    │                  │<──────────────│                  │                   │
```

## 5. 翻訳障害時のdegradationフロー

```
Translation Agent      OpenAI            API Server          Client App
    │                    │                   │                    │
    │ WebSocket切断      │                   │                    │
    │<───X───────────────│                   │                    │
    │                    │                   │                    │
    │ POST /internal/events                  │                    │
    │ {type: "degraded", │                   │                    │
    │  reason: "ws_disconnect"}              │                    │
    │───────────────────────────────────────>│                    │
    │                    │                   │                    │
    │                    │                   │ data channel:      │
    │                    │                   │ translation.degraded
    │                    │                   │───────────────────>│
    │                    │                   │                    │
    │                    │                   │                    │ UI: 「翻訳一時停止」
    │                    │                   │                    │ ambient 30% → 100%
    │                    │                   │                    │ 字幕: 停止
    │                    │                   │                    │ heartbeat: 停止
    │                    │                   │                    │
    │ 再接続試行(指数バックオフ)              │                    │
    │ 1s → 2s → 4s → 8s → 16s              │                    │
    │                    │                   │                    │
    │ [成功時]            │                   │                    │
    │ WebSocket再接続    │                   │                    │
    │────────────────────>                   │                    │
    │                    │                   │                    │
    │ POST /internal/events                  │                    │
    │ {type: "recovered"}│                   │                    │
    │───────────────────────────────────────>│                    │
    │                    │                   │                    │
    │                    │                   │ data channel:      │
    │                    │                   │ translation.recovered
    │                    │                   │───────────────────>│
    │                    │                   │                    │
    │                    │                   │                    │ UI: 翻訳再開
    │                    │                   │                    │ ambient 100% → 30%
    │                    │                   │                    │ heartbeat: 再開
    │                    │                   │                    │
    │ [5回失敗時]         │                   │                    │
    │ 翻訳完全停止       │                   │                    │
    │                    │                   │                    │
    │ POST /internal/events                  │                    │
    │ {type: "ended",    │                   │                    │
    │  reason: "reconnect_failed"}           │                    │
    │───────────────────────────────────────>│                    │
    │                    │                   │                    │
    │                    │                   │                    │ UI: 「翻訳が停止しました」
    │                    │                   │                    │ ambient 100%（原音のみ）
    │                    │                   │                    │ 通話自体は継続
```

## 6. ambient passthrough の音声ルーティング

```
LiveKit SFU側:
  Caller A の mic track → 2つのsubscriber経路に分岐
    ├── Translation Agent: subscribe (翻訳用、Agent内部で処理)
    └── Callee B: subscribe (ambient passthrough用)

Callee B のクライアント側:
  受信Track      音量       用途
  ─────────────────────────────────────
  raw-callerA    30%        ambient passthrough（常時再生）
  trans-A-to-ja  90%        翻訳済み音声

  翻訳音声到着時: ducking
    raw-callerA → 10%
    trans-A-to-ja → 90%

  翻訳が空の区間（同一言語発話など）:
    raw-callerA → 30%（そのまま聞こえる）
    trans-A-to-ja → 無音

  翻訳停止時（fallback）:
    raw-callerA → 100%
    trans-A-to-ja → 無音

LiveKit Token Grant:
  翻訳ONの場合でもraw trackのsubscribeは許可する（ambient用）。
  ただしクライアント側で音量制御（30%/10%/100%）を行う。
  Token grantではraw trackを「subscribe可能だが自動subscribeしない」設定:
  {
    "canSubscribe": true,
    "canPublish": true,
    "canPublishData": true,
    "hidden": false
  }
  ※ raw trackの自動subscribe無効化はクライアント側のroom.connect()オプションで制御
```
