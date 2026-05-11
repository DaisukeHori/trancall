# 第9回設計レビュー対応記録

| 項目 | 内容 |
|------|------|
| レビュー日 | 2026-05-11 |
| レビュワー | Claude (Opus 4.7) — 第8回レビューの直接対応 |
| 範囲 | Critical 3 + Major 3 + ユーザー指示によるStoreKit External Purchase採用 |

## 第8回レビューでの発見と対応

### Critical 対応

#### C-001: agent-flow.md の session.update が古い構文のまま

**発見**: 第7回レビューでOpenAI Realtime Translation の最新公式仕様への書き換えを指摘し、コミット 0352855 で「matching latest spec」とコメントされたが、`session.update` の中身のみ古い構文が残っていた（部分修正漏れ）。

**今回の対応**:
- `docs/agent-flow.md` の `session.update` ブロックを公式構造に書き換え
  - 旧: `input_language`, `output_language`, `modalities`, `input_audio_format`, `output_audio_format`, `input_audio_sample_rate`, `output_audio_sample_rate` （いずれも `/v1/realtime/translations` には存在しないパラメータ）
  - 新: `session.audio.output.language` のみ（OpenAI公式仕様）
- コメントで「inputLanguage はOpenAIに送らない（70+言語を自動検出）。内部の言語ペア判定にのみ使用」と明記

#### C-002: zh.json が ja/en の 65%しかカバーしていない

**発見**: i18n locale のキー数が ja 120 / en 120 / zh 78 で、5セクション42キーが zh から欠落。中国語UIユーザーは Settings タブを開いた瞬間に英語フォールバックになる。

**今回の対応**:
- `packages/ui-kit/src/i18n/locales/zh.json` を全面書き直し（120キー、14セクション）
- Apple中国公式用語（实时翻译・实时字幕・转写・订阅・套餐・余额）を参考に自然な簡体字訳
- 追加した5セクション: `billing`, `summary`, `transcript`, `precall`, `settings`

#### C-003: pgcrypto 拡張が migration 途中（230行目）に置かれている

**発見**: `gen_random_uuid()` を行37以降で多数使っているが、`CREATE EXTENSION IF NOT EXISTS pgcrypto;` が migration の途中（行230あたり）に置かれていた。Supabase Cloud (Postgres 15+) では gen_random_uuid() がコア組み込みなので動作するが、ローカル開発で Postgres 12 以前を使うと migration が途中で失敗する。

**今回の対応**:
- `CREATE EXTENSION IF NOT EXISTS pgcrypto;` を migration 冒頭（CREATE SCHEMA より前）に移動
- `CREATE SCHEMA IF NOT EXISTS trancall_event;` も冒頭の SCHEMA セクションに統合
- 重複定義（途中の CREATE EXTENSION pgcrypto と CREATE SCHEMA trancall_event）を削除

### Major 対応

#### M-001: LiveSubtitleDelta に translationSessionId が無い

**発見**: コミット 0352855 のメッセージで「LiveSubtitleDelta gains translationSessionId for group calls」と書かれていたが、実際の schemas.ts には反映されていないと思っていた。

**確認結果**: 実際は schemas.ts に `translationSessionId: TranslationSessionIdSchema.nullable()` として既に追加されていた。私（レビュアー）の見落としだった。`.nullable()` は Phase 1（1対1）では null 許容、Phase 2 グループ通話で必須化という発想で妥当。修正不要。

#### M-002: amount_yen 計算ロジックが billing-detail.md に明示されていない

**発見**: api-spec.md の heartbeat エンドポイント request body に amount_yen が無いのに、billing-detail.md の SQL では INSERT 文に amount_yen が含まれていた。どこで計算するかが不明瞭。

**今回の対応**:
- `docs/billing-detail.md` の「通話中: heartbeat」セクションに、サーバー側処理順序を5ステップで明示
  1. heartbeatリクエスト受信
  2. SubscriptionStateを取得
  3. amount_yen を計算（含有分・超過・跨ぎwindowの3ケース）
  4. usage_windows に冪等 INSERT
  5. shouldContinue を判定
- 跨ぎwindow（残10秒+超過20秒）の具体例も追記

#### M-003: webhook_events テーブルが migration に存在しない

**発見**: api-spec.md の Stripe / Apple / Google webhook で「idempotent by event.id」と書かれていたが、event_id を永続化して重複排除するテーブルが migration に無かった。

