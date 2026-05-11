# @trancall/media 設計書

## 責務
音声トラック管理、LiveKit接続、Token発行（旧signaling統合）。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts               # AudioFormatConfig, MediaTrackInfo, TrackPermissions
├── facade.ts
├── adapters/
│   └── livekit.ts           # LiveKitAdapter（Phase 1の唯一のadapter）
├── services/
│   ├── track-router.ts      # Track subscribe policy制御
│   └── audio-resampler.ts   # 48kHz ↔ 24kHz 変換
└── types.ts                 # AudioFrame(内部型、Zod除外)
```

## Track命名規約
- `raw-{participantId}` — 原音マイクトラック
- `trans-{sourceId}-to-{lang}` — 翻訳済みトラック

## Subscribe Policy
翻訳ON時:
- クライアントは相手の `raw-*` を subscribe しない（LiveKit grant制御）
- `trans-*-to-{自分の言語}` のみ subscribe
- ambient passthrough 30%は別経路（raw trackを低音量で受信）

翻訳OFF時:
- 通常の auto-subscribe

## リサンプリング
- LiveKit内部: 48kHz（Opus codec）
- OpenAI要件: 24kHz PCM16
- adapter層で双方向変換
