# TranCall 要件定義書

| 項目 | 内容 |
|------|------|
| ドキュメントID | REQ-001 |
| バージョン | 1.0.0 |
| 作成日 | 2026-05-11 |
| ステータス | ドラフト |
| 作成者 | 堀大輔 / Claude |

---

## 1. プロダクト概要

### 1.1 プロダクト名

TranCall（トランコール）

### 1.2 ビジョン

「すべての通話を、自分の言語で。」

TranCallは、GPT-Realtime-Translateを活用したリアルタイム翻訳付きVoIP通話アプリケーションである。ユーザーは自分のネイティブ言語で話し、相手には相手の言語に翻訳された音声が届く。言語の壁を意識せずに、世界中の誰とでも自然に会話できるプラットフォームを目指す。

### 1.3 ターゲットユーザー

- 国際的なビジネスコミュニケーションを行う個人・法人
- 異言語の家族・友人と定期的に通話するユーザー
- 海外旅行・出張で現地との電話が必要なユーザー
- 語学学習の実践の場を求めるユーザー

### 1.4 対応プラットフォーム

| プラットフォーム | 技術 | Phase |
|-----------------|------|-------|
| iOS / iPadOS | React Native + Expo + LiveKit RN SDK | Phase 1 |
| Android | React Native + Expo + LiveKit RN SDK | Phase 1 |
| macOS | Electron + LiveKit JS SDK | Phase 3 |
| Windows | Electron + LiveKit JS SDK | Phase 3 |

### 1.5 対応言語（翻訳）

GPT-Realtime-Translateの仕様に準拠する。

- 入力言語: 70以上（自動検出対応）
- 出力言語: 13言語 — en, es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it

### 1.6 対応言語（UI）

i18nによるUI多言語化。Phase 1では以下の3言語から開始し、順次追加する。

- 日本語（ja）
- 英語（en）
- 中国語簡体字（zh）

---

## 2. フェーズ定義

### Phase 1 — MVP（最小実行可能プロダクト）

- 1対1音声通話
- リアルタイム双方向翻訳（GPT-Realtime-Translate）
- リアルタイム字幕表示（原文 + 翻訳文）
- 通話後トランスクリプト保存・閲覧・エクスポート
- ユーザー登録・認証（Supabase Auth）
- 連絡先管理（追加・検索・QRコード・招待リンク）
- VoIP Push通知（iOS: APNs / Android: FCM）
- 課金（Stripe + App Store IAP + Google Play IAP）
- iOS / Android リリース

### Phase 2 — 拡張

- グループ通話（N対N、最大50人）
- ビデオ通話
- テキストメッセージ（チャット）
- WeChat小程序対応（TRTC Adapter）
- LINE LIFF対応（WebRTC Adapter）

### Phase 3 — デスクトップ

- macOSアプリ（Electron）
- Windowsアプリ（Electron）
- デスクトップ固有のUX最適化

### Phase 4 — エンタープライズ

- 管理者ダッシュボード
- チーム課金
- 翻訳用語集（カスタム辞書）
- SSO（SAML / OIDC）
- 通話録音・コンプライアンス対応

---

## 3. 機能要件（Phase 1）

### 3.1 認証・ユーザー管理（Auth モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| AUTH-001 | メールアドレス + パスワードでアカウント作成ができる | Must |
| AUTH-002 | ログイン・ログアウトができる | Must |
| AUTH-003 | 登録時にネイティブ言語（13言語から選択）を設定できる | Must |
| AUTH-004 | プロフィール（表示名、アバター、ネイティブ言語）を編集できる | Must |
| AUTH-005 | TranCall ID（ユニークID）が自動生成される | Must |
| AUTH-006 | Googleアカウントでのソーシャルログインができる | Should |
| AUTH-007 | Apple IDでのソーシャルログインができる | Should |
| AUTH-008 | パスワードリセットができる | Must |

### 3.2 連絡先管理（Contact モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| CONTACT-001 | TranCall IDまたは名前で他ユーザーを検索できる | Must |
| CONTACT-002 | QRコードスキャンで連絡先を追加できる | Must |
| CONTACT-003 | 招待リンクを生成・共有して未登録ユーザーを招待できる | Must |
| CONTACT-004 | 端末の連絡先からインポートできる | Should |
| CONTACT-005 | 連絡先をお気に入りに登録できる | Must |
| CONTACT-006 | 連絡先ごとの通話履歴（日時、時間、コスト）を閲覧できる | Must |
| CONTACT-007 | 連絡先を削除できる | Must |
| CONTACT-008 | 自分のQRコードを表示できる | Must |

