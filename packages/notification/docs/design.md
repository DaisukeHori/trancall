# @trancall/notification 設計書

## 責務
VoIP Push（APNs）、FCM、デバイストークン管理。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── apns-service.ts          # iOS VoIP Push
│   ├── fcm-service.ts           # Android
│   └── device-token-service.ts  # トークン登録・失効管理
└── repositories/
    └── device-token-repository.ts
```

## iOS VoIP Push 必須要件
- Push受信 → 即座にCallKit reportNewIncomingCall
- 報告しないとiOSがVoIP Push配信を停止する（エンタイトルメント剥奪）
- 実装責任はapps/mobile側だが、payload形式はこのモジュールが定義

## APNs証明書
- VoIP Push専用証明書（通常Push証明書とは別）
- 有効期限1年、更新フローを運用書に記載
