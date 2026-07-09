## 引き継ぎメモ (2026-07-09時点)

### プロジェクト概要
- リポジトリ: /Users/horidaisuke/trancall (GitHub: DaisukeHori/trancall)
- GPT-Realtime-Translateを使ったリアルタイム翻訳付きVoIPアプリ。モジュラーモノリス (10 packages + 4 apps: mobile/desktop/server/translation-agent)
- 詳細はルートCLAUDE.mdおよびdocs/architecture.md, docs/module-contracts.md (canonical) を参照

### 今回のセッションでやったこと
1. `git pull` → ローカルmainがorigin/mainより97コミット先行していたのを確認
2. Fableサブエージェント5体を並列起動し、以下を監査:
   - 既知課題 (docs/sprint3-known-issues.md §2.1〜2.19) の実コード突合
   - server/認証/課金 (routes, middleware, adapters, supabase migrations)
   - mobile/ネイティブ (plugins, ios/android手動配置ファイル, デザインシステム準拠)
   - リアルタイム系 (room/signaling/media/translation/transcript, translation-agent, EventBus)
   - typecheck/lint/testの実測 (test 1444/1444 PASS, typecheck 2 package FAIL, lint 7 package FAIL 1188件)
3. 見つかった問題を **GitHub Issue #39〜#74 (36件)** として登録。各Issueに症状/原因(file:line)/再現シナリオ/対処方針を記載済み
4. 97コミットをorigin/mainにpush済み (HEAD: d207a20、fast-forward、force不使用)

