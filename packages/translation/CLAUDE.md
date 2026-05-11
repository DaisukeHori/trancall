# CLAUDE.md — @trancall/translation

## モジュール概要

GPT-Realtime-Translate APIへの接続を管理し、音声ストリームの双方向翻訳パイプラインを提供する。
このモジュールはTransport層（LiveKit/TRTC等）を知らない。AudioFrameのAsyncIterableを受け取り、翻訳済みAudioFrameのAsyncIterableを返す純粋な翻訳エンジンである。

## 責務

- GPT-Realtime-Translate WebSocket接続の確立・維持・再接続
- 翻訳セッション（TranslationSession）のライフサイクル管理
- 入力音声ストリーム → 翻訳済み音声ストリームの変換
- 翻訳テキスト（トランスクリプト）のデルタ出力
- 翻訳利用量（秒数）のトラッキングとイベント発行

## 関連する要件ID

TRANS-001〜TRANS-006（docs/requirements.md 3.4節参照）

## Public API (Facade)

```typescript
interface TranslationFacade {
  startSession(config: TranslationConfig): Promise<Result<TranslationConfig, AppError>>;
  translate(sessionId: TranslationSessionId, input: AsyncIterable<AudioFrame>): AsyncIterable<TranslatedFrame>;
  endSession(sessionId: TranslationSessionId): Promise<TranslationUsage>;
  getUsage(sessionId: TranslationSessionId): Promise<TranslationUsage>;
}
```

## 発行するドメインイベント

- `translation.started` — 翻訳セッション開始時
- `translation.ended` — 翻訳セッション終了時（利用量データ付き）

## 購読するドメインイベント

- なし（このモジュールは他モジュールから呼び出される側）

## 依存するモジュール

- `@trancall/shared-kernel` — EventBus, Result型, Branded Types

## 依存される側のモジュール

- `@trancall/media` — Translation AgentがこのモジュールのFacadeを呼ぶ
- `@trancall/billing` — `translation.ended` イベントを購読して利用量を加算
- `@trancall/transcript` — `TranslatedFrame.transcript` をリアルタイム字幕として使用

## 外部依存

- OpenAI Realtime Translation API
  - エンドポイント: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
  - 認証: Bearer token（サーバー側のみ）
  - 入力: PCM 24kHz モノラル
  - 出力: 翻訳済み音声（PCM） + トランスクリプトテキスト

## ディレクトリ構造

```
packages/translation/
├── CLAUDE.md              # このファイル
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # Public API exports
│   ├── schemas.ts         # Zodスキーマ定義
│   ├── facade.ts          # TranslationFacade実装
│   ├── services/
│   │   ├── translation-session.ts
│   │   └── realtime-ws-client.ts
│   ├── events/
│   │   ├── translation-started.ts
│   │   └── translation-ended.ts
│   └── types.ts
├── docs/
│   └── design.md          # モジュール設計書
└── __tests__/
    ├── facade.test.ts
    ├── translation-session.test.ts
    └── realtime-ws-client.test.ts
```

## テスト方針

- GPT-RT-Translate APIへの接続はモック化（WebSocket mock）
- AudioFrameのストリーム処理はユニットテストで検証
- 翻訳セッションのライフサイクル（開始→翻訳中→終了）を状態遷移テストで検証
- 利用量計算の正確性をテスト

## 注意事項

- OpenAI APIキーはこのモジュール内でハードコードしない。環境変数またはDIで注入
- WebSocket再接続ロジックは指数バックオフで実装
- 翻訳セッションが異常終了した場合も `translation.ended` イベントを発行すること
- PCM 24kHz モノラルはGPT-RT-Translateの要件。サンプルレートの変換はmediaモジュール側で行う
