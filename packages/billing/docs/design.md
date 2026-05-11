# @trancall/billing 設計書

## 責務
翻訳通話の利用量計測・課金・サブスクリプション管理。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── subscription-service.ts
│   ├── usage-metering.ts        # heartbeat受信 + window記録
│   ├── reservation-service.ts   # 通話開始時のminute lock
│   └── plan-calculator.ts       # プラン別分数・超過計算
├── repositories/
│   ├── subscription-repository.ts
│   ├── usage-repository.ts
│   └── reservation-repository.ts
├── adapters/
│   ├── stripe-adapter.ts
│   ├── apple-iap-adapter.ts
│   └── google-play-adapter.ts
└── events/
    └── (translation.endedを購読)
```

## 課金フロー
1. 通話開始: reserveMinutes(userId, estimatedMin)
2. 通話中: heartbeat 30秒ごとにusage_window INSERT（冪等）
3. 通話終了: reconcile(userId, sessionId) — 予約と実使用の差分精算
4. 残高不足: shouldContinue=false → Agent翻訳停止

## 冪等性
- idempotency_key = `{sessionId}:heartbeat:{windowIndex}`
- usage_windows.idempotency_key UNIQUE制約
