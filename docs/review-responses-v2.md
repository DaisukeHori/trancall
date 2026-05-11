# 第2回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | ChatGPT (GPT-4o) — 第2回（別視点） |
| 指摘数 | Critical 5 / Major 16 / Minor 10 |

---

## Critical 対応

### C2-001: サンプルレート 16kHz → 24kHz

**対応: 即修正**

OpenAI公式は「24 kHz PCM16」を明示。全ドキュメントの16kHz記述を修正。
- schemas.ts: `sampleRate: z.union([z.literal(24000), z.literal(48000)])`
- media adapter層で 48kHz(LiveKit内部) ↔ 24kHz(OpenAI) の変換を実装
- requirements.md MEDIA-003, translation CLAUDE.md, architecture.md 全修正済み

### C2-002: ボイス選択はAPI不可

**対応: 要件削除 + 差別化転換**

OpenAI公式「This model does not currently support voice selection parameters」。
GPT-RT-Translateはdynamic voice adaptation（話者の声に自動適応）で翻訳音声を生成。
- TRANS-004 を削除（voiceパラメータ自体が存在しない）
- schemas.ts の TranslationConfig から voice enum を削除
- SCR-006 Settings / SCR-009 Pre-call setup から「Translation voice」UIを削除
- 代わりに「相手の声に自動適応する翻訳音声」を差別化要素として訴求

### C2-003: 同一言語入力で無音問題

**対応: ambient passthroughをデフォルト有効化**

日本語ネイティブが "OK" "Thank you" と英語で言った場合、翻訳されず無音になる問題。
- 原音を30%音量で常時パススルー（ambient passthrough）
- 翻訳音声到着時はducking（原音を10%に下げ、翻訳を90%）
- 翻訳が来ない区間は原音が30%で聞こえ続ける
- M-003のfallback（翻訳失敗時）とは別レイヤー、通常運転時の仕様
- TRANS-007として要件追加済み

### C2-004: Expo SDK 53 New Architecture問題

**対応: Phase 1a最初の検証タスク**

LiveKit RN SDK, react-native-callkeep がNew Architecture未対応の報告あり。
Phase 1aの最初のタスクとして以下を検証:
- Expo SDK 53 + New Architecture + LiveKit RN SDK v2 + EAS Build → 実機音声通話
- 失敗時のfallback案（文書化済み）:
  - (a) New Architectureをopt-out（`newArchEnabled: false`）
  - (b) iOS: Swift Native Module + RN Bridge で独自実装
  - (c) プラットフォーム変更（Flutter / native）の検討

### C2-005: 電気通信事業届出

**対応: Phase 1cまでに対応。運営主体は後日決定**

TranCallは「特定のユーザーへ音声を伝達する」サービスであり、届出が必要な可能性が高い。
- Phase 1c（ストア公開）までに通信事業弁護士に相談
- (a) 電気通信事業の届出、(b) 通信の秘密の保護に関する内規、(c) 外部送信規律の実装
- 運営主体（Revol / MHD医健 / 新規法人）は後日判断
- Phase 1aではAUTH-009（同意取得画面）を実装

---

## Major 対応

### M2-001: 競合分析の整理

Apple Phone Live Translationは国際電話料金前提。TranCallはVoIPの隙間を狙う。
真の脅威はApple Call Translation APIをLINE/WhatsApp等が採用するタイミング。
差別化の窓は12-36ヶ月と想定。対抗策:
- B2Bログ・トランスクリプト検索で差別化
- Android対応を重視（Call Translation APIはiOSのみ）
- Phase 2のグループ通話・ビデオ翻訳を急ぐ

### M2-003: LiveKit Agent TS版の機能不足

FallbackAdapterが未実装。対応:
- Phase 1aでは@livekit/rtc-node + 自前Room接続ロジックで薄く実装
- Python版への切り替えも選択肢として残す（monorepo構成に影響）
- Phase 1aの技術検証結果で判断

### M2-004: client-side sidecar vs server-side Agent

**Phase 1aで両方試してレイテンシー比較する。**

server-side Agent:
- 利点: APIキー保護、利用量中央管理、Transcript中央集約
- 欠点: SFU往復のレイテンシー加算（推定+200-400ms）

client-side sidecar:
- 利点: 端末→OpenAI直接でレイテンシー低い
- 欠点: `/v1/realtime/translations/client_secrets`で短命トークン発行が必要
- 利点: APIキーはサーバーから短命シークレットを発行するので保護可能

Phase 1a技術検証タスク:
1. server-side Agentでp50/p95計測
2. client-side sidecarでp50/p95計測
3. 差が有意ならsidecar採用、差が小さいならAgent採用（運用しやすい方）

### M2-005: OpenAI同時セッション上限

Tier 5で最大100同時セッション（≒50同時通話）。
- Phase 1c前にTier上げ+レート緩和申請
- Phase 2グループ通話ではlistener-driven session sharingで最適化
- 要件に同時通話上限を明記

### M2-006: Pre-call setup毎回表示の問題

