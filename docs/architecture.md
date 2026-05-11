# TranCall アーキテクチャ設計書

| 項目 | 内容 |
|------|------|
| ドキュメントID | ARCH-001 |
| バージョン | 1.0.0 |
| 作成日 | 2026-05-11 |
| 前提ドキュメント | REQ-001 要件定義書 |

---

## 1. アーキテクチャスタイル

モジュラーモノリス（Modular Monolith）を採用する。

単一のデプロイ単位の中にドメイン境界で分割された独立モジュールを配置する。モジュール間の通信はin-processの関数呼び出し（Facade経由）とドメインイベント（EventBus）で行う。

### 1.1 選定理由

- Phase 1は少人数開発でありマイクロサービスの運用コストは不釣り合い
- モジュール境界をZodスキーマで厳密に定義するため将来の分離が容易
- in-process通信によりレイテンシーとネットワーク障害のリスクを排除
- 翻訳パイプラインのみ別プロセス（Translation Agent）で稼働させる

---

## 2. システム全体構成

### 2.1 デプロイ単位

| ユニット | 内容 | ランタイム |
|---------|------|----------|
| apps/mobile | React Nativeクライアント | iOS / Android端末 |
| apps/server | APIサーバー + 全バックエンドモジュール | Node.js (Vercel or セルフホスト) |
| apps/translation-agent | 翻訳ワーカー（LiveKit Agent） | Node.js (セルフホスト) |
| LiveKit SFU | メディアサーバー | セルフホスト or LiveKit Cloud |
| Supabase | DB + Auth | Supabase Cloud |

---

## 3. モジュール詳細設計

### 3.1 モジュール依存関係

- shared-kernel ← 全モジュールが依存
- contact → auth (ユーザー検索)
- room → signaling (Token発行)
- media/adapters/livekit → LiveKit Server SDK（signalingを統合）
- media → translation (翻訳呼び出し) + signaling (Track制御)
- translation → OpenAI GPT-RT-Translate
- billing ← translation.ended イベントを購読
- transcript ← translation (TranslatedFrame受信)

### 3.2 各モジュールのレイヤー構造

```
packages/{module}/src/
├── index.ts          # Public exports（Facadeのみ）
├── schemas.ts        # Zodスキーマ（Public API契約）
├── facade.ts         # Facade実装（唯一の外部エントリポイント）
├── services/         # ドメインサービス（ビジネスロジック）
├── repositories/     # データアクセス（Supabase）
├── events/           # ドメインイベント定義
├── adapters/         # 外部サービスアダプタ（mediaモジュールのみ）
└── types.ts          # 内部型（exportしない）
```

### 3.3 package.json exports による境界強制

外部モジュールは `.` (Facade) と `./schemas` (Zodスキーマ) のみimport可能。services/ や repositories/ への直接アクセスは不可。

---

## 4. 通信設計

### 4.1 同期通信（Facade呼び出し）

モジュールAがモジュールBの機能を直接呼ぶ場合、BのFacadeインターフェースを通じて同期的に呼び出す。

### 4.2 非同期通信（ドメインイベント）

モジュール間の緩い結合にはドメインイベントを使用。EventBusはin-processの同期的pub/subで実装。

### 4.3 イベントフロー一覧

| イベント | 発行元 | 購読先 | タイミング |
|---------|--------|--------|----------|
| auth.user_registered | auth | (将来) analytics | ユーザー登録完了時 |
| room.created | room | notification | Room作成時 |
| room.participant_joined | room | translation | 参加者入室時 |
| room.participant_left | room | translation | 参加者退室時 |
| translation.started | translation | transcript | 翻訳セッション開始時 |
| translation.ended | translation | billing, transcript | 翻訳セッション終了時 |

---

## 5. 翻訳パイプライン詳細設計

### 5.1 Translation Agent の動作フロー

