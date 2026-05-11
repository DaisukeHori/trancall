# CLAUDE.md — @trancall/auth

## モジュール概要
Supabase Authをラップし、ユーザー登録・認証・プロフィール管理を提供する。

## 責務
- メール+パスワードによるサインアップ/サインイン
- OAuth（Google, Apple）ソーシャルログイン
- JWTトークン管理（発行、検証、リフレッシュ）
- ユーザープロフィールCRUD（表示名、アバター、ネイティブ言語）
- TranCall ID（ユニークID）の自動生成

## 関連する要件ID
AUTH-001〜AUTH-008

## 発行するドメインイベント
- `auth.user_registered`

## 外部依存
- Supabase Auth