**初回通話 + 相手言語変更時のみ表示に変更。**
- Contactごとに `last_used_translation_config` を保存
- 2回目以降はContact profileから直接発信→ringing画面に直行
- 通話中から設定変更可能

### M2-007: 着信画面のコスト表示削除

**着信画面からコスト表示を削除。**
- コスト表示は発信側Pre-call setup + 通話後Call summaryのみ
- 着信画面は「誰が掛けてるか」「翻訳方向」に集中
- Q-004回答（caller負担）と整合

### M2-008: 字幕のpartial→final確定UI

design docsに以下を明文化:
- partial: 字幕末尾にloading dot「...」
- final確定: dot消去、枠線実線化
- 最大3発話分表示、古いものはフェードアウト
- 翻訳遅延中: 枠線が点滅インジケータ
- 沈黙: 表示なし（最後の字幕が数秒後にフェード）

### M2-009: OpenAI障害時のgraceful degradation

段階的対応:
- 429/503: リトライ（指数バックオフ）→ 3回失敗で翻訳停止、原音継続
- WebSocket切断: 再接続試行、その間は原音パススルー100%
- OpenAI Safety停止: 翻訳のみ停止、通話継続、字幕停止、ユーザー通知
- billing: 翻訳停止時点でheartbeat停止

### M2-010: WebSocket再接続中の音声バッファ

再接続中は音声破棄、再接続後はクリーンスタート。
Transcript欠落は「[翻訳中断: XX秒]」としてセグメントに記録。

### M2-011: Translation Agentクラッシュ耐性

- 1プロセスあたり最大10Room
- メモリ上限512MB（pm2/systemd管理）
- クラッシュ時: 翻訳停止→原音継続、ユーザーに「翻訳が一時停止しました」
- ホスティング: セルフホストLXC（Proxmoxクラスタ）

### M2-012: iOS VoIP Push濫用検出

Phase 1bの受け入れ条件に追加:
- VoIP Push受信→必ずCallKit報告
- 通話中2件目着信のハンドリング
- DND中、権限拒否済みのフォールバック

### M2-013: adaptive bitrate

- Agent→OpenAI: PCM 24kHz（384kbps、圧縮なし）
- Agent→LiveKit: Opus 32-48kbps
- LiveKit dynacast/adaptiveStreamを活用

### M2-014: バッテリー/CPU負荷

Phase 1aで実機計測（30分通話のバッテリードレイン）。
計測結果をもとにプラン分数の妥当性を再評価。

### M2-015: 着信者同意フロー

AUTH-009として要件追加済み:
- 発信者: アプリ内同意画面（初回通話前）
- 着信者: 応答後に初回のみ同意画面表示
- 拒否時: 翻訳OFFで通話継続
- consent_versionをparticipant単位で保存

### M2-016: B2C vs B2B

**B2Cで行く。両者インストール前提。**
将来的にPSTN接続（Twilio Media Streams）も検討するが、Phase 1では対象外。
ユーザー獲得はQRコード・招待リンクで両者のオンボーディングを最小化する方針。

---

## Minor 対応

| ID | 対応 |
|----|------|
| m2-001 | OpenAI-Safety-Identifierヘッダー送信をAgent実装に追加 |
| m2-002 | gpt-realtime-whisperを原文転写に併用（SCRIPT-001に反映済み） |
| m2-003 | react-native-callkeepのNew Architecture問題はPhase 1bで評価。独自ラップも検討 |
| m2-004 | 翻訳遅延vs沈黙の区別UI（「相手が話しています」「翻訳しています」「翻訳しています...」） |
| m2-005 | 為替・単価変動の自動アラート（Slack通知、原価率65%超で発火） |
| m2-006 | email verification必須、スパム通報、ブロック機能をPhase 1aに追加 |
| m2-007 | TranscriptSegment.speakerNameをPhase 1から必須に（Phase 2グループ通話準備） |
| m2-008 | LiveKit Egressは現設計では使わないと明示 |
| m2-009 | LiveKit preconnect bufferをPhase 1a計測タスクで評価 |
| m2-010 | Phase 1b検証マトリクスにkill/ロック/BT/DND/機内モード/別通話中/再起動後を追加 |

---

## 質問への回答

| ID | 回答 |
|----|------|
| Q2-001 | 16kHzは誤り。即修正済み（24kHz） |
| Q2-002 | VoIPアプリの隙間 + B2Bログ要件。日本中心でスタート |
| Q2-003 | Phase 1aで両方試してレイテンシー比較する |
| Q2-004 | caller事前同意 + callee応答後初回同意。UX優先 |
| Q2-005 | 運営主体は後日判断 |
| Q2-006 | セルフホストLXC（Proxmoxクラスタ） |
| Q2-007 | B2Cで行く。App Store公開を本気でゴールにする |
| Q2-008 | voice選択を諦める。dynamic voice adaptationを差別化に転換 |
| Q2-009 | Apple Call Translation APIの範囲は未確認。要調査 |
