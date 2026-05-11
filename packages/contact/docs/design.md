# @trancall/contact 設計書

## 責務
連絡先管理、ブロック、通報、ユーザー検索。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── contact-service.ts
│   ├── search-service.ts     # TranCall ID完全一致 + opt-in名前検索
│   ├── block-service.ts
│   ├── report-service.ts
│   └── invite-link-service.ts
└── repositories/
    ├── contact-repository.ts
    ├── block-repository.ts
    └── report-repository.ts
```

## 検索ポリシー
- デフォルト: TranCall ID完全一致のみ
- 名前検索: ユーザーがopt-inした場合のみ
- ブロック済みユーザーは検索結果に表示しない
- Rate limit: 10 req/min