1. LiveKit Room に bot参加者として接続
2. Room内の全参加者の Audio Track を Subscribe
3. 各参加者ごとに翻訳セッション判定（言語が異なる場合のみ開始）
4. 翻訳セッションごとに:
   a. Audio TrackからAudioFrame (PCM 16kHz mono) を取得
   b. GPT-RT-Translate WebSocketに送信
   c. 翻訳済み音声 + テキストを受信
   d. 翻訳済み音声を新しいAudio Trackとして Room に Publish
   e. テキストを transcript モジュールに送信
5. 参加者退室時にセッション終了、利用量イベント発行

### 5.2 GPT-RT-Translate WebSocket接続

- URL: wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
- 認証: Authorization: Bearer OPENAI_API_KEY
- 入力: クライアントがオーディオをストリームし続ける
- 出力: サービスが翻訳音声とトランスクリプトのデルタを返し続ける

### 5.3 1対1通話時のTrack構成

```
Room: "room-abc-123"
├── Participant A (JA) → Audio Track "mic-a"
├── Participant B (EN) → Audio Track "mic-b"
└── Translation Agent (bot)
    ├── Subscribe "mic-a" → GPT-RT-Translate(JA→EN) → Publish "trans-a-to-en"
    └── Subscribe "mic-b" → GPT-RT-Translate(EN→JA) → Publish "trans-b-to-ja"
```

クライアント側: Participant Aは "trans-b-to-ja" のみSubscribe。原音 "mic-b" はSubscribeしない。

### 5.4 グループ通話時のスケーリング（Phase 2）

N人×M言語で最大 N×(M-1) セッション。同じ入力→出力の翻訳は1セッションで共有し出力Trackを複数参加者にSubscribeさせて最適化。

---

## 6. データベース設計

### 6.1 スキーマ分割方針

各モジュールは自身のスキーマ（namespace）を所有。物理的には同一のSupabaseインスタンス内。

### 6.2 主要テーブル

#### trancall_auth.profiles

| カラム | 型 | 備考 |
|--------|-----|------|
| user_id | UUID PK | = Supabase auth.users.id |
| trancall_id | VARCHAR UNIQUE | @username形式 |
| display_name | VARCHAR(50) | |
| avatar_url | TEXT NULLABLE | |
| native_language | VARCHAR(10) | OutputLanguage enum |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### trancall_room.rooms

| カラム | 型 | 備考 |
|--------|-----|------|
| room_id | UUID PK | |
| status | VARCHAR | waiting / active / ended |
| room_type | VARCHAR | audio / video |
| translation_on | BOOLEAN | |
| created_by | UUID FK | → profiles |
| created_at | TIMESTAMPTZ | |
| ended_at | TIMESTAMPTZ NULLABLE | |

#### trancall_room.participants

| カラム | 型 | 備考 |
|--------|-----|------|
| id | UUID PK | |
| room_id | UUID FK | → rooms |
| user_id | UUID FK | → profiles |
| role | VARCHAR | host / member |
| is_muted | BOOLEAN | |
| joined_at | TIMESTAMPTZ | |
| left_at | TIMESTAMPTZ NULLABLE | |

#### trancall_contact.contacts

| カラム | 型 | 備考 |
|--------|-----|------|
| id | UUID PK | |
| user_id | UUID FK | → profiles |
| contact_user_id | UUID FK | → profiles |
| is_favorite | BOOLEAN | |
| added_at | TIMESTAMPTZ | |

UNIQUE制約: (user_id, contact_user_id)

#### trancall_billing.subscriptions

| カラム | 型 | 備考 |
|--------|-----|------|
| id | UUID PK | |
| user_id | UUID FK UNIQUE | → profiles |
| plan_tier | VARCHAR | free/light/standard/business |
| stripe_customer_id | VARCHAR NULLABLE | |
| stripe_subscription_id | VARCHAR NULLABLE | |
| current_period_start | TIMESTAMPTZ | |
| current_period_end | TIMESTAMPTZ | |

#### trancall_billing.usage_records

