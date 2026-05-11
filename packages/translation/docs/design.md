# @trancall/translation 設計書

## 責務
GPT-RT-Translate WebSocket接続、翻訳セッション管理。Transport非依存。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── translation-session.ts       # 1セッション = 1出力言語
│   ├── openai-ws-client.ts          # WebSocket接続・再接続
│   ├── language-pair-resolver.ts    # nativeLanguageベースの判定
│   └── safety-identifier.ts        # SHA-256(userId) 生成
├── events/
│   ├── translation-started.ts
│   ├── translation-ended.ts
│   ├── translation-degraded.ts
│   └── translation-recovered.ts
└── types.ts                         # TranslatedFrame(内部型)
```

## OpenAI WebSocket接続
- URL: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- Headers: `Authorization: Bearer`, `OpenAI-Safety-Identifier: SHA256(APP_SECRET + userId)`
- セッション設定: `session.update` で `session.audio.output.language` のみ指定（入力言語は自動検出）
- 音声送信: `session.input_audio_buffer.append` (base64 PCM16 24kHz mono)
- 翻訳音声受信: `session.output_audio.delta` (200msフレーム base64 PCM16)
- 翻訳文受信: `session.output_transcript.delta` / `session.output_transcript.done`
- 原文受信: `session.input_transcript.delta` / `session.input_transcript.done`
- silence連続投入（VADで切らない）
- inputLanguageパラメータはOpenAI APIに存在しない（内部判定専用）

## 再接続
- 指数バックオフ: 1s→2s→4s→8s→16s（最大5回）
- 再接続中: 音声破棄、クリーンスタート
- 5回失敗: 翻訳停止→原音fallback→ユーザー通知

## Admission Control
- canAllocateSession(): OpenAI同時セッション上限チェック
- Tier 1: 50 audio minutes/min → ~25同時通話
