# 設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | ChatGPT (GPT-4o) |
| 指摘数 | Critical 5 / Major 12 / Minor 9 |

---

## Critical 対応

### C-001: Agent-Server EventBus cross-process problem

**指摘:** Translation Agentは別プロセスなのにEventBusがin-process前提。

**対応: 設計変更**

Agent → Server間にHTTP内部APIを追加する。

- エンドポイント: `POST /internal/translation/events`
- 認証: Agent専用の署名付きトークン
- idempotency key: `session_id + event_type + timestamp`
- Agent側にoutboxパターンを実装（送信失敗時にローカルキューに退避、リトライ）
- Server側に `translation_events` テーブルを追加（永続化後にin-process EventBusに転送）
- in-process EventBusはServer内モジュール間のみに限定

### C-002: Latency 2s target is unvalidated

**指摘:** 翻訳レイテンシー2秒以内は未検証の希望値。

**対応: Phase 1a内で技術検証を実施**

Phase 0（独立PoC）は設けない。翻訳パイプラインの構築がそのままPoCになるため、独立フェーズにする意義が薄い。Phase 1aの初期タスクとしてレイテンシー測定と検証を行い、問題があればPhase 1a内で設計を修正する。

Phase 1a初期タスク:
- LiveKit SFU + Agent + GPT-RT-Translate の最小構成を組む
- 実機（iOS/Android）で p50/p95/p99 レイテンシーを測定
- バジェット分解: capture → uplink → agent queue → OpenAI first delta → republish → downlink
- 2秒を満たせない場合のfallback仕様を策定:
  - 字幕先行（音声翻訳より先にテキストを表示）
  - 原音小音量同時再生
  - 翻訳OFF fallback（通常通話に切替）

### C-003: Pricing model is loss-making

**指摘:** 全プランでヘビーユーザーが含有分を使い切ると赤字。

**対応: 分数半減 + 超過単価引き上げの組み合わせ**

修正後プラン:

| プラン | 月額(税込) | 翻訳分数 | 超過/分 | 原価率(目安) |
|--------|----------|---------|---------|------------|
| Free | 0 yen | 3 min | 利用不可 | - |
| Light | 980 yen | 30 min | 40 yen | ~63% |
| Standard | 2,980 yen | 120 min | 35 yen | ~56% |
| Business | 9,800 yen | 500 min | 30 yen | ~51% |

補足:
- B2B向けはWeb直接課金（Stripe）でストア手数料30%を回避する導線を設ける
- OpenAI料金改定時に自動でプラン改定提案を出す仕組み（為替・API単価モニタリング）
- Phase 1a（TestFlight）では課金機能は含めない

### C-004: Phase 1 MVP is too large

**指摘:** Phase 1に機能を詰め込みすぎ。

**対応: Phase 1を3分割**

| Phase | 内容 | ゴール |
|-------|------|--------|
| Phase 1a | 技術検証（レイテンシー測定）+ Supabase Auth + Contacts/QR/InviteLink + foreground通話 + 翻訳 + 字幕 + usage計測 | TestFlight/internal beta |
| Phase 1b | VoIP Push + CallKit + ConnectionService（バックグラウンド着信） | kill状態着信成功 |
| Phase 1c | Stripe + iOS IAP + Google Play IAP + ストア公開準備 | App Store / Play Store公開 |
| Phase 2 | グループ通話 + ビデオ + Chat | 機能拡張 |
| Phase 3 | Electron (macOS/Windows) | デスクトップ |

Phase 1aから除外する機能（Phase 2以降）:
- PDF/TXTエクスポート
- トランスクリプト全文検索
- 端末連絡先インポート
- ビデオ通話
- グループ通話

### C-005: Privacy policy for translation pipeline

**指摘:** Transcript保存ポリシー、同意、削除導線が未定義。

**対応: 保存ポリシー策定**

- Transcriptはデフォルト保存
- 通話の両参加者がTranscriptを閲覧可能
- 保持期間はプラン依存:

| プラン | 保持期間 |
|--------|---------|
| Free | 7日 |
| Light | 30日 |
| Standard | 90日 |
| Business | 1年 |

- ユーザーは手動でTranscriptを削除可能（削除APIを提供）
- 初回通話前に「通話内容は翻訳のためにOpenAI APIに送信されます」の同意画面を表示
- `consent_version` カラムをprofilesテーブルに追加
- segmentsテーブルに `retention_until`, `deleted_at` カラムを追加
- 保持期間を超えたセグメントは日次バッチで物理削除

---

## Major 対応

### M-001: room / signaling / media overlap → 対応

signalingモジュールを廃止し、`media/adapters/livekit` 配下に統合する。
モジュール数: 11 → 10

### M-002: Transport Adapter too LiveKit-specific → 対応

