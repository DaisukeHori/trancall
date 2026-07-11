# CLAUDE.md — @trancall/transcript

## モジュール概要
通話中のリアルタイム字幕と、通話後のトランスクリプト管理。

## 責務
- TranslatedFrameからトランスクリプトセグメント生成
- リアルタイム字幕のWebSocket配信
- トランスクリプト全文の永続化
- 全文検索・フィルタ
- PDF/TXTエクスポート・共有

## 関連する要件ID
SCRIPT-001〜SCRIPT-008

## 禁止依存

- billing を直接importしない
- contact を直接importしない
- notification を直接importしない
- auth を直接importしない（ユーザー情報はイベントpayloadから取得）
- room を直接importしない（`grantAccess` の呼び出しは `room.participant_joined` イベント経由、apps/server の `transcript-access-subscriber.ts` がオーケストレーション。Issue #69）