| カラム | 型 | 備考 |
|--------|-----|------|
| id | UUID PK | |
| user_id | UUID FK | → profiles |
| session_id | UUID | |
| room_id | UUID | |
| duration_seconds | INTEGER | |
| cost_yen | DECIMAL(10,2) | |
| recorded_at | TIMESTAMPTZ | |

#### trancall_transcript.segments

| カラム | 型 | 備考 |
|--------|-----|------|
| id | UUID PK | |
| room_id | UUID FK | → rooms |
| participant_id | UUID | |
| speaker_name | VARCHAR | |
| original_text | TEXT | |
| translated_text | TEXT NULLABLE | |
| language | VARCHAR | |
| start_time_ms | INTEGER | 通話開始からのms |
| end_time_ms | INTEGER | |
| is_final | BOOLEAN | |

### 6.3 Row Level Security (RLS)

全テーブルにRLSを適用。profiles: 自分のみ読み書き可（他は表示名等のみ参照可）。rooms/participants: 参加者のみ。contacts: 自分のみ。subscriptions/usage_records: 自分のみ。segments: 自分が参加したRoomのみ。

---

## 7. API設計

### 7.1 エンドポイント一覧（Phase 1）

| メソッド | パス | モジュール | 概要 |
|---------|------|----------|------|
| POST | /api/auth/signup | auth | ユーザー登録 |
| POST | /api/auth/signin | auth | ログイン |
| GET | /api/auth/profile | auth | プロフィール取得 |
| PATCH | /api/auth/profile | auth | プロフィール更新 |
| GET | /api/contacts | contact | 連絡先一覧 |
| POST | /api/contacts | contact | 連絡先追加 |
| DELETE | /api/contacts/:id | contact | 連絡先削除 |
| GET | /api/contacts/search | contact | ユーザー検索 |
| POST | /api/contacts/invite-link | contact | 招待リンク生成 |
| POST | /api/rooms | room | Room作成 |
| GET | /api/rooms/:id | room | Room状態取得 |
| POST | /api/rooms/:id/join | room | Room参加 |
| POST | /api/rooms/:id/leave | room | Room退出 |
| GET | /api/rooms/history | room | 通話履歴 |
| POST | /api/rooms/:id/token | signaling | LiveKit Token取得 |
| GET | /api/billing/subscription | billing | プラン取得 |
| POST | /api/billing/checkout | billing | Stripeチェックアウト |
| POST | /api/billing/webhook/stripe | billing | Stripe Webhook |
| POST | /api/billing/webhook/apple | billing | Apple IAP Webhook |
| POST | /api/billing/webhook/google | billing | Google Play Webhook |
| GET | /api/transcripts/:roomId | transcript | トランスクリプト取得 |
| GET | /api/transcripts/:roomId/export | transcript | エクスポート |
| POST | /api/notifications/register | notification | デバイストークン登録 |

### 7.2 リアルタイム通信

- WebRTC (LiveKit): 音声メディアの送受信
- WebSocket (Supabase Realtime): 字幕配信、Room状態変更通知

---

## 8. クライアントアーキテクチャ（apps/mobile）

### 8.1 状態管理

- AuthStore (Zustand): ログイン状態、プロフィール
- CallStore (Zustand): 通話中状態、Room情報
- SettingsStore (Zustand): 翻訳設定、通知設定
- Data Fetching: TanStack Query（APIキャッシュ）
- Real-time: LiveKit RN SDK + Supabase Realtime

### 8.2 Navigator構造

```
RootNavigator
├── AuthStack (未ログイン時)
│   ├── SCR-001 Onboarding
│   ├── SignUp / SignIn
└── MainTabs (ログイン後)
    ├── RecentTab → SCR-002, 009, 010, 003, 011, 012
    ├── ContactsTab → SCR-005, 007, 008
    ├── CallTab → Quick dial
    └── SettingsTab → SCR-006
Overlay: SCR-004 Incoming call
```

