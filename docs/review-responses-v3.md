# 第3回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | ChatGPT (別インスタンス) — 第3回 |
| 指摘数 | Critical 6 / Major 14 / Minor 13 |
| 特徴 | 修正漏れ・ドキュメント間不整合の指摘が中心 |

---

## Critical 対応

### C-001: レイテンシー実測をPhase 1a終了条件に

対応: 同意。Phase 1aの終了条件に以下を追加:
- 言語ペア別 `first_translated_audio_ms`, `end_of_utterance_to_audio_ms` のp95計測
- p95 > 4秒の場合: 字幕優先/翻訳音量下げ/短文のみ音声化の自動フォールバック

### C-002: 課金プラン表の二重定義

対応: 即修正。古い60/300/1200分の記述を削除し、30/120/500分に統一済み。
Free枠も3分に統一。

### C-003: Stripe Web課金とIAPの併用が審査リスク

対応: 設計変更。
- アプリ内課金はIAPに一本化
- Stripe Webは「アプリ外Webサイトでの購入→アカウント権利同期」に限定
- アプリ内にStripe checkout導線を置かない
- BILL-007の要件文言を修正済み

### C-004: Transcript保存のDB・同意モデル不整合

対応: schemas.tsにカラム追加済み。
- `retentionUntil`, `deletedAt`, `consentVersion`, `sourceEventId`, `sequenceNo`, `languagePair`, `agentSessionId`
- 「片方が削除した場合」→ 自分のアクセス権のみ削除、相手の閲覧権は維持
- 「OpenAI送信前同意」→ AUTH-009で両当事者から取得（第2回で対応済み）

### C-005: CallKit/ConnectionService検証のPhase 1a前倒し

対応: Phase 1aの技術検証タスクに追加済み。
- 1画面だけの技術検証アプリで実機検証（着信表示、応答、マイク権限、BT切替、バックグラウンド復帰）
- 機能実装はPhase 1b、実現性検証はPhase 1a

### C-006: assertionStyleルールの齟齬

対応: CLAUDE.md修正済み。
- ルートCLAUDE.mdにadapters/*とschemas/brand.tsの例外を明記
- 境界変換ヘルパー（fromLiveKitTrackSid, parseOpenAIEvent等）のみ許可
- ドメインコードでは禁止を維持

---

## Major 対応

| ID | 対応 |
|----|------|
| M-001 | signaling パッケージをCLAUDE.mdとREADMEでDEPRECATED明記。Phase 1実装時に物理削除 |
| M-002 | 同意。抽象化は AudioFrame入出力, Track publish, Participant subscription, Room lifecycleの4点のみ |
| M-003 | translation.canAllocateSession() を追加。OpenAI/LiveKit/Agent容量不足時に字幕のみ/原音のみ/待機を返す |
| M-004 | usage_recordsにtranslation_session_seconds, input_audio_seconds, output_audio_seconds, language_pair追加 |
| M-005 | 同意。通話中字幕はLiveKit data channel、DB保存はfinal segmentのみbatch insert |
| M-006 | Phase 1aにRLSテスト（pgTAP相当）をCI必須化 |
| M-007 | DomainTrackId, LiveKitTrackSid, OpenAITranslationSessionId を分離（第2回M2-008で対応済み） |
| M-008 | streaming用にAsyncGenerator<StreamEvent, StreamFatalError>を検討。Phase 1a実装時に判断 |
| M-009 | TypeScriptで行く。rtc-nodeのリスクは許容。PoCで長時間通話・メモリリーク検証を実施 |
| M-010 | client_secret発行条件: room_participant_id, target_language, ttl=60s, max_duration, rate_limit_key |
| M-011 | Phase 1は「Transport encryptionのみ」と明示。E2EEはPhase 4エンタープライズ |
| M-012 | 現状のPhase 1a範囲で行く。QR/InviteLink/お気に入りは含める |
| M-013 | 同意。MVPでは通話中字幕は一時データ、通話後保存はデフォルトONだがopt-outで削除可能 |
| M-014 | block_list, report_events をPhase 1a要件に追加済み（CONTACT-009〜011） |

---

## Minor 対応

| ID | 対応 |
|----|------|
| m-001 | signaling を全ドキュメントでDEPRECATED明記 |
| m-002 | プラン表を1つに統一済み |
| m-003 | ワイヤーフレームのvoice UIは次回更新時に削除 |
| m-004 | InputLanguageを "auto" \| BCP47 に修正済み |
| m-005 | AudioFrame hot pathではZod不使用。境界変換後はUint8Array |
| m-006 | startTime/endTimeの単位をms明記済み |
| m-007 | AppErrorにretryable, httpStatus, providerを追加検討（Phase 1a実装時） |
| m-008 | 金額はDB上integer（amount_yen）で管理。decimal廃止 |
| m-009 | translation.session.rate_limited, degraded, recoveredをイベント追加検討 |
| m-010 | テストマトリクスをPhase 1b受け入れ条件に追加（第2回で対応済み） |
| m-011 | 退会処理ポリシーをPhase 1c要件に追加 |
| m-012 | device_tokens, push_subscriptions テーブルをDB設計に追加検討 |
| m-013 | Phase 1成功指標: 初回通話成功率, p95翻訳遅延, 10分通話完走率 |

---

## 質問への回答

| ID | 回答 |
|----|------|
| Q-001 | 日本中心でスタート。Phase 1cは日本App Store/Play Storeのみ |
| Q-002 | OpenAI Tier 1から開始。ピーク同時通話10程度から。スケール時にTier上げ申請 |
| Q-003 | 課金単位は「通話分」（caller負担）。内部ではtranslation_session_secondsで記録 |
| Q-004 | 発信者（caller）が分数を消費。着信者は無料 |
| Q-005 | デフォルトON。opt-outで削除可能 |
| Q-006 | 片方削除→自分のアクセス権のみ削除。相手の閲覧権は維持 |
| Q-007 | Phase 1aはセルフホスト（Proxmox LXC）。LiveKit Cloudは比較検討 |
| Q-008 | TypeScript確定。rtc-nodeのリスクは許容 |
| Q-009 | Phase 1では高機密ユースケースは想定しない。Phase 4で対応 |
| Q-010 | 将来必須ではないが検討対象。Phase 1ではVoIPのみ |
| Q-011 | アプリ内にStripe決済導線は置かない。Web外部サイトのみ |
| Q-012 | 「翻訳音声が自然に会話として成立する」が合格ライン。字幕はサポート |
