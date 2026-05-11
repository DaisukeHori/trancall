# @trancall/shared-kernel 設計書

## 責務
全モジュール共通の型・ユーティリティ。ビジネスロジック禁止。

## ディレクトリ
```
src/
├── index.ts                    # Public exports
├── schemas/
│   ├── brand.ts                # Branded Type + factory helpers
│   ├── result.ts               # Result型 + AppError + validate()
│   ├── language.ts             # OutputLanguage(13) + InputLanguage(auto|BCP47)
│   └── events.ts               # DomainEventBase
└── event-bus/
    └── in-process-event-bus.ts  # EventBus実装（Server内のみ）
```

## 依存
- zod ^4.4.3（唯一の外部依存）

## テスト
- brand factory: 有効/無効UUID、空文字、型安全性
- validate: 正常/異常入力、エラーメッセージ
- OutputLanguage: 13言語すべてのparse
- InputLanguage: "auto", "ja", "zh-Hans", "pt-BR", 不正値
