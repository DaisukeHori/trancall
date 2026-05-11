# CLAUDE.md — @trancall/media

## モジュール概要
音声トラックの抽象化レイヤー。TransportPort（Ports & Adapters）パターンでSFUの差し替えを可能にする。

## 責務
- TransportPort インターフェース定義
- LiveKitAdapter 実装（Phase 1）
- AudioFrameストリームの生成・消費
- 翻訳済みトラックのPublish制御
- サンプルレート変換（PCM 16kHzに統一）

## 関連する要件ID
MEDIA-001〜MEDIA-006

## 注意事項
- Phase 2でTRTCAdapter追加時、TransportPort interfaceを変更しない