### 3.3 通話管理（Room モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| ROOM-001 | 連絡先を選択して1対1音声通話を開始できる | Must |
| ROOM-002 | 通話開始前に翻訳設定（ON/OFF、言語ペア、音声、字幕）を確認・変更できる | Must |
| ROOM-003 | 通話開始前にコスト見積もりが表示される | Must |
| ROOM-004 | 着信を受ける/拒否できる | Must |
| ROOM-005 | 通話中にミュート/アンミュートできる | Must |
| ROOM-006 | 通話中にスピーカー切替ができる | Must |
| ROOM-007 | 通話中に翻訳のON/OFFを切替できる | Should |
| ROOM-008 | 通話を終了できる | Must |
| ROOM-009 | 最近の通話履歴を一覧表示できる（発信/着信/不在表示） | Must |
| ROOM-010 | 通話履歴から直接再発信できる | Must |

### 3.4 リアルタイム翻訳（Translation モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| TRANS-001 | 通話中に双方向リアルタイム音声翻訳が行われる | Must |
| TRANS-002 | 翻訳はGPT-Realtime-Translate APIを使用する | Must |
| TRANS-003 | 翻訳セッションは参加者ごと・言語方向ごとに独立して管理される | Must |
| TRANS-004 | 翻訳音声のボイスを選択できる（12種: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, cedar, marin） | Should |
| TRANS-005 | 翻訳なし（同じ言語同士）の通話もできる | Must |
| TRANS-006 | 翻訳の遅延は体感2秒以内を目標とする | Must |

### 3.5 字幕・トランスクリプト（Transcript モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| SCRIPT-001 | 通話中にリアルタイム字幕（原文 + 翻訳文）が表示される | Must |
| SCRIPT-002 | 字幕表示のON/OFFを切替できる | Must |
| SCRIPT-003 | 通話終了後にトランスクリプト全文を閲覧できる | Must |
| SCRIPT-004 | トランスクリプト内を全文検索できる | Must |
| SCRIPT-005 | 表示モードを切替できる（Both / Original only / Translation only） | Must |
| SCRIPT-006 | トランスクリプトをPDF/TXTでエクスポートできる | Must |
| SCRIPT-007 | トランスクリプトを共有できる | Should |
| SCRIPT-008 | 各セグメントにタイムスタンプが付与される | Must |

### 3.6 メディア・通信基盤（Media モジュール + Signaling モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| MEDIA-001 | SFUはLiveKitを使用する | Must |
| MEDIA-002 | Transport Adapterパターンで実装し、将来のSFU差し替えに対応する | Must |
| MEDIA-003 | 音声フォーマットはPCM 16kHz モノラルを基本とする | Must |
| MEDIA-004 | WebRTCによるP2P〜SFU間の音声転送が行われる | Must |
| MEDIA-005 | LiveKit Agent FrameworkでTranslation Agentをサーバー側に配置する | Must |
| MEDIA-006 | 翻訳済み音声は独立したTrackとしてPublishされ、対象参加者のみがSubscribeする | Must |

### 3.7 課金（Billing モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| BILL-001 | 翻訳通話の利用量を分単位でトラッキングする | Must |
| BILL-002 | 翻訳なし通話は課金対象外とする | Must |
| BILL-003 | サブスクリプションプランを提供する | Must |
| BILL-004 | プラン超過分は従量課金とする | Must |
| BILL-005 | iOS App Store In-App Purchaseに対応する | Must |
| BILL-006 | Google Play In-App Purchaseに対応する | Must |
| BILL-007 | Webからの直接課金はStripeを使用する | Must |
| BILL-008 | 通話開始前に残り分数とコスト見積もりを表示する | Must |
| BILL-009 | 残り分数が0の場合、翻訳通話を開始できない（通知あり） | Must |
| BILL-010 | 通話終了後にコストサマリーを表示する | Must |

プラン構成（案）:

| プラン | 月額 | 含む翻訳通話分数 | 超過料金/分 |
|--------|------|-----------------|------------|
| Free | 0 yen | 5 min（お試し） | 利用不可 |
| Light | 980 yen | 60 min | 30 yen |
| Standard | 2,980 yen | 300 min | 25 yen |
| Business | 9,800 yen | 1,200 min | 20 yen |