先にLiveKitAdapterを直接実装し、Phase 2のTRTC対応時に抽象を抽出する。
最初からインターフェースを作らず、実装駆動で抽象化する。

### M-003: No fallback when translation fails → 対応

翻訳失敗時のfallback仕様を追加:
- 原音を小音量（20%）で同時再生
- ワンタップで原音100%に切替可能
- 字幕のみ継続モード（音声翻訳停止、テキストのみ）
- 翻訳再接続中インジケータ表示

### M-004: Transcript write frequency → 対応

- partial deltaはメモリ + Supabase Realtime（字幕配信）のみ
- DBにはfinal segmentのみbatch insert（5秒バッファ）
- `room_id, participant_id, seq` のunique key追加
- `agent_session_id`, `language_pair` カラム追加

### M-005: RLS performance → 対応

以下のindexを追加:
- `participants(room_id, user_id)`
- `segments(room_id, start_time_ms)`
- `usage_records(user_id, recorded_at)`
- Transcript取得APIでは必ず `room_id` filterを要求

### M-006: Zod on AudioFrame hot path → 対応

- ZodバリデーションはAPI input, DB row, external event, session configに限定
- AudioFrameは内部TypeScript型 + dev-only assertion
- wire schemaはadapter層でBuffer/Uint8Arrayで扱う

### M-007: assertionStyle never too strict → 対応

- `as any` と `@ts-ignore` は禁止を維持
- `adapters/*` と `schemas/brand.ts` のみ例外許可
- `parseEnv()`, `brandUuid()`, `fromLiveKitTrack()` などaudited helperに閉じ込め

### M-008: TrackId = uuid vs LiveKit SID → 対応

- `DomainTrackId` (UUID) と `LiveKitTrackSid` (string branded) を分離
- 変換はadapter層のみで行う

### M-009: Expo Go incompatible → 対応

- 最初からEAS Build / prebuild / config plugin前提
- Phase 1bの受け入れ条件に以下を追加:
  - kill状態着信、ロック画面応答、Bluetooth、権限拒否ハンドリング

### M-010: Usage tracking crash resilience → 対応

- 通話開始時にminute reservation（残量からロック）
- 通話中30秒ごとにheartbeat usage送信
- 通話終了時にreconcile
- `session_id + window_start` で冪等化
- 残高不足時: warning → translation stop → 通常通話継続

### M-011: LiveKit token permission → 対応

- 翻訳ON時、LiveKit grantで相手のraw mic trackのsubscribeを不許可に設定
- Track命名規約: `raw-{participantId}`, `trans-{sourceId}-to-{lang}`
- server-side subscription policyとclient policyの両方で制御

### M-012: PDF export / full search too heavy for MVP → 対応

Phase 1aから除外済み（C-004対応に含む）

---

## Minor 対応

| ID | 対応 |
|----|------|
| m-001 | schemas.tsのVoiceTranslate表記を@trancallに統一 |
| m-002 | InputLanguageを `"auto" \| BCP47LanguageTag` に変更 |
| m-003 | segmentsに `retention_until`, `deleted_at`, `consent_version` 追加（C-005に含む） |
| m-004 | メトリクス一覧に `translation_latency_ms`, `first_audio_delta_ms`, `dropped_frames` 等を追加 |
| m-005 | 権限リクエスト画面をPhase 1aの画面一覧に追加 |
| m-006 | テストマトリクスを設計書に追加 |
| m-007 | 為替変動ガード（OpenAI単価×USD/JPYモニタリング）を運用設計に追加 |
| m-008 | 名前検索をopt-in discoverabilityに変更、デフォルトはTranCall ID完全一致 |
| m-009 | Result型の適用範囲を文書化（ドメインエラー→Result、プログラミングエラー→fail-fast） |

---

## 質問への回答

| ID | 質問 | 回答 |
|----|------|------|
| Q-001 | GPT-RT-Translate実API PoCは完了しているか？ | 未完了。Phase 1aの初期タスクとして実施する |
| Q-002 | Transcriptはデフォルト保存かopt-inか？ | デフォルト保存 |
| Q-003 | Phase 1のゴールは？ | Phase 1a = TestFlight/internal beta、Phase 1c = ストア公開 |
| Q-004 | 課金対象は？ | 翻訳を利用する通話の両参加者ではなく、通話を開始した側（caller）が負担。ただし将来的に検討 |
| Q-005 | 対象市場は？ | 日本中心でスタートし、グローバル展開 |
| Q-006 | Agent→Server認証方式は？ | 署名付きAgent token + idempotency key + outbox（C-001対応） |
| Q-007 | 機密性の高い用途を想定するか？ | Phase 1では想定しない。Phase 4（エンタープライズ）で対応 |
