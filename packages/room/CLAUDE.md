# CLAUDE.md — @trancall/room

## モジュール概要
通話セッション（Room）のライフサイクルを管理する。

## 責務
- Room作成（1対1、将来的にグループ対応）
- 参加者の入退室管理
- Room状態遷移（waiting → active → ended）
- 通話履歴の永続化

## 関連する要件ID
ROOM-001〜ROOM-010

## 発行するドメインイベント
- `room.created`
- `room.participant_joined`
- `room.participant_left`

## 禁止依存

- transcript を直接importしない
- translation を直接importしない（翻訳開始はイベント経由）
- contact を直接importしない（ブロック判定は自己定義の `BlockListRepository` 経由、実体は apps/server が contact の `BlockRepository` を包んで注入する。Issue #69）
