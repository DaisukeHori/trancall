# 翻訳品質 QA テストケース設計書 (D10)

| 項目 | 内容 |
|------|------|
| ドキュメント ID | TRANS-QA-001 |
| Status | Draft v1.0 (2026-05-12) |
| Sprint | Sprint 2 R1 補追 (D-4 TODO 対応) |
| 上位文書 | `docs/requirements.md` §1.5 (13 出力言語) / `docs/requirements.md` §4 PERF-002 / `docs/translation-pipeline-design.md` v1.5 / `docs/architecture.md` §5 |
| 関連文書 | `docs/production-runbook.md` v1.3 §15 (PERF-002 Gate Check) / `docs/legal-and-consent.md` v1.2 §9 (OpenAI ZDR 音声同意) / `docs/app-store-submission.md` v1.2 §10 (App Review note) |
| 下位実装対象 | `scripts/quality-qa.ts` (新規、Sprint 3) / `docs/audit-reports/qa-YYYY-MM-DD.md` (QA 結果記録、Sprint 3 で生成) |
| 想定読者 | Sprint 3 末 / TestFlight β 配信前に翻訳品質 QA を実施する QA + PM |

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [用語と前提](#2-用語と前提)
3. [評価指標 (5 軸)](#3-評価指標-5-軸)
4. [テストケース構造 (65 = 13 言語 × 5 シナリオ)](#4-テストケース構造-65--13-言語--5-シナリオ)
5. [シナリオ詳細 (S1-S5)](#5-シナリオ詳細-s1-s5)
6. [言語別追加観点](#6-言語別追加観点)
7. [採点ルール (5 段階 + 合否基準)](#7-採点ルール-5-段階--合否基準)
8. [実施手順 (準備 / 実走 / 集計)](#8-実施手順-準備--実走--集計)
9. [合否判定マトリクス](#9-合否判定マトリクス)
10. [リジェクト時の対応フロー](#10-リジェクト時の対応フロー)
11. [自動化検討 (BLEU / COMET / 人間評価併用)](#11-自動化検討-bleu--comet--人間評価併用)
12. [Apple App Review note 用エビデンス](#12-apple-app-review-note-用エビデンス)
13. [改訂履歴](#13-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の目的

本書は Sprint 2 D-4 TODO 対応として、TranCall の **翻訳品質 QA テストケース** を canonical に確定する設計書である。

GPT-Realtime-Translate (model: `gpt-realtime-translate`) を採用したリアルタイム翻訳通話アプリとして、Apple App Store 提出直前・TestFlight β 配信開始前に実施する **最終品質ゲート** を体系化する。

Sprint 3 末で QA を実施するエンジニア・QA・PM が本書 1 冊で必要な情報を得られることを目標とする:

- **QA 担当**: §4 (テストケース構造)・§5 (シナリオ詳細)・§6 (言語別追加観点)・§7 (採点ルール)・§8 (実施手順)・§9 (合否判定マトリクス)
- **PM**: §3 (評価指標)・§9 (合否判定マトリクス)・§10 (リジェクト時対応)・§12 (App Review note エビデンス)
- **エンジニア**: §8.1 (準備・`scripts/quality-qa.ts`)・§11 (自動化検討)・§3.4 (レイテンシ軸との連動)

### 1.2 本書が確定すること

- 評価指標 5 軸の定義と重み (§3)
- テストケース 65 件の構造 (13 言語 × 5 シナリオ、§4)
- 各シナリオの実発話スクリプト例 (§5)
- 言語別固有の評価観点 (§6)
- 5 段階採点ルールと合否基準 (§7)
- QA 実施手順 7-10 日のタイムライン (§8)
- 合否判定マトリクスのテンプレ (§9)
- Apple App Store 提出用エビデンス仕様 (§12)

### 1.3 本書がカバーしない範囲

| 除外対象 | canonical 出典 |
|---|---|
| PERF-002 レイテンシの詳細計測手順 | `docs/production-runbook.md` v1.3 §15 |
| OpenAI Realtime Translation API 接続実装 | `docs/translation-pipeline-design.md` v1.5 |
| 音声同意フロー (AUTH-009) 実装 | `docs/legal-and-consent.md` v1.2 §9 |
| App Store 提出手続き全般 | `docs/app-store-submission.md` v1.2 |
| UI 多言語化 (i18n) テスト | `docs/test-strategy.md` |
| 自動回帰テスト基盤 | `docs/e2e-test-design.md` |

### 1.4 関連設計書との位置関係

```
docs/requirements.md             §1.5 (13 出力言語) / §4 PERF-002 (p95 ≤ 3s)
docs/translation-pipeline-design.md  v1.5 — translation-agent / OpenAI 接続実装
docs/architecture.md             §5.5 — 言語ペア検出、同一言語発話の ambient passthrough
docs/legal-and-consent.md        v1.2 §9 — OpenAI ZDR 音声送信同意 (ConsentScope)
docs/production-runbook.md       v1.3 §15 — PERF-002 Gate Check (本書 §3.4 と連動)
docs/app-store-submission.md     v1.2 §10 — App Review note (本書 §12 がエビデンスを提供)
docs/translation-quality-qa.md   ★本書 (翻訳品質 QA canonical)
scripts/quality-qa.ts            (新規、Sprint 3) — QA 実施補助スクリプト
docs/audit-reports/qa-YYYY-MM-DD.md  (新規、Sprint 3) — QA 結果記録
```

---

## 2. 用語と前提

### 2.1 用語定義

| 用語 | 定義 |
|---|---|
| **GPT-RT-Translate** | OpenAI GPT-Realtime-Translate。音声入力を別言語の音声にリアルタイム変換する API。接続先: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate` |
| **言語ペア (Language Pair)** | 発話言語 → 翻訳先言語の組み合わせ。例: `ja-en` (日本語発話 → 英語翻訳)。TranCall では参加者の `nativeLanguage` 設定に基づき自動決定される |
| **シナリオ (Scenario)** | 翻訳品質を評価するための会話コンテキスト。本書では S1-S5 の 5 シナリオを定義する |
| **テストケース (Test Case)** | 言語 × シナリオの組み合わせ 1 件。65 件 (13 言語 × 5 シナリオ) が評価対象 |
| **ターン (Turn)** | 会話の 1 発話単位。各シナリオは 10 ターンで構成される |
| **ネイティブ評価者** | 対象言語を母語とする評価者。各言語 1 名以上を確保する |
| **ambient passthrough** | 原音 30% を常時ミキシングして翻訳音声到着時に ducking する機構。`architecture.md` §5.5 / `translation-pipeline-design.md` §2.3 で実装済 |
| **PASS / CONDITIONAL_PASS / FAIL** | 本書 §7 で定義する言語ペア単位の合否判定結果 |
| **Phase 1a** | MVP Core (TestFlight 内部 β)。本書の QA はこの Phase 完了基準の一部を構成する |
| **ZDR (Zero Data Retention)** | OpenAI Zero Data Retention ポリシー。TranCall は ZDR 合意済。詳細: `legal-and-consent.md` v1.2 §9 |

### 2.2 前提条件

- TranCall の Translation Agent が LiveKit Room に正常に参加し、GPT-RT-Translate WebSocket 接続が確立できること
- QA 実施環境は **staging 環境** (production ではなく)。`production-runbook.md` v1.3 §2 に準拠した staging 環境が構築済であること
- QA 実施時に OpenAI ZDR ポリシー合意が有効であること (`legal-and-consent.md` v1.2 §9.1 の `voice_to_openai` ConsentScope が DB に記録済)
- 評価者は **TranCall を介した翻訳結果** のみを評価する (原音や字幕は補助参照)
- 録音は **30 秒以内 / ターン** を目安とする。QA 端末 2 台で TranCall を起動して通話を行い、その録音を評価者が再生・採点する

### 2.3 出力言語一覧 (13 言語)

`docs/requirements.md` §1.5 に準拠する:

| コード | 言語名 | Phase 1a 優先度 |
|---|---|---|
| `en` | English | 高 (主要ペア: ja-en / en-ja) |
| `es` | Español | 中 |
| `pt` | Português | 中 |
| `fr` | Français | 中 |
| `ja` | 日本語 | 高 (主要ペア: ja-en / ja-zh) |
| `ru` | Русский | 中 |
| `zh` | 中文 (簡体字) | 高 (主要ペア: zh-ja / ja-zh) |
| `de` | Deutsch | 中 |
| `ko` | 한국어 | 高 (主要ペア: ko-ja / ja-ko) |
| `hi` | हिन्दी | 低 (Phase 1a では評価のみ、Phase 1c で改善) |
| `id` | Bahasa Indonesia | 低 |
| `vi` | Tiếng Việt | 低 |
| `it` | Italiano | 低 |

---

## 3. 評価指標 (5 軸)

### 3.1 評価軸定義と重み

| 軸 ID | 軸名 | 内容 | 重み |
|---|---|---|---|
| **A** | 正確性 (Accuracy) | 意味が正しく伝わるか。誤訳・意味の欠落・追加がないか。専門用語・固有名詞・数値の翻訳精度 | 30% |
| **F** | 流暢性 (Fluency) | 自然な語順・文法・語彙。イントネーション・音声品質の自然さ。リスナーが違和感なく聞けるか | 25% |
| **C** | 文脈保持 (Context) | 会話履歴を踏まえた翻訳。代名詞解決・主語省略補完・敬語レベルの一貫性。前のターンとの整合性 | 20% |
| **L** | レイテンシ (Latency) | 発話終了 → 翻訳音声開始の遅延。PERF-002 p95 ≤ 3.0 秒基準に対する主観評価 | 15% |
| **S** | 安全性 (Safety) | 暴言・差別語・機密情報を勝手に追加・削除・改変しない。センシティブ発話の適切な処理 | 10% |

**総合スコア** = (A × 0.30) + (F × 0.25) + (C × 0.20) + (L × 0.15) + (S × 0.10)

各軸は §7.1 の 5 段階スコアで評価する。総合スコアの最大値は 5.0。

### 3.2 軸 A — 正確性 (Accuracy) 評価観点

- 意味の完全性: 発話内容が翻訳先言語で漏れなく伝わっているか
- 誤訳の有無: 逆の意味や無関係な語に変換されていないか
- 固有名詞: 地名・人名・製品名が原文通りに保たれているか (または慣用訳があるか)
- 数値・通貨: 数字・単位・通貨記号が正確に翻訳されているか (シナリオ S4 重点)
- 専門用語: ビジネス・旅行ドメインの術語が適切に翻訳されているか (シナリオ S2 重点)

### 3.3 軸 F — 流暢性 (Fluency) 評価観点

- 語順: 翻訳先言語の自然な語順になっているか
- 文法: 格変化・助詞・冠詞・語尾変化が正確か
- 語彙: レジスターに合った語彙選択か (カジュアル/フォーマルの使い分け)
- 音声: 合成音声のイントネーション・速度・発音が自然か (Dynamic Voice Adaptation の評価)
- 接続: 前後のターンと音声レベルが自然に繋がるか

### 3.4 軸 L — レイテンシ (Latency) 評価観点と PERF-002 連動

レイテンシ評価軸は **主観評価** (評価者が聞いた印象) を用いる。客観計測は `docs/production-runbook.md` v1.3 §15 (PERF-002 Gate Check) で行い、QA の採点とは独立して記録する。

| スコア | 評価者の主観 | 目安 (参考、実測は Gate Check) |
|---|---|---|
| 5 | ほぼ遅延を感じない | p95 ≤ 1.5s |
| 4 | わずかに間があるが会話を妨げない | p95 ≤ 2.5s |
| 3 | 遅延を感じるが許容できる | p95 ≤ 3.0s (PERF-002 基準) |
| 2 | 遅延が会話のリズムを明らかに妨げる | p95 3.0s〜4.0s |
| 1 | 会話不能なほどの遅延 | p95 > 4.0s |

> **注意**: レイテンシ軸スコアが全ケース平均 3 未満の場合、翻訳品質 QA と並行して `production-runbook.md` v1.3 §15.7 のエスカレーション手順を即時発動する。

### 3.5 軸 S — 安全性 (Safety) 評価観点

- 暴言・差別語の非挿入: 翻訳過程で不適切な語が追加されていないか
- 機密情報の非漏洩: 翻訳が第三者に対して不適切な情報を露出していないか
- センシティブ発話の処理: 差別的・政治的・宗教的発話がそのまま正確に翻訳されるか (翻訳エンジンが勝手に削除・追加しないことを確認)
- OpenAI content_filter トリガー: `translation-pipeline-design.md` §10.1 の `TRANSLATION_SAFETY_STOP` が適切なタイミングで発火するか (誤発火・未発火の両方を確認)

---

## 4. テストケース構造 (65 = 13 言語 × 5 シナリオ)

### 4.1 テストケース総覧

13 出力言語 × 5 シナリオ = **65 テストケース**。

各テストケースは:
- **発話言語 (Source)**: 評価フェーズに応じて選択 (§4.2 参照)
- **翻訳先言語 (Target)**: 13 出力言語のうちの 1 言語
- **シナリオ (Scenario)**: S1-S5 のうちの 1 シナリオ
- **ターン数**: 各シナリオ 10 ターン

### 4.2 実施フェーズ別スコープ

#### Phase 1a (Sprint 3 末、TestFlight 提出前)

発話言語を `{ja, en, zh, ko}` の 4 言語に限定し、13 出力言語へのペアを評価する。

| 発話言語 | 翻訳先言語 | ペア数 |
|---|---|---|
| ja | en / es / pt / fr / ru / zh / de / ko / hi / id / vi / it | 12 ペア |
| en | ja / es / pt / fr / ru / zh / de / ko / hi / id / vi / it | 12 ペア |
| zh | ja / en / es / pt / fr / ru / de / ko / hi / id / vi / it | 12 ペア |
| ko | ja / en / es / pt / fr / ru / zh / de / hi / id / vi / it | 12 ペア |

合計 48 ペア × 5 シナリオ = **240 ケース** (Phase 1a 優先評価セット)。

Apple 提出基準に直結する **主要 4 ペア** を Phase 1a で必須評価とする:
- `ja-en` (日本語発話 → 英語翻訳)
- `en-ja` (英語発話 → 日本語翻訳)
- `ja-zh` (日本語発話 → 中国語翻訳)
- `zh-ja` (中国語発話 → 日本語翻訳)

#### Phase 1c (ストア公開前、全ペア網羅)

入力 70+ 言語 × 出力 13 言語の全ペアを S1 シナリオのみで評価。Phase 1a で FAIL した言語ペアの改善確認を含む。

### 4.3 テストケース ID 体系

```
TC-{scenario}-{target_lang}

例:
TC-S1-ja  : S1 日常会話 × 日本語翻訳
TC-S2-en  : S2 ビジネス × 英語翻訳
TC-S4-zh  : S4 数値・通貨 × 中国語翻訳
TC-S5-ko  : S5 同一言語発話混入 × 韓国語翻訳
```

Phase 1a 必須テストケース (主要 4 ペア × 5 シナリオ = 20 件):

| ケース ID | 発話言語 | 翻訳先言語 | シナリオ |
|---|---|---|---|
| TC-S1-en (ja発話) | ja | en | S1 日常会話 |
| TC-S2-en (ja発話) | ja | en | S2 ビジネス |
| TC-S3-en (ja発話) | ja | en | S3 旅行・地名 |
| TC-S4-en (ja発話) | ja | en | S4 数値・通貨 |
| TC-S5-en (ja発話) | ja | en | S5 同一言語発話混入 |
| TC-S1-ja (en発話) | en | ja | S1 日常会話 |
| TC-S2-ja (en発話) | en | ja | S2 ビジネス |
| TC-S3-ja (en発話) | en | ja | S3 旅行・地名 |
| TC-S4-ja (en発話) | en | ja | S4 数値・通貨 |
| TC-S5-ja (en発話) | en | ja | S5 同一言語発話混入 |
| TC-S1-zh (ja発話) | ja | zh | S1 日常会話 |
| TC-S2-zh (ja発話) | ja | zh | S2 ビジネス |
| TC-S3-zh (ja発話) | ja | zh | S3 旅行・地名 |
| TC-S4-zh (ja発話) | ja | zh | S4 数値・通貨 |
| TC-S5-zh (ja発話) | ja | zh | S5 同一言語発話混入 |
| TC-S1-ja (zh発話) | zh | ja | S1 日常会話 |
| TC-S2-ja (zh発話) | zh | ja | S2 ビジネス |
| TC-S3-ja (zh発話) | zh | ja | S3 旅行・地名 |
| TC-S4-ja (zh発話) | zh | ja | S4 数値・通貨 |
| TC-S5-ja (zh発話) | zh | ja | S5 同一言語発話混入 |

---

## 5. シナリオ詳細 (S1-S5)

### 5.1 シナリオ概要

| シナリオ | 名称 | コンテキスト | 重点評価軸 |
|---|---|---|---|
| **S1** | 日常会話 | 10 ターン、自己紹介 + 趣味の話 | 流暢性・文脈保持 |
| **S2** | ビジネス | 10 ターン、商談・専門用語含む | 正確性・流暢性 |
| **S3** | 旅行・地名 | 10 ターン、観光地・交通・宿泊 | 正確性・固有名詞 |
| **S4** | 数値・通貨 | 10 ターン、価格・数量・日時を含む | 正確性 |
| **S5** | 同一言語発話混入 | 10 ターン、主言語に別言語が混入 | 安全性・文脈保持・ambient passthrough |

---

### 5.2 S1 — 日常会話 (Daily Conversation)

**目的**: 日常的な自己紹介・趣味の話を通じ、基本的な翻訳流暢性と文脈保持を評価する。

**実施方法**: QA 端末 A (発話言語) と端末 B (翻訳先言語) で TranCall 通話を開始。スクリプトに従い A が日本語 (または発話言語) で発話し、B 側に届く翻訳音声を録音する。

#### S1 スクリプト例 (ja → en)

| ターン | 発話者 | 発話 (日本語) | 期待翻訳 (英語) | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「はじめまして、田中と申します。よろしくお願いします。」 | "Nice to meet you. My name is Tanaka. I look forward to working with you." | 謙譲表現の自然な英語化 |
| T2 | B | "Hello! I'm John, calling from Seattle. Nice to meet you too." | (ja翻訳) 「こんにちは！シアトルからかけているジョンです。こちらこそよろしくお願いします。」 | 固有名詞 (Seattle, John) の保持 |
| T3 | A | 「趣味は写真撮影です。特に風景写真が好きで、週末は山や海に行きます。」 | "My hobby is photography. I especially love landscape shots, and on weekends I go to the mountains or the sea." | 複数趣味の正確な伝達 |
| T4 | B | "That's great! I enjoy hiking as well. Have you been to any famous mountains in Japan?" | (ja翻訳) 「それはいいですね！私もハイキングが好きです。日本の有名な山に行ったことはありますか？」 | 疑問文の自然な翻訳 |
| T5 | A | 「はい、富士山に3回登ったことがあります。とても達成感がありました。」 | "Yes, I've climbed Mt. Fuji three times. It was really fulfilling." | 固有名詞 (富士山) + 回数 |
| T6 | B | "Wow, three times! That must be quite a challenge. What was the most memorable part?" | (ja翻訳) 「すごい、3回も！かなり大変だったでしょう。一番印象に残った部分は何ですか？」 | 感嘆・疑問の組み合わせ |
| T7 | A | 「山頂での日の出が最高でした。空が赤やオレンジに染まって、言葉にならないほど美しかったです。」 | "The sunrise at the summit was the best. The sky was dyed red and orange—it was so beautiful, words can't describe it." | 情景描写・感情表現の精度 |
| T8 | B | "I can imagine. Nature really puts things in perspective. Do you share your photos online?" | (ja翻訳) 「想像できます。自然は本当に物事を別の視点で見せてくれますよね。写真はオンラインで公開していますか？」 | 抽象的表現の文脈保持 |
| T9 | A | 「はい、Instagramに投稿しています。フォロワーが最近1000人を超えました。」 | "Yes, I post on Instagram. My followers recently exceeded 1,000." | SNS 固有名詞 + 数値 |
| T10 | B | "That's impressive! I'll make sure to follow you. Let's keep in touch." | (ja翻訳) 「それはすごい！フォローしますね。またご連絡しましょう。」 | 締めくくり表現の自然さ |

#### S1 スクリプト例 (en → ja)

上記 A/B の発話言語を逆転させる。端末 A で英語を話し、端末 B で届く日本語翻訳を評価する。期待翻訳は上記「(ja翻訳)」列を参照。

#### S1 スクリプト例 (ja → zh)

| ターン | 発話者 | 発話 (日本語) | 期待翻訳 (中国語簡体字) | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「はじめまして、田中です。」 | "你好，我叫田中。" | 自己紹介の自然な中国語化 |
| T2 | B (zh) | "你好！我叫李明，来自北京。" | (ja翻訳)「こんにちは！私は李明といいます。北京から来ました。」 | 固有名詞 (北京) の保持 |
| T3 | A | 「趣味は写真です。」 | "我的爱好是摄影。" | 簡潔な文の自然さ |
| … | … | … | … | … |
| T10 | A/B | 締めくくり | 締めくくり表現 | 礼儀表現の文化的適切性 |

> 全 13 言語 × S1 の完全スクリプトは `docs/audit-reports/qa-YYYY-MM-DD.md` 生成時に添付する。QA 担当は `scripts/quality-qa.ts` の出力する cue テキストを参照して発話する。

---

### 5.3 S2 — ビジネス (Business Conversation)

**目的**: 商談・ビジネスコミュニケーションにおける専門用語の正確な翻訳を評価する。

**重点語彙**: 「契約」「納期」「見積もり」「発注」「在庫」「仕様」「予算」「承認」「提案書」「キャンセル条項」

#### S2 スクリプト例 (ja → en)

| ターン | 発話者 | 発話 (日本語) | 期待翻訳 (英語) | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「本日はお時間をいただきありがとうございます。新製品についてご提案させていただきます。」 | "Thank you for your time today. I'd like to present a proposal regarding our new product." | ビジネス敬語の自然な英語化 |
| T2 | B | "Of course. Could you share the specifications and pricing?" | (ja翻訳) 「もちろんです。仕様と価格について教えていただけますか？」 | 仕様・価格の専門用語 |
| T3 | A | 「はい。本製品の納期は発注から6週間、見積もり金額は税別で250万円になります。」 | "Yes. The lead time for this product is 6 weeks from order, and the estimated cost is 2.5 million yen, excluding tax." | 納期・税別・大きな数値 |
| T4 | B | "I see. Can you negotiate on the price? We're working within a limited budget." | (ja翻訳) 「なるほど。価格交渉は可能ですか？予算に限りがありまして。」 | 交渉・予算の語彙 |
| T5 | A | 「10台以上のご発注であれば、5%の割引が可能です。また、キャンセル条項については書面でご確認いただけます。」 | "If you order 10 or more units, a 5% discount is possible. Also, you can review the cancellation clause in writing." | 数量条件・キャンセル条項 |
| T6 | B | "Understood. We'll need approval from our procurement team first." | (ja翻訳) 「承知しました。まず購買チームの承認が必要になります。」 | 組織内手続きの語彙 |
| T7 | A | 「ご承認後、正式な契約書を作成いたします。デジタル署名での対応も可能です。」 | "After approval, we'll prepare a formal contract. Digital signatures are also supported." | 契約・デジタル署名 |
| T8 | B | "Great. What is the warranty period for this product?" | (ja翻訳) 「わかりました。この製品の保証期間はどのくらいですか？」 | 保証期間の語彙 |
| T9 | A | 「製品保証は1年間です。延長保証オプションも別途ご用意しています。」 | "The product warranty is 1 year. We also offer an extended warranty option separately." | 保証・オプション |
| T10 | B | "Thank you. We'll review the proposal and get back to you by the end of the week." | (ja翻訳) 「ありがとうございます。提案書を確認し、週末までにご回答します。」 | 締めくくり + 期限 |

---

### 5.4 S3 — 旅行・地名 (Travel & Place Names)

**目的**: 固有名詞 (観光地・交通機関・宿泊施設) の正確な翻訳を評価する。固有名詞は原則として **原文のまま保持する** ことが期待値。

**重点固有名詞**: 東京タワー、新宿駅、Statue of Liberty、Times Square、Arc de Triomphe、Neuschwanstein Castle

#### S3 スクリプト例 (ja → en)

| ターン | 発話者 | 発話 (日本語) | 期待翻訳 (英語) | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「今週末、東京タワーに行く予定です。展望台からの夜景が楽しみです。」 | "I'm planning to visit Tokyo Tower this weekend. I'm looking forward to the night view from the observation deck." | 「東京タワー」はそのまま "Tokyo Tower" |
| T2 | B | "Sounds fun! How will you get there? By subway?" | (ja翻訳) 「楽しそうですね！どうやって行くんですか？地下鉄で？」 | 交通手段の語彙 |
| T3 | A | 「新宿駅から都営大江戸線に乗って、赤羽橋駅で降ります。徒歩10分くらいです。」 | "Take the Toei Oedo Line from Shinjuku Station and get off at Akabanebashi Station. It's about a 10-minute walk." | 駅名・路線名の固有名詞保持 |
| T4 | B | "I visited the Statue of Liberty when I was in New York. It was breathtaking." | (ja翻訳) 「私はニューヨークにいたとき自由の女神を訪れました。圧倒されました。」 | Statue of Liberty の翻訳 (自由の女神) |
| T5 | A | 「自由の女神は迫力がありますよね。私もいつかニューヨークに行ってみたいです。タイムズスクエアも見たい。」 | "The Statue of Liberty is quite impressive. I'd like to visit New York someday too. I'd also love to see Times Square." | 自由の女神 → "Statue of Liberty" の逆翻訳 |
| T6 | B | "Times Square is amazing at night. Have you been to Paris? The Arc de Triomphe is stunning." | (ja翻訳) 「タイムズスクエアは夜すごいですよ。パリには行ったことがありますか？凱旋門が素晴らしい。」 | Arc de Triomphe → 凱旋門 |
| T7 | A | 「パリはまだです。でもドイツのノイシュヴァンシュタイン城には行ったことがあります。」 | "I haven't been to Paris yet. But I have visited Neuschwanstein Castle in Germany." | 長い固有名詞 (Neuschwanstein) の正確な発音・表記 |
| T8 | B | "That's on my bucket list! What was your favorite part of the trip?" | (ja翻訳) 「それはバケットリストに入っています！旅で一番よかった部分は何ですか？」 | bucket list (英語文化的表現) |
| T9 | A | 「湖から見るお城の景色が最高でした。特に夕暮れ時は絵のようでした。」 | "The view of the castle from the lake was stunning. Especially at dusk, it was like a painting." | 情景描写 |
| T10 | A | 「次の旅行はバリ島を考えています。おすすめのスポットはありますか？」 | "I'm thinking of Bali for my next trip. Do you have any recommended spots?" | バリ島 → "Bali" |

---

### 5.5 S4 — 数値・通貨 (Numbers & Currency)

**目的**: 数値・通貨・日時・量の正確な翻訳を評価する。翻訳エンジンが数値を変換・省略しないことを確認する。

**重点確認**: 「1,500 円」「$50.20」「2.5 万ドル」「3月15日」「午後2時半」「10,000 個」

#### S4 スクリプト例 (ja → en)

| ターン | 発話者 | 発話 (日本語) | 期待翻訳 (英語) | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「ランチのセットは1500円です。飲み物込みで1800円になります。」 | "The lunch set is 1,500 yen. With a drink, it comes to 1,800 yen." | 3・4桁の数値と通貨単位 |
| T2 | B | "Is there a discount if we order for 5 people?" | (ja翻訳) 「5人分注文すると割引はありますか？」 | 人数の数値 |
| T3 | A | 「5名様以上のご利用でお一人様200円引きになります。合計で8,000円になります。」 | "For 5 or more guests, there's a 200-yen discount per person. The total would be 8,000 yen." | 条件付き割引と合計額 |
| T4 | B | "We also need the venue until 3:30 PM. Is that possible?" | (ja翻訳) 「午後3時半まで会場を使う必要があります。それは可能ですか？」 | 時刻の自然な翻訳 |
| T5 | A | 「午後3時30分まででしたら、追加料金は1時間あたり3,500円になります。」 | "If it's until 3:30 PM, the additional charge would be 3,500 yen per hour." | 時刻と時間単位の料金 |
| T6 | B | "And what's the exchange rate? We'd be paying in USD." | (ja翻訳) 「為替レートはどのくらいですか？ドルで支払う予定です。」 | 通貨変換への言及 |
| T7 | A | 「本日の換算ですと、1ドル約155円です。8,000円は約51ドル65セントです。」 | "At today's rate, it's approximately 155 yen per dollar. 8,000 yen is about $51.65." | 為替レート・小数点込みドル表記 |
| T8 | B | "I see. We'll have about $50.20 per person then." | (ja翻訳) 「なるほど。では一人あたり約50ドル20セントになりますね。」 | 小数点2桁の通貨 |
| T9 | A | 「承りました。ご予約は3月15日午後12時から、10名様でよろしいでしょうか。」 | "Understood. So that's a reservation on March 15th, from noon, for 10 guests—correct?" | 日付・時刻・人数の複合 |
| T10 | B | "That's correct. We'll confirm by March 10th." | (ja翻訳) 「そうです。3月10日までに確認します。」 | 別の日付 (デッドライン) |

---

### 5.6 S5 — 同一言語発話混入 (Code-Switching / Ambient Passthrough)

**目的**: 主言語の発話の中に別言語が混入した場合の翻訳品質を評価する。`architecture.md` §5.5 の ambient passthrough (原音 30% 常時ミキシング) が正常に機能しているかを確認する。

**背景**: GPT-RT-Translate が日本語通話中に "Thank you" 等の英語 (発話言語と翻訳先言語が同一になる瞬間) をどう処理するかを検証する。期待動作: ambient passthrough により原音が 30% で届き、翻訳音声が無音にならない。

**検証観点**:
1. 混入発話が翻訳先言語に自然に変換されるか (または原音として届くか)
2. ambient passthrough により混入発話時も無音にならないか
3. 混入後のターンで文脈保持が継続するか

#### S5 スクリプト例 (ja → en: 日本語中に英語混入)

| ターン | 発話者 | 発話 | 期待翻訳 / 期待挙動 | 評価ポイント |
|---|---|---|---|---|
| T1 | A | 「今日はお越しいただきありがとうございます。」(日本語) | "Thank you for coming today." | 通常の ja→en 翻訳 |
| T2 | A | 「まず、"Thank you for your patience." とお伝えしたいです。」(日本語 + 英語混入) | "First, I'd like to say 'Thank you for your patience.'" または原音 passthrough | 英語フレーズが翻訳先 (en) と同一言語で混入。ambient passthrough で原音が届くことを確認 |
| T3 | B | "Of course. Please continue." | (ja翻訳) 「もちろんです。続けてください。」 | 前ターンの混入後も B→A 方向の翻訳は通常通り |
| T4 | A | 「次のアジェンダは3点です。一つ目は、"product launch plan"について。」 | "The next agenda has 3 points. First, regarding the 'product launch plan'." | 英語固有名詞句の混入 |
| T5 | A | 「二つ目は Q2 の sales target、三つ目は marketing budget の話です。」 | "Second is the Q2 sales target, and third is the marketing budget." | 英語キーワード複数混入の連続 |
| T6 | B | "Sounds good. Should I take notes?" | (ja翻訳) 「了解です。メモを取りましょうか？」 | 通常の翻訳 (B→A 方向) |
| T7 | A | 「はい、お願いします。あと、"deadline" は来週金曜日です。」 | "Yes, please. Also, the deadline is next Friday." | "deadline" (英単語) の自然な処理 |
| T8 | A | 「"OK" と "yes" は同じ意味で使っています。」 | "I'm using 'OK' and 'yes' interchangeably." | 単音節英語の複数混入 |
| T9 | B | "Got it. Any other points?" | (ja翻訳) 「了解しました。他に何かありますか？」 | 通常の翻訳継続 |
| T10 | A | 「以上です。"Thank you all!" でまとめましょう。」 | "That's all. Let's wrap up with 'Thank you all!'" | 締めくくりの混入 |

**ambient passthrough 評価チェックリスト** (S5 共通):

| チェック項目 | 確認方法 | 期待結果 |
|---|---|---|
| 混入発話時に翻訳音声が完全無音にならない | B 側の受話音声を録音して確認 | 原音 30% が ambient passthrough で届く |
| 混入発話後に翻訳音声が正常に再開する | T3/T6/T9 の翻訳音声を確認 | 次ターンの翻訳が正常 |
| `translation-pipeline-design.md` §2.3 の ducking が正常動作 | 翻訳音声到着時に原音が ducking されるか | 翻訳音声と原音が重複して大きな音にならない |

---

## 6. 言語別追加観点

各翻訳先言語に固有の評価観点を定義する。ネイティブ評価者はこれらを追加チェックリストとして参照する。

### 6.1 日本語 (ja)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **敬語レベル** | タメ語 / 丁寧語 (です・ます体) / 尊敬語 / 謙譲語のレベルが発話コンテキストに合っているか | S2 ビジネスシナリオで「です・ます体」が維持されているか確認 |
| **主語省略** | 日本語の主語省略が自然に補完されているか (英語発話を日本語に翻訳する場合) | S1 T4「I enjoy hiking as well」→「私もハイキングが好きです」の「私も」補完 |
| **助詞の使い分け** | 「は」と「が」の使い分けが文脈に応じて正確か | S1 T5「富士山には / が」の自然な使い分け |
| **長音・促音** | 外来語の長音 (コーヒー / コピー) が正確か | S2・S3 の外来語固有名詞 |
| **カタカナ外来語** | 英語 → 日本語翻訳時に適切なカタカナ変換がされているか (例: budget → バジェット / 予算) | S2 T6「budget」 |

### 6.2 中文・中国語 (zh)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **簡体字優先** | 出力が簡体字で統一されているか (繁体字の混在がないか) | 全ケースで「国」「时」「对」等が簡体字で出力されることを確認 |
| **繁体字対応** | zh-TW / zh-HK は Phase 2 対応。Phase 1a では繁体字リクエストが来ないことを前提とするが、簡体字出力であることを明示的に確認 | 評価者は台湾 / 香港出身ではなく、大陸出身の簡体字ネイティブを推奨 |
| **声調の不干渉** | 音声認識・翻訳過程で声調情報が意味翻訳に干渉しないか | S1 の日常会話全ターンで声調起因の誤訳がないことを確認 |
| **語順** | 中国語の SOV 語順が適切に保たれているか | S2 ビジネスシナリオでの動詞位置 |
| **量詞** | 数値シナリオ (S4) で適切な量詞が使われているか (例: 5 个人 / 5 名) | S4 T1「5名様」→「5位客人」等 |

### 6.3 韓国語 (ko)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **敬語の階層** | 해요体 (カジュアル丁寧) / 합니다体 (フォーマル) の使い分けがコンテキストに合っているか | S1 (日常) では 해요体、S2 (ビジネス) では 합니다体 が期待値 |
| **主語省略** | 韓国語の主語省略が文脈から自然に補完されているか | S1 全ターンで主語省略の自然さを確認 |
| **助詞の格変化** | 주격 (-이/-가)・목적격 (-을/-를) 등 의 격조사가 올바른가 | S2 の発注・承認ターン |
| **漢字語** | 日本語・中国語由来の漢字語 (계약 / 납기 等) が適切に使われているか | S2 ビジネスシナリオ |

### 6.4 ヒンディー語 (hi)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **デーヴァナーガリー文字** | 出力がデーヴァナーガリー文字で正確に表示されているか | 全ケースで文字化けがないことを字幕で確認 |
| **Hinglish 処理** | 英単語が混入する Hinglish (e.g., "OK", "please") が自然に処理されているか | S5 の同一言語発話混入シナリオで確認 |
| **語尾変化** | 動詞語尾の性・数による変化が正確か | S1 のような日常会話全般 |
| **敬称** | आप (敬称) / तुम (カジュアル) の使い分け | S2 ビジネスシナリオ |

### 6.5 ロシア語 (ru)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **格変化 (6格)** | 主格 / 生格 / 与格 / 対格 / 造格 / 前置格の選択が正確か | S2 ビジネスシナリオ (契約、納期の前置詞格) |
| **動詞の体 (アスペクト)** | 完了体 / 不完了体の使い分けが文脈に合っているか | S1・S2 全般 |
| **数詞との格一致** | 1 / 2-4 / 5以上 で名詞の格が異なる点が正確か | S4 数値シナリオ |
| **キリル文字** | 字幕表示でキリル文字が文字化けしないこと | 全ケースで字幕を視覚確認 |

### 6.6 ドイツ語 (de)

| 観点 | 内容 | 評価方法 |
|---|---|---|
| **名詞の性** | der / die / das の選択が正確か | S2 ビジネスシナリオ (die Rechnung, der Vertrag 等) |
| **格変化 (4格)** | Nominativ / Genitiv / Dativ / Akkusativ の適切な選択 | S2・S4 全般 |
| **複合語** | 複合名詞が自然に構成されているか (Lieferdatum / Kaufvertrag 等) | S2 の専門用語 |
| **語順 (副文)** | 副文での定動詞後置が正確か | S1・S2 全般 |

### 6.7 スペイン語 (es) / ポルトガル語 (pt) / フランス語 (fr) / イタリア語 (it)

| 言語 | 主要観点 |
|---|---|
| es | 動詞活用 (ser/estar の使い分け)、名詞の性の一致、アクセント記号の正確さ |
| pt | ブラジルポルトガル語を優先 (欧州 pt は Phase 2)、nasal vowel (ã/ẽ) の発音品質 |
| fr | 冠詞省略 (elision)、連音 (liaison)、ネガティブ構文 (ne...pas) の正確さ |
| it | 定冠詞の性・数一致、条件法・接続法の適切な使用 (S2 ビジネス) |

### 6.8 インドネシア語 (id) / ベトナム語 (vi)

| 言語 | 主要観点 |
|---|---|
| id | 語順 (SVO)、接頭辞・接尾辞 (me-/-kan) の自然さ、外来語 (英語・オランダ語) の処理 |
| vi | 声調 (6声調) の発音品質、南部 vs 北部方言差は許容範囲、漢字語 (Sino-Vietnamese) の適切な処理 |

---

## 7. 採点ルール (5 段階 + 合否基準)

### 7.1 スコア定義 (5 段階)

| スコア | 評価 | 内容 |
|---|---|---|
| **5** | 完璧 (Excellent) | ネイティブ品質。翻訳であることを意識させない自然さ。誤訳・不自然な表現が皆無 |
| **4** | 良好 (Good) | 軽微な不自然さ (代名詞選択ミス・語彙の微妙な違い等) があるが、意味は完全に通る |
| **3** | 許容 (Acceptable) | 意味は通るが文法または語彙に明らかな問題がある。聞き取れはするが違和感を覚える |
| **2** | 問題あり (Poor) | 意味の一部が欠落・曖昧で、ユーザーに誤解を与える可能性がある |
| **1** | 失敗 (Fail) | 翻訳失敗。意味が伝わらない、または音声が届かない (無音・ノイズのみ) |

### 7.2 各軸の採点手順

評価者は録音を再生しながら、以下の順序で採点する:

1. **軸 S (安全性)** を最初に評価。スコア 1 (不適切語の挿入・機密情報の漏洩等) の場合はそのターンを即時フラグし、QA リーダーに報告する
2. **軸 A (正確性)** を評価。スクリプトの期待翻訳と照合する
3. **軸 F (流暢性)** を評価。音声の自然さを聞いて判断する
4. **軸 C (文脈保持)** を評価。前のターンとの整合性を確認する
5. **軸 L (レイテンシ)** を評価。録音の間隔から主観的に判断する

### 7.3 ターン単位の採点シート

評価者は Google Sheets の採点シートに以下を記入する:

| フィールド | 値 |
|---|---|
| ケース ID | TC-{scenario}-{target_lang} |
| 発話言語 | ja / en / zh / ko 等 |
| ターン番号 | T1-T10 |
| スコア A (正確性) | 1-5 |
| スコア F (流暢性) | 1-5 |
| スコア C (文脈保持) | 1-5 |
| スコア L (レイテンシ) | 1-5 |
| スコア S (安全性) | 1-5 |
| 総合スコア | 加重平均 (§3.1 の式で算出) |
| 備考 | 問題があったターンは具体的に記載 |

### 7.4 集計方法

**ケース単位集計** = 10 ターンの総合スコアの算術平均

**言語ペア単位集計** = 5 シナリオのケース単位集計の算術平均

**全体集計** = 13 言語の言語ペア単位集計の算術平均

### 7.5 合否基準

| 判定 | 基準 | 詳細 |
|---|---|---|
| **PASS** | 言語ペア単位の 5 シナリオ平均 ≥ 3.5 | すべての軸で 2 以下がないこと (いずれか 1 軸でも 2 以下の場合は CONDITIONAL_PASS に降格) |
| **CONDITIONAL_PASS** | 言語ペア単位の 5 シナリオ平均 3.0-3.49 | または、1 軸のみ 2 以下だが総合 ≥ 3.5 の場合。Phase 1a での App Store 提出は許容だが、v1.x での改善必須 |
| **FAIL** | 言語ペア単位の 5 シナリオ平均 < 3.0 | または、安全性軸 S で 1 が 1 ターンでも存在する場合は自動的に FAIL |

### 7.6 Apple 提出基準 (最低要件)

Apple App Store 提出に必要な最低基準:

| 対象 | 基準 |
|---|---|
| 主要 4 ペア (ja-en / en-ja / ja-zh / zh-ja) | 全て **PASS** (≥ 3.5) |
| その他 9 言語 × 各ペア | CONDITIONAL_PASS (≥ 3.0) 以上 |
| 安全性軸 (S) | 全 65 ケース × 10 ターン = 650 ターンで安全性スコア 1 がゼロ |

主要 4 ペアのいずれかが FAIL の場合、Apple App Store 提出を **凍結** し、§10 のリジェクト時対応フローを発動する。

---

## 8. 実施手順 (準備 / 実走 / 集計)

### 8.1 準備 (D1: 1 日)

#### 8.1.1 `scripts/quality-qa.ts` の実装

Sprint 3 で新規実装するスクリプト。QA 担当者が TranCall 通話中に発話の cue (合図) を受け取るために使用する。

```typescript
// scripts/quality-qa.ts (Sprint 3 で実装、以下はインターフェース仕様)

interface QASession {
  scenarioId: "S1" | "S2" | "S3" | "S4" | "S5";
  sourceLang: string;     // ISO 639-1
  targetLang: string;     // ISO 639-1
  turns: QATurn[];
}

interface QATurn {
  turnNumber: number;        // 1-10
  speaker: "A" | "B";
  scriptText: string;        // 発話テキスト (cue として表示)
  expectedTranslation: string;  // 期待翻訳 (評価者参照用)
  audioFilePath?: string;    // 録音保存先パス
}

// 実行コマンド例
// pnpm --filter @trancall/scripts quality-qa \
//   --scenario S1 --source ja --target en \
//   --output docs/audit-reports/qa-YYYY-MM-DD.md
```

#### 8.1.2 評価者シート (Google Sheets) の作成

| シート名 | 内容 |
|---|---|
| `Overview` | 評価概要、日程、評価者名 |
| `TC-{scenario}-{target}` | 各テストケースの採点シート (§7.3 のフォーマット) |
| `Summary` | 言語ペア単位の集計、合否判定マトリクス (§9) |
| `Flags` | 安全性フラグ一覧 |

#### 8.1.3 ネイティブ評価者のリクルート

各出力言語につき **1 名以上** のネイティブスピーカーを確保する。

| 言語 | 推奨リクルート手段 |
|---|---|
| en / es / fr / de / pt / it / ru | Upwork または Gengo のプロ翻訳者 (翻訳品質評価の経験者優先) |
| ja / ko / zh | 国内の日韓中バイリンガル (社内 + クラウドワークス) |
| hi / id / vi | Upwork のローカル言語評価者 |

評価者向けブリーフィング資料 (本書の §2-§7 のサマリー + 評価シートの記入方法説明) を事前に共有する。

#### 8.1.4 QA 実施環境の準備

- staging 環境が `production-runbook.md` v1.3 §2 に準拠して稼働中であること
- QA 端末 2 台: iOS 実機 (iPhone) 1 台 + Android 実機または iOS 2 台目
- TranCall 最新 staging ビルドがインストール済
- テストアカウント 2 つ (qa.tester.a@example.com / qa.tester.b@example.com) が `nativeLanguage` 設定済
- 録音ソフトウェア (QuickTime または Android の画面録画) で受話音声を録音できる状態

### 8.2 実走 (D2-D6: 3-5 日)

#### 8.2.1 実走手順

```
1. scripts/quality-qa.ts を起動して QA セッション設定を入力
   (シナリオ・発話言語・翻訳先言語を指定)

2. 端末 A (発話者) と 端末 B (翻訳受け側) で TranCall 通話を開始
   - 端末 A: nativeLanguage = 発話言語 (例: ja)
   - 端末 B: nativeLanguage = 翻訳先言語 (例: en)
   - 翻訳 ON を確認してから録音開始

3. scripts/quality-qa.ts の cue に従い、端末 A のユーザーがスクリプトを発話
   - 各ターンの発話は cue が表示されてから開始
   - 発話は明瞭に、通常の会話速度で

4. 端末 B 側の音声 (翻訳音声) を録音
   - 録音ファイルは scripts/quality-qa.ts が自動的に
     docs/audit-reports/qa-YYYY-MM-DD/ に保存

5. 10 ターン完了後、次のシナリオへ

6. 同一言語ペアで S1-S5 の 5 シナリオを連続実施
   (1 ペアあたり約 60-90 分)
```

#### 8.2.2 録音品質の確認

各ターンの録音後、以下を確認する:

| チェック項目 | 合格条件 |
|---|---|
| 翻訳音声が録音されている | 無音でないこと |
| 発話から翻訳音声開始までの待機時間が記録できている | 録音ファイルの冒頭に無音部分がある場合はその長さをメモ |
| 音量が適切 | 翻訳音声が聞き取れる音量 (S5 では ambient passthrough の 30% 原音も確認) |
| 録音時間が適切 | ターンあたり 5-40 秒以内 |

#### 8.2.3 実走スケジュール (Phase 1a 主要 4 ペア優先)

| 日程 | 実施ペア | シナリオ | 推定時間 |
|---|---|---|---|
| D2 | ja-en / en-ja | S1-S5 各 1 回 | 3-4 時間 |
| D3 | ja-zh / zh-ja | S1-S5 各 1 回 | 3-4 時間 |
| D4 | ja-ko / ko-ja / ja-es / es-ja | S1-S3 優先 | 4-5 時間 |
| D5 | ja-fr / ja-de / ja-ru / ja-pt | S1-S3 優先 | 4-5 時間 |
| D6 | ja-hi / ja-id / ja-vi / ja-it | S1-S2 優先 | 3-4 時間 |

### 8.3 採点 (D7-D9: 2-3 日)

#### 8.3.1 採点手順

1. 各評価者が担当言語の録音ファイルを受領
2. Google Sheets の採点シートを開き、§7.3 のフォーマットで記入
3. 採点中に疑問が生じた場合は QA リーダーに即時 Slack 連絡
4. 全ターン採点後、Google Sheets の `Summary` シートで自動集計を確認

#### 8.3.2 評価者間信頼性の確認 (Inter-rater Reliability)

主要 4 ペア (ja-en / en-ja / ja-zh / zh-ja) の S1 のみ、**2 名の評価者** が独立して採点し、スコアの相関を確認する。

- 許容差: 各ターンのスコア差 ≤ 1
- 差が 2 以上のターンは第三者 (QA リーダー) が決裁

### 8.4 集計 (D10: 1 日)

1. Google Sheets `Summary` シートで §7.4 の集計計算を実行
2. 言語ペア単位の合否判定 (§7.5 基準) を確認
3. Apple 提出基準 (§7.6) を確認
4. 結果を `docs/audit-reports/qa-YYYY-MM-DD.md` に記録
5. PM・エンジニアリードに結果を報告

**合計工数**: 7-10 日 (準備 1 日 + 実走 3-5 日 + 採点 2-3 日 + 集計 1 日)

---

## 9. 合否判定マトリクス

### 9.1 Phase 1a 主要 4 ペア判定マトリクス (記入テンプレート)

```
         | S1 日常 | S2 商談 | S3 旅行 | S4 数値 | S5 同言語 | 平均  | 判定
---------+---------+---------+---------+---------+-----------+-------+------
ja-en    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
en-ja    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-zh    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
zh-ja    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
```

> 実際の数値は Sprint 3 の QA 実施後に `docs/audit-reports/qa-YYYY-MM-DD.md` に記録する。

### 9.2 全 13 言語判定マトリクス (記入テンプレート)

```
         | S1 日常 | S2 商談 | S3 旅行 | S4 数値 | S5 同言語 | 平均  | 判定
---------+---------+---------+---------+---------+-----------+-------+------
ja-en    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-es    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-pt    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-fr    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-ru    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-zh    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-de    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-ko    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-hi    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-id    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-vi    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ja-it    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
en-ja    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
zh-ja    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
ko-ja    |   -.-   |   -.-   |   -.-   |   -.-   |    -.-    |  -.-  |  -
```

### 9.3 判定凡例

| 判定記号 | 内容 |
|---|---|
| **PASS** | 5 シナリオ平均 ≥ 3.5、安全性スコア 1 なし |
| **CPASS** | CONDITIONAL_PASS。平均 3.0-3.49 または軽微な問題あり |
| **FAIL** | 平均 < 3.0、または安全性スコア 1 が存在 |
| **-** | 未実施 (Sprint 3 QA 前) |

### 9.4 サンプル合否マトリクス (参考例、実施後に更新)

Sprint 3 QA 実施後のサンプル結果として、以下のような分布を想定する:

```
         | S1 日常 | S2 商談 | S3 旅行 | S4 数値 | S5 同言語 | 平均  | 判定
---------+---------+---------+---------+---------+-----------+-------+------
ja-en    |   4.5   |   4.2   |   4.0   |   4.8   |    4.0    |  4.30 | PASS
en-ja    |   4.3   |   4.0   |   3.8   |   4.5   |    3.5    |  4.02 | PASS
ja-zh    |   3.8   |   3.5   |   3.5   |   4.0   |    3.0    |  3.56 | PASS
zh-ja    |   3.7   |   3.4   |   3.5   |   3.9   |    3.2    |  3.54 | PASS
ja-ko    |   4.0   |   3.8   |   3.7   |   4.2   |    3.5    |  3.84 | PASS
ja-es    |   3.9   |   3.6   |   3.5   |   4.0   |    3.2    |  3.64 | PASS
ja-fr    |   3.8   |   3.5   |   3.4   |   3.9   |    3.0    |  3.52 | PASS
ja-de    |   3.7   |   3.4   |   3.3   |   3.8   |    2.9    |  3.42 | CPASS
ja-ru    |   3.5   |   3.2   |   3.1   |   3.7   |    2.8    |  3.26 | CPASS
ja-hi    |   3.2   |   2.8   |   3.0   |   3.5   |    2.5    |  3.00 | CPASS
ja-id    |   3.5   |   3.2   |   3.3   |   3.7   |    3.0    |  3.34 | CPASS
ja-vi    |   3.3   |   3.0   |   3.1   |   3.5   |    2.7    |  3.12 | CPASS
ja-it    |   3.8   |   3.5   |   3.4   |   3.9   |    3.1    |  3.54 | PASS
```

> 上記はサンプル。CONDITIONAL_PASS (CPASS) のペアは Apple 提出後 v1.x での改善目標。

---

## 10. リジェクト時の対応フロー

### 10.1 翻訳品質 FAIL 時の対応

翻訳品質 QA で FAIL が判定された言語ペアについて、原因を切り分けた上で対処する。

#### ステップ 1: 原因の切り分け

| 原因 | 確認方法 | 対処 |
|---|---|---|
| **OpenAI API 起因** | 同じ発話テキストを OpenAI Realtime Translation API に直接送信してレスポンスを確認 | 言語ペアが GPT-RT-Translate の実力限界の場合、Phase 1a スコープから除外して UI で表示制限 |
| **TranCall 前処理起因** | `translation-pipeline-design.md` §3 の PCM 24kHz フォーマット、リサンプル処理を確認 | `apps/translation-agent/src/agent.ts` の AudioStream 設定を修正 |
| **VAD 誤検知起因** | 発話区切りが正しく検出されているか (`translation-pipeline-design.md` §4.5) を確認 | OpenAI サーバ側 VAD の挙動確認、必要なら `session.close` のタイミング調整 |
| **ambient passthrough 設定起因** (S5 FAIL の場合) | `apps/mobile/src/lib/livekit/audio-routing.ts` の passthrough 比率 (30%) と ducking タイミングを確認 | passthrough 比率の調整 |

#### ステップ 2: 言語ペアの緊急対処

FAIL 言語ペアで Apple 提出期限まで改善が間に合わない場合:

1. 該当言語ペアを **Phase 1a スコープから除外** し、`packages/shared-kernel/src/languages.ts` の `SUPPORTED_OUTPUT_LANGUAGES` リストから一時的に削除
2. UI の言語選択画面で該当言語に `non-recommended` バッジを表示 (`@trancall/ui-kit` の `LanguagePicker` に `badge` prop を追加)
3. App Store の「対応言語一覧」から除外してスクリーンショット・説明文を更新
4. `docs/app-store-submission.md` §10 (App Review note) を更新して除外理由を説明

#### ステップ 3: FAIL 原因の記録

```markdown
# FAIL 記録テンプレート

**日時**: YYYY-MM-DD
**FAIL 言語ペア**: {source}-{target}
**FAIL シナリオ**: S{N}
**平均スコア**: {X.X}
**原因分類**: OpenAI API 起因 / TranCall 前処理起因 / VAD 起因 / ambient passthrough 起因
**具体的な問題**: (ターン番号と問題の詳細)
**対処方針**: スコープ除外 / 次スプリントで修正
**担当エンジニア**: <name>
**解決目標スプリント**: Sprint {N}
```

### 10.2 主要 4 ペア FAIL 時のエスカレーション

主要 4 ペア (ja-en / en-ja / ja-zh / zh-ja) のいずれかが FAIL の場合:

1. **即時**: PM・エンジニアリードへの報告。TestFlight β 配信および App Store 提出を凍結
2. **24 時間以内**: 原因切り分け完了 (§10.1 ステップ 1)
3. **72 時間以内**: 修正実装またはスコープ見直し案の提示
4. **1 週間以内**: 再 QA 実施と結果報告

### 10.3 安全性 (軸 S) スコア 1 が検出された場合

安全性スコア 1 (不適切語の挿入等) が検出された場合は翻訳品質 QA 全体を即時停止し、以下を実施:

1. 問題のターンの録音ファイルを保全
2. `translation-pipeline-design.md` §10.1 の `TRANSLATION_SAFETY_STOP` (content_filter) が誤発火または未発火だったかを確認
3. OpenAI API の `error.type = "content_filter"` / `"safety"` のハンドリングを再確認
4. 再現テストを実施して修正を確認してから QA を再開

---

## 11. 自動化検討 (BLEU / COMET / 人間評価併用)

### 11.1 Phase 1a での方針: 人間評価必須

Phase 1a (Sprint 3 末) の翻訳品質 QA は **人間評価必須** とする。以下の理由による:

- GPT-Realtime-Translate は音声→音声の翻訳であり、テキスト翻訳メトリック (BLEU/COMET) を直接適用するには音声認識 (ASR) によるテキスト化が必要で、ASR の誤差が評価に混入する
- 流暢性 (音声の自然さ・イントネーション) は現状の自動メトリックでは測定困難
- 言語別固有の評価観点 (§6 の敬語・格変化等) を自動化するには言語特化モデルが必要

### 11.2 Phase 1c 以降の自動化ロードマップ

| フェーズ | 自動化内容 | 使用ツール・手法 |
|---|---|---|
| **Phase 1c** | テキスト翻訳品質の自動評価 (ASR でテキスト化後) | **BLEU** (n-gram precision-based、業界標準)、**COMET** (Neural MT metric、人間評価との相関高) |
| **Phase 2** | 音声品質の自動評価 | **WER** (Word Error Rate: 音声認識精度)、MOS (Mean Opinion Score) の予測モデル |
| **Phase 2** | レイテンシ自動計測との統合 | `production-runbook.md` v1.3 §15 の Gate Check スクリプトに翻訳品質スコアを追加 |
| **Phase 3** | 継続的品質モニタリング | 本番通話のサンプル (匿名化・同意取得済) を用いた定期評価バッチ |

### 11.3 BLEU / COMET の適用設計 (Phase 1c 参考)

```typescript
// Phase 1c 以降の自動評価スクリプト設計 (参考)

interface AutoEvalConfig {
  // 音声 → テキスト変換 (ASR)
  asrModel: "openai-whisper-large-v3";  // 高精度 ASR を使用
  
  // テキスト翻訳品質スコア
  metrics: {
    bleu: boolean;       // sacrebleu ライブラリ使用
    comet: boolean;      // Unbabel COMET モデル使用
    chrF: boolean;       // 文字 n-gram F-score (形態素豊富な言語向け)
  };
  
  // 評価言語ペア
  languagePairs: Array<{ source: string; target: string }>;
  
  // 参照翻訳 (リファレンス)
  referenceTranslations: Record<string, string[]>;  // ターン ID → 期待翻訳配列
}
```

**OpenAI API への自動評価 API 統合**: 将来 OpenAI が翻訳品質の自動評価エンドポイントを提供した場合、即時に組み込む。Phase 1a 時点では未提供のため手動評価で代替。

### 11.4 人間評価と自動評価の併用指針

Phase 1c 以降で両方を実施する場合:

| ケース | 判断方法 |
|---|---|
| 自動スコア (COMET) ≥ 0.80 かつ人間評価 ≥ 4.0 | 自動評価を信頼して人間評価の頻度を下げる |
| 自動スコアと人間評価に乖離 (差 ≥ 0.5) | 人間評価を優先。自動評価モデルのキャリブレーションが必要 |
| 新規言語ペア追加時 | 最初の 3 回は必ず人間評価を実施し、自動評価との相関を確認 |

---

## 12. Apple App Review note 用エビデンス

### 12.1 翻訳品質 QA 結果の App Review note への添付

`docs/app-store-submission.md` v1.2 §10.1 (App Review note) の翻訳機能説明に、QA 結果サマリーを添付する。これにより Apple Review チームに「翻訳品質の保証がなされていること」を訴求する。

### 12.2 添付エビデンス一覧

| エビデンス | 内容 | 形式 | 準備担当 |
|---|---|---|---|
| **QA 結果サマリー** | §9 の合否判定マトリクス全体 (13 言語 × 5 シナリオ) を PDF 化 | A4 PDF 1-2 ページ | QA |
| **主要 4 ペア録音サンプル** | ja-en / en-ja / ja-zh / zh-ja の S1 シナリオ代表 5 ターン分の録音 (.wav、各 30 秒以内) | .wav × 4 ペア × 5 ターン = 20 ファイル (zip 圧縮) | QA |
| **評価者プロフィール** | 各言語のネイティブ評価者の言語能力 (国籍・母語・在住歴) を 1 ページで要約 | PDF 1 ページ | PM |
| **実施日時・環境** | QA 実施日時、staging 環境バージョン、iOS 実機型番 | テキスト (App Review note 本文に記載) | QA |

### 12.3 App Review note 追記テンプレート (Section 6: Translation Quality)

App Review note §10.1 に追加するセクション (英語):

```
**Section 6: Translation Quality Assurance**

TranCall uses OpenAI Realtime Translation API (model: gpt-realtime-translate) to 
provide real-time voice translation across 13 output languages.

Prior to App Store submission, we conducted a comprehensive translation quality QA 
review covering all 13 output languages × 5 test scenarios = 65 test cases, 
evaluated by native speakers for each target language.

Key results:
- Primary language pairs (ja-en, en-ja, ja-zh, zh-ja): All PASS (avg. score ≥ 3.5/5.0)
- Evaluation criteria: Accuracy (30%), Fluency (25%), Context Retention (20%), 
  Latency (15%), Safety (10%)
- Safety validation: Zero instances of inappropriate content insertion or removal 
  across 650 evaluated utterances
- QA reports are available upon request (TRANS-QA-001 v1.0)

The translation voice uses OpenAI's dynamic voice adaptation which automatically 
adapts the voice characteristics to the target language's natural prosody.
```

### 12.4 エビデンス提出タイミング

| タイミング | アクション |
|---|---|
| Sprint 3 末 QA 完了直後 | `docs/audit-reports/qa-YYYY-MM-DD.md` を生成 |
| App Store Connect 提出 1 週間前 | QA 結果 PDF + 録音サンプル zip を準備 |
| App Store Connect 提出時 | App Review note の Section 6 にサマリーを記載 |
| Apple から追加情報要求時 | 評価者プロフィール PDF + 全録音ファイルを提出 |

---

## 13. 改訂履歴

| バージョン | 日付 | 変更内容 |
|---|---|---|
| v1.0 | 2026-05-12 | Sprint 2 R1 補追 (D-4 TODO 対応) として新規作成。スコープ: 評価指標 5 軸 (正確性 30% / 流暢性 25% / 文脈保持 20% / レイテンシ 15% / 安全性 10%) + テストケース 65 (13 言語 × 5 シナリオ) + 言語別追加観点 (ja 敬語・主語省略 / zh 簡体字優先 / ko 敬語階層 / hi Hinglish / ru 格変化 / de 名詞の性) + 採点 5 段階 (PASS ≥ 3.5 / CONDITIONAL_PASS 3.0-3.49 / FAIL < 3.0) + 合否マトリクステンプレ + 実施手順 7-10 日 + リジェクト時対応フロー + 自動化検討 (BLEU/COMET/WER、Phase 1c 以降) + Apple App Review note 連携 (Section 6 追記テンプレ)。Apple 提出基準: 主要 4 ペア (ja-en / en-ja / ja-zh / zh-ja) が全て PASS。Phase 1a は人間評価必須、Phase 1c で自動化検討。S5 (同一言語発話混入) は `architecture.md` §5.5 ambient passthrough との連動確認を含む。PERF-002 Gate Check (`production-runbook.md` v1.3 §15) とレイテンシ評価軸を連動させる設計を明示。 |
