# CLAUDE.md — @trancall/media

## モジュール概要
音声トラックの管理とSFU接続を担当するモジュール。
旧signalingモジュールの責務（LiveKit Room作成、Token発行）を統合済み。

## 責務
- LiveKitAdapter実装（Room作成/削除、Token発行、参加制御）
- AudioFrameストリームの生成・消費
- 翻訳済みトラックのPublish制御（対象参加者のみSubscribe）
- サンプルレート変換（PCM 24kHzに統一）
- Track命名規約の管理: `raw-{participantId}`, `trans-{sourceId}-to-{lang}`
- LiveKit grant / subscription policyによるアクセス制御

## 関連する要件ID
MEDIA-001〜MEDIA-006

## 設計方針（レビュー対応）
- 先にLiveKitAdapterを直接実装し、Phase 2 TRTC対応時に抽象を抽出する（M-002）
- AudioFrameにZodバリデーションを適用しない（hot path除外、M-006）
- DomainTrackId(UUID) と LiveKitTrackSid(string branded) を分離（M-008）
- adapters/ 内のみ型アサーション例外許可（M-007）

## 翻訳fallback（M-003）
翻訳失敗時の制御もこのモジュールが担当:
- 原音を小音量（20%）で同時再生
- ワンタップで原音100%に切替
- 字幕のみ継続モード
- 翻訳再接続中インジケータのトリガー

## 外部依存
- LiveKit Server SDK
- LiveKit Client SDK (React Native)