### 現在の状態
- リモートは最新。ローカル未コミット差分: `apps/server/.gitignore`と`supabase/.temp/*`のuntrackedファイルのみ (Issue #74で追跡中)
- テストは全PASSだが、**typecheckとlintは赤** (詳細はIssue #59, #73)
- 決済フロー・通話パイプラインは重大バグにより実質機能不全 (下記CRITICAL参照)

### 最優先で着手すべきIssue (推奨順)

#### まず着手 (レバレッジが高い/前提条件になっているもの)
- **#59** native-modules.d.tsの1行修正でtypecheck 290件+lint 1106件が解消する見込み (最優先、着手コスト最小)
- **#58** registerRootComponent欠落でアプリ起動時クラッシュ (1行修正)
- **#55** Config Pluginの@expo/config-plugins import修正 (1行修正、iOSの.npmrc hoistingも同Issue内に記載)
- **#67** translation/billingドメインイベントがEventBus未配線 → これが#46(利用量計測)の前提条件

#### 決済フロー (ほぼ全滅、事業影響大)
#39 Stripe webhook署名検証失敗 → #40 IAP検証なしで決済偽造可能 → #41 解約がStripeに伝わらない → #42 updatePlanのResultエラー握り潰し (他Issueの根本原因) → #44 External Purchase検証なし → #46 利用量計測未配線 → #47 新規ユーザーprovisioning経路なし

#### 通話パイプライン (音声翻訳は動くが周辺機能が断線)
#48 transcript永続化されない → #51 Data Channel topic不一致で字幕/ステータスUI未達 → #52 着信Push検証失敗で誰にも届かない → #53 予約sessionId不一致でユーザー残高ロック → #43 room token/leave/getのなりすまし・DoS認可バイパス

#### モバイルビルド基盤 (そもそもビルドできない)
#54 Expo/RNバージョン不整合 → #56 ネイティブファイルがビルド経路未接続 → #57 VoIP Push payload不一致 (Apple規約違反リスクあり) → #68 CallStack未接続で発着信UI到達不能

#### HIGH級 (#60〜#66)
Apple webhook冪等キー超過/署名検証なし、Stripeライフサイクル未処理、Internal HMAC再シリアライズ、profiles RLS全公開、退会非原子的、サポート問い合わせXSS

#### MEDIUM/LOW (チェックリスト形式、#69〜#74)
Realtime運用品質、Mobile native残務、デザインシステム/i18n、コーディング規約違反、lint/typecheck残務、リポジトリ衛生 (未push確認/stale worktree37個等)

### 注意点
- `docs/sprint3-known-issues.md` §2.13/§2.15は**現行コードでは解消済み**なのに記述が古いまま。このドキュメントを鵜呑みにして再修正すると改悪するので要注意 (Issue #74に記載)
- `updatePlan`のResultエラー握り潰し(#42)は複数のCRITICAL Issueの根本原因。ここを直すと#41等の診断がしやすくなる
- モバイルのcallkeep実装(#68)は設計書 (native-call-bridge.md §3.3) の「Expo Modules自前実装」方針と逆方向のコードになっている。修正前に方針再確認が必要
- サブエージェントはSonnet 5指定 (`model: "sonnet"`)。設計書・戦略文書はmodel=opus/fable直接執筆

### 参照
- 全Issue: https://github.com/DaisukeHori/trancall/issues (#39〜#74)
- 既知課題: docs/sprint3-known-issues.md
- モジュール契約: docs/module-contracts.md
- 通話ライフサイクル: docs/call-lifecycle.md
- ネイティブブリッジ設計: docs/native-call-bridge.md

---

# TranCall

**すべての通話を、自分の言語で。**

TranCallはGPT-Realtime-Translateを活用したリアルタイム翻訳付きVoIP通話アプリです。ユーザーは自分のネイティブ言語で話し、相手には相手の言語に翻訳された音声が届きます。

## 特徴

- リアルタイム双方向音声翻訳（GPT-Realtime-Translate、13出力言語対応）
- リアルタイム字幕表示（原文 + 翻訳文）
- 通話後トランスクリプト保存・検索・エクスポート（PDF/TXT）
- クロスプラットフォーム（iOS / Android、将来macOS / Windows）
- VoIP Push対応（アプリkill状態でも着信通知）

## 対応言語

**入力**: 70以上（自動検出対応）

**出力**: English, Español, Português, Français, 日本語, Русский, 中文, Deutsch, 한국어, हिन्दी, Bahasa Indonesia, Tiếng Việt, Italiano


## 差別化（2026年5月時点）

Apple Phone Live Translation（iOS 26〜）との比較:

| | TranCall | Apple純正 |
|---|---|---|
| 対応端末 | **全iOS + 全Android** | iPhone 15 Pro以降のみ |
| 通話チャネル | **VoIP（データ通信）** | **電話回線（音声通話）のみ** |
| 通話コスト | データ通信料のみ（実質ゼロ円〜数百円/月） | **国際電話料金（最大400円/分）** |
| 日本語対応（2026/5） | **入力70+ / 出力13言語** | 5言語（英米/英英/仏/独/葡/西）日本語未対応 |
| トランスクリプト | **保存・検索・エクスポート** | 保存なし（オンデバイス） |
| プライバシー | クラウド処理（同意制） | オンデバイス |
| B2B機能 | 通話ログ・監査・検索 | なし |

**Apple Phone Live Translation の制約**:
- **電話回線（音声通話）でのみ動作** — VoIPアプリ（LINE、WhatsApp、Zoom等）には適用されない。
- **国際電話料金が高い** — KDDI/NTTドコモ/ソフトバンクのスタンダードプラン国際電話料金は1分あたり数十円〜400円超（米国 約60円/分、中国 約160円/分、ベトナム 約260円/分など。発信元地域・契約プラン・割引適用有無で変動）。30分通話で1,800円〜12,000円規模になり得る。
- **日本語が未対応**（2026年5月時点、対応5言語は英国・米国英語、仏・独・葡・西）。AirPods Live Translation は EU 提供外、年内に日本語対応予定とアナウンス。
- iPhone 15 Pro 以降のみ（Apple Intelligence 必須）。

TranCallの主要ターゲット:
1. iPhone 15 Pro未満 / Android（Apple Intelligence非対応）
2. B2Bログ・トランスクリプト要件
3. VoIP経済圏（国際電話料金を避けたいユーザー）
4. 日本語を含む多言語コミュニケーション（Apple純正で未対応）

## アーキテクチャ

モジュラーモノリス + Zodスキーマによる型安全なモジュール境界

```
trancall/
├── packages/           # ドメインモジュール（10モジュール）
│   ├── shared-kernel/  # 共通型・EventBus・DI
│   ├── auth/           # 認証・ユーザー管理
│   ├── room/           # 通話セッション管理
│   ├── media/          # 音声トラック抽象化 + Transport Adapter
│   ├── translation/    # GPT-RT-Translate接続
│   ├── billing/        # 課金（Stripe + IAP）
│   ├── contact/        # 連絡先管理
│   ├── notification/   # Push通知（APNs + FCM）
│   ├── transcript/     # 字幕・文字起こし
│   └── ui-kit/         # 共通UIコンポーネント
├── apps/
│   ├── mobile/         # React Native + Expo（iOS / Android）
│   ├── desktop/        # Electron（macOS / Windows）— Phase 3
│   ├── server/         # Node.js APIサーバー
│   └── translation-agent/  # LiveKit Agent（翻訳ワーカー）
└── docs/
    ├── requirements.md     # 要件定義書
    ├── architecture.md     # アーキテクチャ設計書
    ├── schemas.ts          # Zodスキーマリファレンス
    └── design/             # ワイヤーフレーム・デザインシステム
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| モバイル | React Native + Expo |
| デスクトップ | Electron（Phase 3） |
| SFU | LiveKit |
| 翻訳エンジン | OpenAI GPT-Realtime-Translate |
| Translation Agent | LiveKit Agent Framework (TypeScript) |
| APIサーバー | Node.js (TypeScript) |
| DB / Auth | Supabase (PostgreSQL) |
| 課金 | Stripe + iOS IAP + Google Play IAP |
| Push通知 | APNs VoIP Push + FCM |
| i18n | i18next + expo-localization |
| バリデーション | Zod v4 |
| monorepo | Turborepo + pnpm |

## 開発ルール

- `as any` / `as unknown` / `@ts-ignore` 全面禁止
- 全モジュール境界はZodスキーマで定義
- 例外throwの代わりにResult型（discriminated union）を使用
- TSConfig: `strict: true`, `noUncheckedIndexedAccess: true`
- 詳細は [CLAUDE.md](./CLAUDE.md) を参照

## フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | 1対1音声通話 + 翻訳 + 課金（iOS/Android） | 設計中 |
| Phase 2 | グループ通話 + ビデオ + WeChat/LINE対応 | 計画中 |
| Phase 3 | デスクトップ（macOS / Windows） | 計画中 |
| Phase 4 | エンタープライズ（管理画面、SSO、用語集） | 計画中 |

## ドキュメント

- [要件定義書](./docs/requirements.md)
- [アーキテクチャ設計書](./docs/architecture.md)
- [Zodスキーマリファレンス](./docs/schemas.ts)
- [デザインシステム](./docs/design/README.md)
- [ワイヤーフレーム](./docs/design/wireframes/)

## Retention (データ削除) 運用

### 削除スケジュール

日次バッチは **毎日 UTC 17:00 (JST 02:00)** に実行される。  
実装: `supabase/functions/retention-cleanup/index.ts` (Supabase Edge Function)  
スケジューラ: pg_cron (`supabase/migrations/00012_schedule_retention_cron.sql`)

### 削除対象テーブルと条件

| テーブル | 削除条件 | 保持期間根拠 |
|---|---|---|
| `trancall_transcript.segments` | `retention_until < now()` | プラン別: Free=7日 / Light=30日 / Standard=90日 / Business=365日 |
| `trancall_transcript.transcript_access` | `deleted_at IS NOT NULL AND deleted_at < now() - 30d` | 退会 grace period (30日) 経過後の論理削除行 |
| `trancall_event.agent_metrics` | `collected_at < now() - 30d` | パフォーマンスメトリクスは 30 日で不要 |
| `trancall_billing.external_purchase_tokens` | `expires_at < now() - 7d` | TTL 切れ後 7 日バッファ付きで削除 |
| `trancall_billing.webhook_events` | `received_at < now() - 30d` | 処理済み webhook イベントは 30 日で削除 |
| `trancall_billing.usage_reservations` | `status IN ('reconciled','expired') AND reconciled_at < now() - 7d` | 完了後 7 日経過した reservations |
| `auth.users` (退会済み) | `profiles.deleted_at IS NOT NULL AND deleted_at < now() - 30d` | 退会 grace period (30日) 経過後の物理削除 |

### 実行記録

毎バッチ実行後、`trancall_audit.retention_runs` テーブルに記録される。  
DDL: `supabase/migrations/00011_add_retention_audit_table.sql`

```sql
-- 直近 7 日の実行記録を確認
SELECT run_id, started_at, ended_at, deletion_counts, errors
FROM   trancall_audit.retention_runs
WHERE  started_at > now() - INTERVAL '7 days'
ORDER  BY started_at DESC;
```

### モニタリング

`docs/production-runbook.md §10.3` に記載のアラートルール:

- `retention_batch_failure`: バッチが非 200 で終了 → Slack `#on-call` + メール (High)
- `retention_batch_zero_rows`: 7 日連続で全テーブルの削除件数が 0 → バッチ停止疑い

### 手動再実行

```bash
# Edge Function を直接 POST で呼び出す (service_role key が必要)
curl -X POST "https://<project-ref>.supabase.co/functions/v1/retention-cleanup" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 障害対応

`docs/production-runbook.md §14.6` を参照。  
Supabase Dashboard → Functions → retention-cleanup → Logs でログを確認し、  
`trancall_audit.retention_runs` の `errors` カラムでエラー詳細を確認する。

## ライセンス

Private — All rights reserved.
