# CLAUDE.md — @trancall/shared-kernel

## モジュール概要
全モジュールが共有する基盤レイヤー。Event Bus、DIコンテナ、共通Zodスキーマ、Branded Types、Result型ユーティリティを提供する。

## 責務
- ドメインイベントバス（publish/subscribe）の実装
- Branded Types定義（UserId, RoomId, TrackId, ParticipantId, TranslationSessionId）
- OutputLanguage / InputLanguage スキーマ
- AppError型、createResult()、validate() ユーティリティ
- DomainEventBase 共通スキーマ
- DIコンテナ設定

## 注意事項
- このモジュールはビジネスロジックを持たない
- 他の全モジュールがこれに依存する（循環依存に注意）
- Zodスキーマの変更は全モジュールに影響するため慎重にレビュー