---

## 9. セキュリティ設計

### 9.1 通信暗号化

| 区間 | 暗号化 |
|------|--------|
| クライアント ↔ API | TLS 1.3 |
| クライアント ↔ LiveKit | DTLS + SRTP |
| Agent ↔ OpenAI | TLS 1.3 |
| API ↔ Supabase | TLS 1.3 |

### 9.2 APIキー管理

- OpenAI API Key: Translation Agent環境変数（クライアント露出不可）
- LiveKit API Key/Secret: APIサーバー環境変数（クライアント露出不可）
- Supabase anon key: クライアント埋め込み可（RLSで保護）
- Stripe Secret Key: APIサーバー環境変数のみ

---

## 10. CI/CD

### 10.1 パイプライン

push to main → Lint + Type Check → Unit Test → Build → Deploy

### 10.2 ブランチ戦略

- main: 本番デプロイ対象
- develop: 開発統合ブランチ
- feat/*: 機能開発
- fix/*: バグ修正
- docs/*: ドキュメント

---


---

## 追記: 設計レビュー対応（2026-05-11）

以下の設計変更をレビュー指摘に基づき適用済み。詳細は `docs/review-responses.md` を参照。

### モジュール変更

- signalingモジュールを廃止し `media/adapters/livekit` に統合（M-001）
- モジュール数: 11 → 10

### Agent-Server通信（C-001）

Translation Agent → APIサーバー間にHTTP内部APIを追加:
- `POST /internal/translation/events`（署名付きAgent token、idempotency key）
- Agent側にoutboxパターン実装
- in-process EventBusはServer内モジュール間のみに限定

### 課金計測（M-010）

heartbeat方式に変更:
- 通話開始時: minute reservation（残量からロック）
- 通話中: 30秒ごとにheartbeat usage送信
- 通話終了時: reconcile（最終利用量確定）
- 冪等化: `session_id + window_start`

### 翻訳fallback（M-003）

翻訳失敗・遅延時のfallback仕様を追加:
- 原音を小音量（20%）で同時再生
- ワンタップで原音100%に切替
- 字幕のみ継続モード
- 翻訳再接続中インジケータ

### Transcript保存ポリシー（C-005）

- デフォルト保存、通話の両参加者が閲覧可能
- 保持期間: Free=7日 / Light=30日 / Standard=90日 / Business=1年
- segmentsテーブルに `retention_until`, `deleted_at`, `consent_version` 追加
- 保持期間超過分は日次バッチで物理削除
- 初回通話前に同意画面表示

### Zodバリデーション適用範囲（M-006）

- API input, DB row, external event, session config → Zodバリデーション
- AudioFrame（hot path） → 内部TypeScript型 + dev-only assertion
- adapters/* と schemas/brand.ts のみ型アサーション例外許可（M-007）

### Phase構成変更（C-004）

Phase 1a（MVP Core、技術検証を内包）→ Phase 1b（バックグラウンド着信）→ Phase 1c（ストア公開）に再構成。Phase 0（独立PoC）は設けない。翻訳パイプライン構築がそのままPoCになるため、独立フェーズにする意義が薄い。詳細は requirements.md を参照。

## 付録: 技術選定比較

### SFU

| 候補 | 判定 | 理由 |
|------|------|------|
| LiveKit | 採用 | RN SDK公式、Agent Framework、OSS |
| Twilio | 不採用 | 高コスト、Agent相当機能なし |
| mediasoup | 不採用 | RN SDK未公式 |

### 状態管理

| 候補 | 判定 | 理由 |
|------|------|------|
| Zustand | 採用 | 軽量、TS親和性高 |
| Redux Toolkit | 不採用 | ボイラープレート過多 |

### DB

| 候補 | 判定 | 理由 |
|------|------|------|
| Supabase | 採用 | Auth統合、RLS、Realtime |
| Firebase | 不採用 | NoSQL、複雑クエリ困難 |