### 3.8 プッシュ通知（Notification モジュール）

| ID | 要件 | 優先度 |
|----|------|--------|
| NOTIF-001 | 着信時にVoIP Push通知を受信できる（iOS: APNs VoIP Push） | Must |
| NOTIF-002 | 着信時にFCM通知を受信できる（Android） | Must |
| NOTIF-003 | iOS着信時にCallKitの標準着信UIが表示される | Must |
| NOTIF-004 | Android着信時にConnectionServiceの着信UIが表示される | Must |
| NOTIF-005 | アプリがkill状態でも着信通知を受信できる | Must |
| NOTIF-006 | 不在着信の通知が残る | Must |

---

## 4. 非機能要件

### 4.1 パフォーマンス

| ID | 要件 | 目標値 |
|----|------|--------|
| PERF-001 | 通話開始までの接続時間 | 3秒以内 |
| PERF-002 | 翻訳遅延（発話終了→翻訳音声開始） | 2秒以内 |
| PERF-003 | 音声品質 | MOS 3.5以上 |
| PERF-004 | アプリ起動時間 | 2秒以内 |

### 4.2 可用性

| ID | 要件 | 目標値 |
|----|------|--------|
| AVAIL-001 | サービス稼働率 | 99.9% |
| AVAIL-002 | 通話ドロップ率 | 1%未満 |

### 4.3 セキュリティ

| ID | 要件 |
|----|------|
| SEC-001 | 通話音声はWebRTC（SRTP）で暗号化される |
| SEC-002 | 認証トークンはJWTで管理し、有効期限を設ける |
| SEC-003 | 翻訳API通信はTLS 1.3で暗号化される |
| SEC-004 | パスワードはサーバー側でハッシュ化して保存される（Supabase Authに委譲） |
| SEC-005 | トランスクリプトはユーザー本人のみがアクセスできる（RLS） |
| SEC-006 | OpenAI APIキーはクライアントに露出しない（サーバー側のみ） |

### 4.4 スケーラビリティ

| ID | 要件 |
|----|------|
| SCALE-001 | LiveKit SFUは水平スケール可能な構成とする |
| SCALE-002 | Translation Agentはステートレスで水平スケール可能とする |
| SCALE-003 | Phase 2のグループ通話（最大50人）に対応できる設計とする |

---

## 5. 画面一覧

### 5.1 Phase 1 画面（全12画面）

| 画面ID | 画面名 | 概要 |
|--------|--------|------|
| SCR-001 | Onboarding | 初回起動時の言語選択（13言語） |
| SCR-002 | Home (Recent) | 最近の通話一覧、検索 |
| SCR-003 | In-call | 通話中画面（翻訳字幕、ミュート、スピーカー、終話） |
| SCR-004 | Incoming call | 着信画面（応答/拒否、翻訳言語ペア表示、コスト表示） |
| SCR-005 | Contacts | 連絡先一覧（お気に入り、全連絡先） |
| SCR-006 | Settings | 設定（プロフィール、翻訳設定、プラン、通知、アプリ情報） |
| SCR-007 | Add contact | 連絡先追加（ID検索、QRスキャン、招待リンク、端末インポート） |
| SCR-008 | Contact profile | 連絡先詳細（通話履歴、アクション、削除） |
| SCR-009 | Pre-call setup | 通話前設定（翻訳ON/OFF、言語ペア、ボイス、字幕、コスト見積もり） |
| SCR-010 | Calling (ringing) | 発信中画面（リンギング、キャンセル） |
| SCR-011 | Call summary | 通話終了後サマリー（時間、コスト、残り分数、トランスクリプト概要） |
| SCR-012 | Full transcript | トランスクリプト全文（検索、フィルタ、タイムスタンプ、エクスポート） |

### 5.2 画面遷移

```
SCR-001 Onboarding
  └→ SCR-002 Home (Recent)
       ├→ SCR-005 Contacts
       │    ├→ SCR-007 Add contact → SCR-005
       │    └→ SCR-008 Contact profile
       │         ├→ SCR-009 Pre-call setup
       │         │    └→ SCR-010 Calling (ringing)
       │         │         └→ SCR-003 In-call
       │         │              └→ SCR-011 Call summary
       │         │                   ├→ SCR-012 Full transcript
       │         │                   ├→ SCR-010 Call again
       │         │                   └→ SCR-002 Back to home
       │         └→ SCR-003 In-call（直接発信）
       ├→ SCR-004 Incoming call
       │    ├→ SCR-003 In-call（応答）
       │    └→ SCR-002 Home（拒否）
       ├→ SCR-006 Settings
       └→ SCR-010 Calling（履歴から再発信）
```

