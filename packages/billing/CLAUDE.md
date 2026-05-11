# CLAUDE.md — @trancall/billing

## モジュール概要
翻訳通話の利用量トラッキングと課金を管理する。

## 責務
- サブスクリプション状態管理（Free/Light/Standard/Business）
- 翻訳通話の分単位利用量トラッキング
- 超過料金の計算
- **3チャネルの購入フロー管理**:
  - iOS/Android IAP（App Store Server API / Google Play Billing）
  - StoreKit External Purchase（アプリ内に外部Stripeリンク、MSCA併設）
  - Stripe Web（アプリ外、B2B/年間契約）
- Apple StoreKit External Purchase 取引のApple月次レポート
- 通話開始前の残量チェック

## 関連する要件ID
BILL-001〜BILL-010

## 購読するドメインイベント
- `translation.ended`

## 外部依存
- Stripe API
- App Store Server API (StoreKit 2)
- App Store External Purchase Server API（StoreKit External 取引のレポート）
- Google Play Billing Library

## 禁止依存

- transcript を直接importしない（billing → transcript の依存禁止）
- media を直接importしない（通話状態はイベント経由で取得）
- notification を直接importしない
