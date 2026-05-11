# CLAUDE.md — @trancall/notification

## モジュール概要
VoIPプッシュ通知の送信。

## 責務
- デバイストークン登録（APNs VoIP / FCM）
- 着信通知・不在着信通知の送信
- iOS CallKit連携用データフォーマット
- Android ConnectionService連携用データフォーマット

## 関連する要件ID
NOTIF-001〜NOTIF-006

## 外部依存
- Apple Push Notification Service (APNs)
- Firebase Cloud Messaging (FCM)