---

## 6. アーキテクチャ概要

### 6.1 アーキテクチャスタイル

モジュラーモノリス（Modular Monolith）

各モジュールはドメイン境界で分割され、Zodスキーマで定義されたPublic APIのみを通じて通信する。モジュール内部の実装は外部から隠蔽される。

### 6.2 モジュール一覧

| モジュール | 責務 | Phase 1 | Phase 2 再利用 |
|-----------|------|---------|---------------|
| shared-kernel | Event Bus, DI, 共通型, Branded Types | ✅ | そのまま |
| auth | 認証, ユーザー管理, プロフィール | ✅ | OAuth provider追加のみ |
| room | 通話セッションのライフサイクル管理 | ✅ | 参加者上限解放のみ |
| signaling | LiveKit Token発行, Room参加/退出 | ✅ | そのまま |
| media | 音声トラックのPublish/Subscribe抽象化 | ✅ | VideoモジュールがMediaTrackを継承 |
| translation | GPT-RT-Translate WebSocket接続, 翻訳セッション管理 | ✅ | 100%再利用 |
| billing | Stripe + IAP, 利用量トラッキング | ✅ | メータリング拡張のみ |
| contact | 連絡先管理, 検索, 招待 | ✅ | WeChat/LINE ID紐付け追加 |
| notification | VoIP Push (APNs) + FCM | ✅ | WeChat/LINE通知追加 |
| transcript | 文字起こし + 字幕表示 + エクスポート | ✅ | そのまま |
| ui-kit | 共通UIコンポーネント | ✅ | そのまま |

### 6.3 Transport Adapterパターン

```
TransportPort (interface)
  ├── LiveKitAdapter    ← Phase 1 実装
  ├── TRTCAdapter       ← Phase 2 WeChat対応時に追加
  └── SIPAdapter        ← 将来の電話網対応時に追加
```

### 6.4 翻訳パイプラインアーキテクチャ

```
ユーザーA (JA) ──音声──→ LiveKit SFU ──→ Translation Agent
                                              │
                                    GPT-RT-Translate (JA→EN)
                                              │
                              翻訳済み音声Track ──→ ユーザーB (EN)

ユーザーB (EN) ──音声──→ LiveKit SFU ──→ Translation Agent
                                              │
                                    GPT-RT-Translate (EN→JA)
                                              │
                              翻訳済み音声Track ──→ ユーザーA (JA)
```

### 6.5 技術スタック

| レイヤー | 技術 |
|---------|------|
| モバイルアプリ | React Native + Expo |
| デスクトップアプリ | Electron (Phase 3) |
| WebRTC SFU | LiveKit (セルフホスト or LiveKit Cloud) |
| 翻訳エンジン | OpenAI GPT-Realtime-Translate |
| Translation Agent | LiveKit Agent Framework (TypeScript) |
| APIサーバー | Node.js (TypeScript) |
| データベース | Supabase (PostgreSQL) |
| 認証 | Supabase Auth |
| 課金 | Stripe + iOS IAP + Google Play IAP |
| プッシュ通知 | APNs (VoIP Push) + FCM |
| i18n | i18next + react-i18next + expo-localization |
| スキーマバリデーション | Zod v4 |
| monorepo管理 | Turborepo |
| CI/CD | GitHub Actions |
| ホスティング | Vercel (API) + セルフホスト (LiveKit) |

### 6.6 型安全性ポリシー

- すべてのモジュール境界はZodスキーマで定義する
- `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error` は全面禁止
- ESLint `@typescript-eslint/consistent-type-assertions` を `assertionStyle: "never"` で設定
- TSConfig: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- 例外をthrowする代わりにResult型（discriminated union）を使用する
- 外部入力はすべてZod `safeParse()` でバリデーションする

---

## 7. コスト構造

### 7.1 翻訳コスト（OpenAI）

| 項目 | 単価 |
|------|------|
| GPT-Realtime-Translate | $0.034/分 |
| 1対1双方向（2セッション） | $0.068/分 ≒ 10円/分 |

