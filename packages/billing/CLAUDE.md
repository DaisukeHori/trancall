# CLAUDE.md — @trancall/billing

## モジュール概要
翻訳通話の利用量トラッキングと課金を管理する。

## 責務
- サブスクリプション状態管理（Free/Light/Standard/Business）
- 翻訳通話の分単位利用量トラッキング
- 超過料金の計算
- Stripe Checkout Session作成
- iOS/Android IAPとの同期
- 通話開始前の残量チェック

## 関連する要件ID
BILL-001〜BILL-010

## 購読するドメインイベント
- `translation.ended`

## 外部依存
- Stripe API
- App Store Server API (StoreKit 2)
- Google Play Billing Library