**今回の対応**:
- `trancall_billing.webhook_events` テーブルを migration に追加（17番目のテーブル）
- `provider` カラムで 'stripe' / 'apple_iap' / 'google_play' / 'storekit_external' を区別
- `UNIQUE (provider, external_event_id)` で冪等性保証
- BRIN index for `received_at`（append-only パターン）
- 未処理イベント検索用の partial index
- RLS は service_role のみアクセス可

#### M-007: account-deletion.md の participants 匿名化が CASCADE 設定と矛盾

**発見**: `participants.user_id NOT NULL` なのに、account-deletion.md では「user_id → null」と書かれていた。

**今回の対応**:
- `docs/account-deletion.md` の participants 行を「変更なし（user_idを維持）」に修正
- 退会時は profiles 側の display_name → "Deleted User" のみ匿名化し、participants は不変
- 履歴整合性を保つ方針

### ユーザー指示: StoreKit External Purchase 採用へ方針転換

**ユーザー指示**: 「StoreKit External Purchase はつかいます。購入チャネルは多い方がいい。」

**最新仕様の事前確認**: 日本MSCA（2025/12/18施行）の StoreKit External Purchase は、unit-economics.md に書かれていた「26%（VAT込み）」という単純化は不正確。実際は Store Services Fee 5%/10%/13% + Initial Acquisition Fee 2%（SBP対象外、初回6ヶ月のみ） + Core Technology Commission 5% + PSP fee 3-7% の層構造。実効15-23%レンジ。

**今回の対応**:

1. **`docs/unit-economics.md` を全面書き直し**:
   - 「StoreKit External Purchaseは使わない」結論を削除
   - 最新仕様（Store Services Fee + Initial Acquisition Fee + CTC + PSP の層構造）に料率表を更新
   - SBP適用時実効15%、SBP対象外実効20%の2シナリオで粗利計算
   - 「Webサブスク」(アプリ外、Stripe 3.6%)の粗利計算も追加
   - 3チャネル併設戦略に推奨を変更

2. **`docs/api-spec.md` の checkout エンドポイントを3チャネル対応に拡張**:
   - `paymentMethod`: `"iap" | "storekit_external" | "stripe_web"`
   - 各チャネルのResponse構造を明示
   - StoreKit External の `externalPurchaseToken` と `disclosureSheetRequired` フラグ
   - `POST /api/billing/storekit-external/report` エンドポイントを新設（Apple月次レポート用）
   - webhook_events.external_event_id への永続化を明記

3. **`docs/billing-detail.md` に3チャネル併設の購入フロー追加**:
   - (a) IAP: StoreKit 2 / Google Play Billing Library
   - (b) StoreKit External Purchase: Apple disclosure sheet → Stripe Checkout → Apple月次レポート
   - (c) Stripe Web: アプリ外Webサイト、B2B/年間契約
   - チャネル別のDB状態（subscriptions テーブル）も明示

4. **`packages/billing/CLAUDE.md` を更新**:
   - 責務に「3チャネルの購入フロー管理」を追加
   - 外部依存に「App Store External Purchase Server API」を追加

5. **`docs/requirements.md` BILL-007 を更新**:
   - 旧: 「アプリ内にStripe決済導線は置かない」
   - 新: 「日本市場ではIAPとStoreKit External Purchase（アプリ内Stripe外部リンク）を併設」

## 修正したファイル一覧

| ファイル | 種類 |
|---------|------|
| docs/agent-flow.md | C-001 |
| packages/ui-kit/src/i18n/locales/zh.json | C-002 |
| supabase/migrations/00001_initial_schema.sql | C-003 + M-003 |
| docs/billing-detail.md | M-002 + StoreKit External |
| docs/account-deletion.md | M-007 |
| docs/unit-economics.md | StoreKit External 採用 |
| docs/api-spec.md | StoreKit External 採用 |
| docs/requirements.md | BILL-007 更新 |
| packages/billing/CLAUDE.md | StoreKit External 採用 |
| docs/review-responses-v9.md | このファイル（新規） |

## 次のステップ

第10回レビュー（ユーザー指示）で本コミットの修正を再点検し、その後 Phase 1a 実装に入る。

第8回レビューの残りの Minor 項目（m-001〜m-011）は Phase 1a 実装中に随時対応可能。
