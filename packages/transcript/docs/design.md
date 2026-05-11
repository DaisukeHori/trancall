# @trancall/transcript 設計書

## 責務
リアルタイム字幕配信（一時データ）+ final segment永続化 + アクセス制御。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts          # LiveSubtitleDelta, TranscriptSegment, TranscriptAccess
├── facade.ts
├── services/
│   ├── subtitle-service.ts       # LiveKit data channel 配信
│   ├── segment-persister.ts      # final segment → batch INSERT
│   ├── access-service.ts         # transcript_access 管理
│   └── retention-service.ts      # 保持期限切れ削除
└── repositories/
    ├── segment-repository.ts
    └── access-repository.ts
```

## partial vs final
- partial delta: メモリ + LiveKit data channel のみ（DB書き込みなし）
- final segment: 5秒バッファ後にbatch INSERT（source_event_id で冪等化）
- 字幕UI: partial=末尾に "..." 点滅、final=実線ボーダー化

## アクセス制御
- 両参加者がTranscriptを閲覧可能
- 片方削除 → 自分のtranscript_access.deleted_at設定、相手のアクセス維持
- 両者削除後 → 日次バッチでsegment物理削除
- 保持期限: Free=7日, Light=30日, Standard=90日, Business=1年
