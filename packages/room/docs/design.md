# @trancall/room 設計書

## 責務
通話セッションのライフサイクル管理。LiveKit Room制御はmedia/adaptersに委譲。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── room-service.ts
│   └── room-state-machine.ts   # waiting → active → ended
├── repositories/
│   └── room-repository.ts      # Supabase trancall_room.*
└── events/
    ├── room-created.ts
    ├── participant-joined.ts
    └── participant-left.ts
```

## 状態遷移
- waiting: Room作成済み、参加者待ち
- active: 2人以上参加、通話中
- ended: 全員退出 or 明示的終了

## Room作成時の前処理
1. billingFacade.canStartCall() → 残高チェック
2. billingFacade.reserveMinutes() → 分数予約
3. media/livekit.createRoom() → LiveKit Room作成
4. notificationFacade.sendIncomingCall() → 相手に着信通知