### 7.2 インフラコスト（見積）

| 項目 | コスト/分 |
|------|----------|
| LiveKit SFU (セルフホスト) | ≒1〜2円 |
| サーバー + 帯域 | ≒1〜2円 |
| 合計原価 | ≒12〜14円/分 |

### 7.3 課金モデル

Apple/Google の30%プラットフォーム手数料を考慮した価格設定:

| プラン | 月額(税込) | 翻訳分数 | 超過/分 | 原価率(目安) |
|--------|----------|---------|---------|------------|
| Free | 0 yen | 5 min | 利用不可 | - |
| Light | 980 yen | 60 min | 30 yen | ~88% |
| Standard | 2,980 yen | 300 min | 25 yen | ~70% |
| Business | 9,800 yen | 1,200 min | 20 yen | ~58% |

---

## 8. リスクと制約

| ID | リスク | 影響度 | 対策 |
|----|--------|--------|------|
| RISK-001 | GPT-RT-Translate APIの遅延増大 | 高 | 翻訳品質モニタリング、フォールバック（翻訳OFFで通常通話） |
| RISK-002 | OpenAI API料金改定 | 高 | 課金プランの定期見直し、マージン確保 |
| RISK-003 | App Store/Play Store審査リジェクト | 中 | VoIPアプリの審査ガイドライン事前確認、CallKit/ConnectionService準拠 |
| RISK-004 | LiveKit SFUの障害 | 高 | ヘルスチェック、自動フェイルオーバー、LiveKit Cloud併用検討 |
| RISK-005 | 他アプリ通話（LINE等）への直接統合不可 | 低 | 独自VoIPアプリとして完結する設計。将来のAPI開放に備えモジュール化 |
| RISK-006 | iOS/Androidの録音通知制約 | 低 | 通話録音は行わない。トランスクリプトはリアルタイム文字起こしのみ |

---

## 9. 用語集

| 用語 | 定義 |
|------|------|
| SFU | Selective Forwarding Unit。メディアサーバーの一種で、各参加者のメディアストリームを選択的に転送する |
| GPT-RT-Translate | OpenAI GPT-Realtime-Translate。音声入力を別言語の音声に変換するリアルタイム翻訳API |
| Transport Adapter | メディアサーバー接続の抽象化レイヤー。LiveKit/TRTC/SIP等を差し替え可能にするインターフェース |
| Translation Agent | LiveKit Agent Frameworkで実装されるサーバーサイドボット。Roomに参加し、音声トラックを取得→翻訳→再Publishする |
| Branded Type | Zodの `.brand<>()` で作成される型。同じプリミティブ（string等）でも意味的に区別される（例: UserId, RoomId） |
| Result型 | `{ ok: true, data: T } | { ok: false, error: E }` のdiscriminated union。例外throwの代わりに使用する |
| VoIP Push | Voice over IP用のプッシュ通知。iOS APNsのVoIP証明書を使用し、アプリkill状態でも着信通知を表示できる |
| TRTC | Tencent Real-Time Communication。WeChat小程序の音声ビデオ機能の基盤 |
| LIFF | LINE Front-end Framework。LINE内でWebアプリを動かすフレームワーク |

---

## 10. 承認

| 役割 | 氏名 | 日付 | 承認 |
|------|------|------|------|
| プロダクトオーナー | 堀大輔 | | |
| テクニカルリード | | | |

---

## 付録A: 関連ドキュメント

| ドキュメント | パス | 概要 |
|-------------|------|------|
| アーキテクチャ設計書 | `docs/architecture.md` | モジュラーモノリス詳細設計 |
| Zodスキーマ定義 | `docs/schemas.ts` | 全モジュールのZodスキーマリファレンス |
| デザインシステム | `docs/design/README.md` | Claude Design テンプレート、トークン、コンポーネント定義 |
| 各モジュール設計書 | `packages/*/docs/design.md` | モジュール別詳細設計 |
| 各モジュールCLAUDE.md | `packages/*/CLAUDE.md` | Claude Code開発用コンテキスト |

## 付録B: API仕様参照

- OpenAI Realtime Translation API: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- LiveKit Server SDK: https://docs.livekit.io/
- LiveKit Agent Framework: https://docs.livekit.io/agents/
- Supabase Auth: https://supabase.com/docs/guides/auth
- Stripe Billing: https://stripe.com/docs/billing
