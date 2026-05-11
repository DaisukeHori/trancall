# @trancall/auth 設計書

## 責務
Supabase Auth ラッピング、プロフィール管理、TranCall ID生成、同意管理。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts          # SignUpCommand, SignInCommand, UserProfile, AuthSession
├── facade.ts           # AuthFacade実装
├── services/
│   ├── auth-service.ts
│   └── trancall-id-generator.ts  # @prefix + ランダム or 名前ベース
├── repositories/
│   └── profile-repository.ts     # Supabase trancall_auth.profiles
└── events/
    └── user-registered.ts
```

## TranCall ID生成ルール
- `@` + 英数字 + アンダースコア、3-30文字
- 登録時に自動生成（displayNameのローマ字変換 + 4桁乱数）
- ユーザーによる変更可能（uniqueチェック）

## email verification
- Supabase Auth の confirm email 機能を使用
- emailVerified=false のユーザーは通話発信不可（着信は可能）
