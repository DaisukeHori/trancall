# TranCall サポート導線設計書

| 項目 | 内容 |
|------|------|
| ドキュメント ID | SUPPORT-FLOW-001 |
| Status | Draft v1.1 (2026-05-12) |
| Sprint | Sprint 2 R1 補追 (C-12 TODO 対応) |
| 上位文書 | `docs/architecture.md` §8 / `docs/legal-and-consent.md` v1.2 / `docs/account-deletion.md` |
| 関連文書 | `docs/billing-ui-flow.md` v1.3 (プラン管理 UI) / `docs/native-call-bridge.md` v1.4 / `docs/app-store-submission.md` v1.2 |
| 下位実装対象 | `apps/mobile/src/screens/support-screen.tsx` (新規) / `apps/mobile/src/screens/faq-screen.tsx` (新規) / `apps/mobile/src/screens/oss-licenses-screen.tsx` (新規) / `apps/server/src/routes/support.ts` (新規) |
| 想定読者 | Sprint 3 で Settings → お問い合わせ画面実装 + サポート運用開始する engineer + PM |

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [用語と前提](#2-用語と前提)
3. [サポート方針 (SLA / 対応範囲)](#3-サポート方針-sla--対応範囲)
4. [Settings → お問い合わせ画面 UI Wireframe](#4-settings--お問い合わせ画面-ui-wireframe)
5. [お問い合わせ送信フロー](#5-お問い合わせ送信フロー)
6. [Zod スキーマ + API endpoint](#6-zod-スキーマ--api-endpoint)
7. [メール送信 backend (Resend)](#7-メール送信-backend-resend)
8. [FAQ 画面 (アプリ内 + Web)](#8-faq-画面-アプリ内--web)
9. [OSS ライセンス表示 (Settings → OSS Licenses)](#9-oss-ライセンス表示-settings--oss-licenses)
10. [ステータスページ連携 (status.trancall.app)](#10-ステータスページ連携-statustrancallapp)
11. [Apple App Review note との連携](#11-apple-app-review-note-との連携)
12. [テスト戦略](#12-テスト戦略)
13. [改訂履歴](#13-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の目的

本書は Sprint 2 R1 補追タスク **C-12 (サポート導線)** の canonical 設計書である。`docs/architecture.md` §8 (D6) §11 でサポート連絡先の必要性のみ言及されていた領域を設計として具体化する。

Sprint 3 で以下を実装する engineer + PM が、本書 1 冊で必要な情報を得られることを目標とする:

- 実装担当 engineer: §4 (Wireframe)・§5 (フロー)・§6 (Zod + API)・§7 (backend)・§12 (テスト)
- 運用担当 PM: §3 (SLA)・§8 (FAQ)・§10 (ステータスページ)
- App Store 提出担当: §11 (Apple Review note 連携)

### 1.2 本書がカバーする範囲

- サポート方針 + SLA (連絡先メール / 初回応答時間 / 対応範囲 / 対応外)
- Settings → お問い合わせ画面 UI wireframe (全セクション)
- お問い合わせ送信フロー (mobile → server → Resend → support@trancall.app)
- Zod スキーマ `SupportInquirySchema` + API endpoint `POST /api/support/inquiry`
- メール送信 backend (Resend 採用理由 + SES / SendGrid との比較)
- FAQ 画面 — アプリ内 (`faq-screen.tsx`) + Web ミラー (`https://trancall.app/faq`)、ja/en/zh
- OSS ライセンス表示 — `oss-licenses-screen.tsx` + 自動生成スクリプト
- ステータスページ連携 — `status.trancall.app` (BetterStack 採用) + Sentry webhook 連動
- Apple App Review note 連携 (D6 §10 へのサポート URL 追記)
- テスト戦略 (unit / integration / E2E Maestro)

### 1.3 本書がカバーしない範囲

| 除外対象 | 理由 |
|---------|------|
| **退会・データ削除の技術実装** | `docs/account-deletion.md` が canonical |
| **法務文書 (利用規約・プライバシーポリシー) 本文** | `docs/legal-and-consent.md` v1.2 が canonical |
| **App Store 審査提出手続き全般** | `docs/app-store-submission.md` v1.2 が canonical |
| **heartbeat 課金のシーケンス** | `docs/billing-detail.md` が canonical |
| **Push 通知実装** | `docs/notification-detail.md` v1.3 が canonical |
| **CallKit / VoIP Push** | `docs/native-call-bridge.md` v1.4 が canonical |

### 1.4 関連設計書との位置関係

```
docs/requirements.md         Phase 1c 定義 (App Store 公開要件)
docs/architecture.md         §8 モバイルアーキテクチャ / D6 §11 サポート連絡先言及
docs/legal-and-consent.md    利用規約・プライバシーポリシー・同意フロー canonical (D7)
docs/account-deletion.md     退会・データ削除処理 canonical
docs/billing-ui-flow.md      Settings → Subscription 画面 canonical (D5)
docs/app-store-submission.md App Store 審査提出手続き canonical (D6)
docs/design/design-system.md UI canonical (colors / spacing / a11y)
docs/support-flow.md         ★本書 (サポート導線 canonical)
```

---

## 2. 用語と前提

### 2.1 用語定義

| 用語 | 定義 |
|------|------|
| **サポートチケット** | ユーザーからのお問い合わせ 1 件。`POST /api/support/inquiry` の成功レスポンスに含まれる `ticketId` で識別する。 |
| **ticketId** | サーバーが発行するショート ID (`TC-YYYYMMDD-[A-F0-9]{6}` canonical、例: `TC-20260512-A1B2C3`)。メール件名に含め、ユーザーとのやり取りで参照する。 |
| **diagnosticData** | お問い合わせ送信時に mobile が自動収集・添付するデバッグ情報。User ID (匿名化済) / App version / OS / 端末モデル / 送信日時 / ロケール / 直近 7 日の通話数 / プランを含む。 |
| **SLA** | Service Level Agreement。本書ではサポートへの初回応答時間の目標値を指す。 |
| **Resend** | Sprint 3 で採用するトランザクションメール送信サービス。`resend.com`。TS native SDK を提供。 |
| **BetterStack** | ステータスページ + Uptime 監視 SaaS (`betterstack.com`)。Sentry からの webhook を受け取り、インシデントを自動投稿する。 |
| **FAQ** | Frequently Asked Questions。アプリ内ローカル表示 + Web ミラーの 2 形態で提供する。 |
| **OSS ライセンス** | アプリが利用するオープンソースライブラリのライセンス情報。App Store 公開要件 (Apple Developer Program Agreement 5.1.2 等) として表示が必要。 |
| **ステータスページ** | `status.trancall.app` で公開するサービス死活・インシデント情報ページ。 |

### 2.2 前提

1. **Zod v4** を使用する (`z.iso.datetime()` / `z.url()` / `z.uuid()` 等の v4 API)。
2. **UserIdSchema** / **PlanTier** は `@trancall/shared-kernel` / `@trancall/billing/schemas` から import する。
3. `POST /api/support/inquiry` は Bearer token 認証必須。ログイン済みユーザーのみ送信可。
4. メール送信は **Resend** (採用確定)。SES / SendGrid は代替候補として本書 §7 に記録するが、Sprint 3 では Resend を実装する。
5. UI は `@trancall/ui-kit` の tokens を必ず参照し、`docs/design/design-system.md` に準拠する。
6. i18n 文言は `@trancall/ui-kit/src/i18n/locales/{ja,en,zh}.json` を canonical とし、画面内直書きは禁止。
7. `support@trancall.app` は Sprint 3 で取得する。ドメイン `trancall.app` は既存の前提。

---

## 3. サポート方針 (SLA / 対応範囲)

### 3.1 連絡先

| 項目 | 値 |
|------|-----|
| サポートメールアドレス | `support@trancall.app` |
| 運用者 | 堀大輔 (Sprint 3 開始時点から運用開始) |
| 送信元 (bot) | `support-bot@trancall.app` (DKIM / SPF 設定済、Resend 経由) |
| サポートページ | `https://trancall.app/support` (Sprint 3 で公開) |
| FAQ ページ | `https://trancall.app/faq` (Sprint 3 で公開) |
| ステータスページ | `https://status.trancall.app` (Sprint 3 で公開) |

### 3.2 SLA (初回応答時間目標)

| 優先度 | 対象 | 初回応答目標 |
|--------|------|-------------|
| **緊急** | 通話不可 (重大バグ) / 課金トラブル (二重請求等) | 24 時間以内 (土日含む) |
| **通常** | 機能の使い方・バグ報告・プライバシー問い合わせ | 営業日 2 営業日以内 |
| **低** | 機能要望・その他 | 営業日 5 営業日以内 |

**注意**: SLA は最善努力目標であり、法的保証ではない。Sprint 3 のサービス開始直後は通常優先度の応答が遅延する可能性があることを利用規約に明記する。

### 3.3 対応範囲

以下のカテゴリに対応する:

| カテゴリ (UI 表示値) | 対応内容 |
|---------------------|---------|
| `bug` — バグ報告 | アプリの不具合・クラッシュ・翻訳不正動作 |
| `billing` — 課金・お支払い | 課金エラー・二重請求・返金申請・プラン変更サポート |
| `feature_request` — 機能要望 | 新機能・UX 改善のリクエスト |
| `privacy` — プライバシー | データ取扱いへの質問・同意の取り消し・削除要求 |
| `other` — その他 | 退会サポート・法務 (利用規約・プライバシーポリシー) 問合 |

### 3.4 対応外 (他サービスへ案内)

以下はサポート対象外とし、各社サポートへ案内する:

| 対応外事項 | 案内先 |
|-----------|--------|
| OpenAI 翻訳品質に関する問い合わせ | https://help.openai.com |
| Apple App Store の課金・返金 | https://reportaproblem.apple.com |
| Google Play の課金・返金 | https://support.google.com/googleplay |
| Stripe の請求書・領収書 | https://stripe.com/contact |

---

## 4. Settings → お問い合わせ画面 UI Wireframe

### 4.1 画面遷移

```
Settings (SCR-006)
  └── お問い合わせ (support-screen.tsx)
        ├── よくある質問 (faq-screen.tsx)
        ├── 利用規約 → WebView (https://trancall.app/terms)
        ├── プライバシーポリシー → WebView (https://trancall.app/privacy)
        ├── OSS ライセンス (oss-licenses-screen.tsx)
        └── サービスステータス → WebView (https://status.trancall.app)
```

Settings 画面 (`settings-screen.tsx`) の「お問い合わせ」行 (`settings.aboutSection.contact`) を `onPress` で `support-screen.tsx` にナビゲートする。

### 4.2 Wireframe — support-screen.tsx

```
┌──────────────────────────────────────┐
│ ← Settings / お問い合わせ            │
├──────────────────────────────────────┤
│                                       │
│  ── メールでのお問い合わせ ──         │
│                                       │
│  カテゴリ *                           │
│  ┌────────────────────────────────┐  │
│  │ バグ報告                    ▼  │  │
│  └────────────────────────────────┘  │
│  (バグ報告 / 課金・お支払い / 機能    │
│   要望 / プライバシー / その他)       │
│                                       │
│  件名 (任意)                          │
│  ┌────────────────────────────────┐  │
│  │ 例: 翻訳が途中で止まる          │  │
│  └────────────────────────────────┘  │
│                                       │
│  本文 *                               │
│  ┌────────────────────────────────┐  │
│  │ (マルチラインテキスト)          │  │
│  │ 最大 5,000 文字                 │  │
│  └────────────────────────────────┘  │
│                                       │
│  ⓘ 以下の情報が自動添付されます:     │
│     - ユーザー ID (匿名化済)          │
│     - アプリバージョン               │
│     - OS / 端末モデル                 │
│     - 送信日時                        │
│     - 直近 7 日の通話数              │
│     - ご利用中のプラン               │
│                                       │
│  ┌────────────────────────────────┐  │
│  │            送信する            │  │
│  └────────────────────────────────┘  │
│                                       │
│  ── そのほか ──                      │
│                                       │
│  よくある質問 (FAQ)              ›    │
│  利用規約                        ›    │
│  プライバシーポリシー             ›    │
│  OSS ライセンス                  ›    │
│  サービスステータス               ›    │
│                                       │
└──────────────────────────────────────┘
```

### 4.3 インタラクション仕様

| 要素 | 仕様 |
|------|------|
| カテゴリ | 必須。iOS: `ActionSheet` / Android: `Modal BottomSheet`。デフォルト選択なし (送信ボタン disabled 状態)。 |
| 件名 | 任意。最大 200 文字。`TextInput` `returnKeyType="next"` で本文フォーカスに遷移。 |
| 本文 | 必須。最大 5,000 文字 (文字数カウンタ表示: `0 / 5000`)。`TextInput multiline` `minHeight: 120`。 |
| 自動添付情報 | `InfoBadge` コンポーネント (`@trancall/ui-kit`) で表示。タップ不可。 |
| 送信ボタン | カテゴリ + 本文が入力済みの場合のみ enabled。送信中は `ActivityIndicator`。`Button` コンポーネント使用。 |
| 成功 Toast | 送信完了後、`Toast` コンポーネントで「お問い合わせを受け付けました (チケット ID: TC-XXXX-XXXX)」を 4 秒表示し、前画面に戻る。 |
| エラー Toast | rate limit 超過 / ネットワークエラー時、`Toast` (danger) で原因と対処を表示。 |

### 4.4 アクセシビリティ

- 全 `Pressable` に `accessibilityLabel` + `accessibilityRole="button"` を付与する。
- カテゴリ未選択時の送信ボタンには `accessibilityState={{ disabled: true }}` を設定する。
- 必須フィールドには `accessibilityHint` で必須であることを明示する。
- WCAG 2.1 AA コントラスト 4.5:1 以上 (`docs/design/design-system.md` 準拠)。

---

## 5. お問い合わせ送信フロー

### 5.1 シーケンス図

```
Mobile                     Server                     Resend
  │                           │                          │
  │ POST /api/support/inquiry │                          │
  │ (Bearer token, body)      │                          │
  │──────────────────────────►│                          │
  │                           │ Auth middleware 検証      │
  │                           │ (JWT → userId)            │
  │                           │                          │
  │                           │ Rate limit チェック        │
  │                           │ (5 req/hour/userId)       │
  │                           │                          │
  │                           │ SupportInquirySchema.     │
  │                           │ safeParse(body)           │
  │                           │                          │
  │                           │ ticketId 生成             │
  │                           │ (TC-YYYY-MMDD-XXXX)       │
  │                           │                          │
  │                           │ Resend.emails.send()     │
  │                           │──────────────────────────►
  │                           │                          │ SMTP 送信
  │                           │                          │ support@trancall.app
  │                           │◄─────────────────────────│
  │                           │ { id: "re_..." }         │
  │                           │                          │
  │◄──────────────────────────│                          │
  │ { ok: true, data: {       │                          │
  │   ticketId, estimatedRsp  │                          │
  │ }}                        │                          │
```

### 5.2 エラーハンドリング

| エラー条件 | HTTP status | error code | UI 表示 |
|-----------|-------------|------------|---------|
| 認証切れ | 401 | `AUTH_TOKEN_EXPIRED` | 「セッションが切れました。再ログインしてください。」 |
| rate limit 超過 | 429 | `SUPPORT_RATE_LIMIT_EXCEEDED` | 「送信上限に達しました。1 時間後に再試行してください。」 |
| バリデーション失敗 | 422 | `SUPPORT_INVALID_BODY` | 「入力内容を確認してください。」 |
| Resend 障害 | 503 | `SUPPORT_MAIL_SEND_FAILED` | 「メール送信に失敗しました。しばらくしてから再試行するか、`support@trancall.app` に直接メールをお送りください。」 |
| ネットワークエラー (mobile 側) | — | (fetch reject) | 「接続できません。ネットワークを確認してください。」 |

---

## 6. Zod スキーマ + API endpoint

### 6.1 SupportInquirySchema

```typescript
// apps/server/src/routes/support.ts (Sprint 3 で新規作成)
import { z } from "zod";
// 注: UserIdSchema は server side で JWT から取得するためここでは import 不要
//     PlanTier は @trancall/billing/schemas の export 名 (PlanTierSchema ではない)
import { PlanTier } from "@trancall/billing/schemas";

/**
 * お問い合わせカテゴリ
 * UI 表示ラベルとの対応: billing-ui-flow.md §2 PlanTier と同一ファイルで管理しない
 * (support モジュールは billing モジュールに依存しない — module-contracts.md 参照)
 */
export const SupportCategorySchema = z.enum([
  "bug",             // バグ報告
  "billing",         // 課金・お支払い
  "feature_request", // 機能要望
  "privacy",         // プライバシー
  "other",           // その他
]);
export type SupportCategory = z.infer<typeof SupportCategorySchema>;

/**
 * 診断情報 — mobile が自動収集し送信する。サーバー側では書き換え不可。
 * userId は server 側で JWT から取得した値を使用し、body の値は無視する
 * (なりすまし防止)。
 */
export const DiagnosticDataSchema = z.object({
  appVersion: z.string().max(32),           // "1.0.0"
  osVersion: z.string().max(64),            // "iOS 17.5" / "Android 14"
  deviceModel: z.string().max(128),         // "iPhone 15 Pro" / "Pixel 8"
  submittedAt: z.iso.datetime(),            // クライアント送信日時 (UTC ISO 8601)
  locale: z.string().max(16),              // "ja-JP"
  callHistoryLast7d: z.number().int().nonnegative(), // 直近 7 日の通話数
  subscriptionTier: PlanTier.optional(),  // 未取得時は省略
});
export type DiagnosticData = z.infer<typeof DiagnosticDataSchema>;

/**
 * POST /api/support/inquiry のリクエストボディ
 *
 * - userId は JWT から取得するため、body に含めない
 * - diagnosticData は mobile が収集して送信する (server が上書きしない)
 */
export const SupportInquirySchema = z.object({
  category: SupportCategorySchema,
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
  diagnosticData: DiagnosticDataSchema,
});
export type SupportInquiry = z.infer<typeof SupportInquirySchema>;

/**
 * POST /api/support/inquiry のレスポンス (成功時)
 */
export const SupportInquiryResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    ticketId: z.string(),                 // "TC-YYYYMMDD-[A-F0-9]{6}"、例: "TC-20260512-A1B2C3"
    estimatedResponseHours: z.number(),   // 通常=48, 緊急 (billing) =24, 要望=120
  }),
});
export type SupportInquiryResponse = z.infer<typeof SupportInquiryResponseSchema>;
```

### 6.2 API endpoint 仕様

#### `POST /api/support/inquiry`

| 項目 | 内容 |
|------|------|
| 認証 | Bearer token 必須 (Supabase JWT)。未認証は 401 を返す。 |
| Rate limit | 5 req / hour / userId。超過は 429 `SUPPORT_RATE_LIMIT_EXCEEDED`。 |
| Content-Type | `application/json` |
| リクエストボディ | `SupportInquirySchema` |
| 成功レスポンス | `200 OK` + `SupportInquiryResponseSchema` |
| エラーレスポンス | `{ ok: false, error: { code: string, message: string } }` |

#### `estimatedResponseHours` の計算ロジック

```typescript
function estimateResponseHours(category: SupportCategory): number {
  switch (category) {
    case "billing": return 24;       // 緊急: 24 時間
    case "bug":
    case "privacy":
    case "other":    return 48;      // 通常: 2 営業日
    case "feature_request": return 120; // 低: 5 営業日
  }
}
```

#### ticketId 生成ロジック

```typescript
import { randomBytes } from "node:crypto";

function generateTicketId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, ""); // "20260512"
  const suffix = randomBytes(3).toString("hex").toUpperCase();   // "A1B2C3"
  return `TC-${date}-${suffix}`;
}
// 例: "TC-20260512-A1B2C3"
```

---

## 7. メール送信 backend (Resend)

### 7.1 採用サービス: Resend (確定)

Sprint 3 で **Resend** (`resend.com`) を採用する。

| 比較軸 | Resend | AWS SES | SendGrid |
|-------|--------|---------|----------|
| 無料枠 | 3,000 通/月、API コール 100 req/日 | 62,000 通/月 (EC2 経由) | 100 通/日 |
| TS native SDK | あり (`resend` npm) | なし (AWS SDK v3 経由) | あり (`@sendgrid/mail`) |
| セットアップ難易度 | 低 (DNS 設定 + API key のみ) | 高 (SES sandbox 解除が必要) | 中 |
| Phase 1 送信想定量 | ~数十通/月 | 同左 | 同左 |
| 採用理由 | **無料枠で十分、TS SDK 高品質、DNS 設定のみで完結** |

代替候補 (SES / SendGrid) は送信量が無料枠を超えた時点で再評価する。

### 7.2 DNS 設定 (trancall.app)

Sprint 3 で以下を設定する:

| レコード種別 | ホスト名 | 値 |
|------------|---------|-----|
| TXT (SPF) | `trancall.app` | `"v=spf1 include:amazonses.com ~all"` → Resend の場合 `"v=spf1 include:_spf.resend.com ~all"` |
| CNAME (DKIM) | `resend._domainkey.trancall.app` | Resend ダッシュボードが発行する値 |
| MX (受信) | `trancall.app` | 任意の MX (support@ の受信先を設定) |

### 7.3 メール仕様

| 項目 | 値 |
|------|-----|
| From | `TranCall サポート <support-bot@trancall.app>` |
| Reply-To | ユーザーの登録メールアドレス (JWT から取得した `email`) |
| To | `support@trancall.app` |
| Subject | `[TranCall][{category}] {subject || "件名なし"} - Ticket #{ticketId}` |
| Body | HTML + plain text (下記 §7.4 参照) |

### 7.4 メール本文テンプレート (HTML)

```html
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8" /></head>
<body style="font-family: sans-serif; max-width: 640px; margin: auto; padding: 24px;">
  <h2 style="color: #0A7AFF;">TranCall サポートリクエスト</h2>
  <p><strong>チケット ID:</strong> {{ticketId}}</p>
  <p><strong>カテゴリ:</strong> {{categoryLabel}}</p>
  <p><strong>件名:</strong> {{subject || "（なし）"}}</p>
  <hr />
  <h3>本文</h3>
  <pre style="white-space: pre-wrap; background: #f5f5f5; padding: 16px; border-radius: 8px;">{{body}}</pre>
  <hr />
  <h3>診断情報 (自動添付)</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px;"><strong>User ID (匿名化)</strong></td><td>{{anonymizedUserId}}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>アプリバージョン</strong></td><td>{{appVersion}}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>OS / 端末</strong></td><td>{{osVersion}} / {{deviceModel}}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>送信日時</strong></td><td>{{submittedAt}} (UTC)</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>ロケール</strong></td><td>{{locale}}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>直近 7 日の通話数</strong></td><td>{{callHistoryLast7d}} 件</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>プラン</strong></td><td>{{subscriptionTier || "不明"}}</td></tr>
  </table>
  <hr />
  <p style="color: #999; font-size: 12px;">
    このメールは TranCall アプリから自動送信されました。
    返信すると {{userEmail}} に届きます。
  </p>
</body>
</html>
```

`anonymizedUserId` は userId の SHA-256 ハッシュ先頭 8 文字 (例: `a3f2b1c4`）。メール本文に生の `userId` (UUID) を含めてはならない。

### 7.5 Resend SDK 実装例

```typescript
// apps/server/src/routes/support.ts (抜粋)
import { Resend } from "resend";
import { createHash } from "node:crypto";

const resend = new Resend(process.env["RESEND_API_KEY"]);

async function sendSupportEmail(params: {
  userId: string;
  userEmail: string;
  inquiry: SupportInquiry;
  ticketId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, userEmail, inquiry, ticketId } = params;

  const anonymizedUserId = createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 8);

  const categoryLabel: Record<SupportCategory, string> = {
    bug: "バグ報告",
    billing: "課金・お支払い",
    feature_request: "機能要望",
    privacy: "プライバシー",
    other: "その他",
  };

  const result = await resend.emails.send({
    from: "TranCall サポート <support-bot@trancall.app>",
    replyTo: userEmail,
    to: "support@trancall.app",
    subject: `[TranCall][${categoryLabel[inquiry.category]}] ${inquiry.subject ?? "件名なし"} - Ticket #${ticketId}`,
    html: buildHtmlBody({ ...inquiry, ticketId, anonymizedUserId, userEmail }),
    text: buildTextBody({ ...inquiry, ticketId, anonymizedUserId, userEmail }),
  });

  if (result.error != null) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true };
}
```

---

## 8. FAQ 画面 (アプリ内 + Web)

### 8.1 アプリ内 FAQ (faq-screen.tsx)

新規作成: `apps/mobile/src/screens/faq-screen.tsx`

- `AccordionList` コンポーネント (ui-kit に昇格予定) で Q&A を展開表示する
- 各 FAQ エントリは `apps/mobile/src/data/faq.ts` にローカルデータとして保持する (オフライン対応)
- 言語は `expo-localization` の `locale` に従い ja / en / zh を切り替える
- Markdown テキストは `react-native-markdown-display` でレンダリングする

### 8.2 FAQ 項目一覧

| # | 質問 (ja) | カテゴリ |
|---|-----------|---------|
| 1 | 翻訳通話の使い方 | 使い方 |
| 2 | 翻訳が止まる時の対処 | トラブルシューティング |
| 3 | 課金プランの変更方法 | 課金 |
| 4 | アカウントの削除方法 | アカウント |
| 5 | トランスクリプトの保存期間 | データ |
| 6 | OpenAI への音声送信について | プライバシー |
| 7 | Bluetooth ヘッドセットが動かない時 | トラブルシューティング |
| 8 | 着信が来ない時 (権限確認) | トラブルシューティング |

各 FAQ エントリのデータ型:

```typescript
// apps/mobile/src/data/faq.ts
export interface FaqEntry {
  id: string;
  category: "usage" | "billing" | "account" | "data" | "privacy" | "troubleshoot";
  question: { ja: string; en: string; zh: string };
  answer: { ja: string; en: string; zh: string }; // Markdown 形式
}
```

### 8.3 Web ミラー (https://trancall.app/faq)

- Sprint 3 で `trancall.app/faq` に静的 HTML ページを公開する
- アプリ内の `faq.ts` データと同一コンテンツを使用し、両者の乖離を防ぐ
- 多言語対応: ja (デフォルト) / en / zh (URL クエリパラメータ `?lang=en` 等で切り替え)
- App Store Connect の **Support URL** に `https://trancall.app/support` を設定し、FAQ へのリンクを含める

---

## 9. OSS ライセンス表示 (Settings → OSS Licenses)

### 9.1 目的と要件

Apple Developer Program Agreement §5.1.2 および一般的なオープンソースライセンス (MIT / Apache 2.0 / BSD 等) の要件として、使用するライブラリのライセンス情報をアプリ内で表示する義務がある。

### 9.2 自動生成スクリプト

Sprint 3 で `@trancall/scripts` に以下を組み込む:

```bash
# packages/scripts/package.json (scripts セクションに追加)
# "generate:oss-licenses": "license-checker --json --out ../../packages/ui-kit/assets/oss-licenses.json --excludePrivatePackages"
```

- ツール: `license-checker` (`npm i -D license-checker`)
- 出力先: `packages/ui-kit/assets/oss-licenses.json`
- CI 統合: `pnpm run generate:oss-licenses` を `prebuild` hooks に追加し、ビルドのたびに自動更新する
- `--excludePrivatePackages` で `@trancall/*` 内部パッケージを除外する

生成される JSON の型:

```typescript
// 自動生成される oss-licenses.json の各エントリ
interface OssLicenseEntry {
  licenses: string;      // "MIT" / "Apache-2.0" / "BSD-3-Clause" など
  repository?: string;   // "https://github.com/..."
  description?: string;
  licenseText?: string;  // ライセンス本文全文
}
// { [packageName: string]: OssLicenseEntry }
```

### 9.3 oss-licenses-screen.tsx

新規作成: `apps/mobile/src/screens/oss-licenses-screen.tsx`

- `packages/ui-kit/assets/oss-licenses.json` をバンドルに含めて読み込む
- パッケージ名でソートした `FlatList` を表示する
- 各エントリには `packageName` / `version` / `license` 名 を表示する
- タップで `licenseText` の全文を `Modal` 内 `ScrollView` で表示する
- 検索バー (`TextInput`) でパッケージ名をフィルタリングできるようにする

---

## 10. ステータスページ連携 (status.trancall.app)

### 10.1 採用サービス: BetterStack (確定)

Sprint 3 で **BetterStack** (`betterstack.com`) を採用する。

| 比較軸 | BetterStack | StatusPage (Atlassian) | Cachet (OSS) |
|-------|------------|------------------------|-------------|
| 無料プラン | あり (Uptime Monitor 10 件まで) | なし (有料のみ) | セルフホスト必要 |
| Sentry 連携 | Webhook 受信 → 自動 incident | 同左 | 手動対応 |
| カスタムドメイン | あり (無料プランで対応) | あり | セルフホスト |
| 採用理由 | **無料枠で十分、Sentry webhook 連携が容易** |

### 10.2 BetterStack 設定

Sprint 3 で以下を設定する:

1. BetterStack アカウント作成 + `status.trancall.app` をカスタムドメインとして設定
2. 監視対象 (Monitors) を追加:
   - `https://api.trancall.app/health` — API サーバー死活確認 (1 分間隔)
   - `https://trancall.app` — Web フロント死活確認 (1 分間隔)
3. Sentry → BetterStack webhook 連携:
   - Sentry プロジェクト設定 → Webhooks → BetterStack の `Incoming Webhook URL` を追加
   - `issue.created` / `issue.resolved` イベントをトリガーにする
   - 重大度 `critical` / `error` のアラートのみを転送する (noise 軽減)

### 10.3 インシデント自動投稿フロー

```
Sentry Alert (critical)
  └── BetterStack Incoming Webhook
        └── incident_open イベント
              └── status.trancall.app に「調査中」インシデント自動投稿
                    └── 解決後: Sentry issue.resolved → incident_resolved
```

### 10.4 mobile アプリ内表示

Settings → サービスステータス → `WebView` で `https://status.trancall.app` を表示する。

実装ポイント:
- `expo-web-browser` の `WebBrowser.openBrowserAsync` ではなく、`WebView` (`react-native-webview`) で アプリ内表示する
- ヘッダー (`← Settings / サービスステータス`) をカスタム実装し、OS 標準の外部ブラウザへ遷移させない
- BetterStack のステータスページは HTTPS + モバイル responsive 対応済みのため、追加 CSS 等の調整は不要

---

## 11. Apple App Review note との連携

### 11.1 D6 §10 App Review note への追記

`docs/app-store-submission.md` (D6) §10 で管理している App Review note に、本書 (D9) の着手後、以下を追加する:

> **サポート連絡先**: support@trancall.app
>
> ユーザーがアプリ内の Settings → お問い合わせ からサポートへ連絡できます。バグ報告・課金問題・プライバシー問い合わせ・退会サポートに対応します。

**担当**: D9 (本書) のドラフトレビュー完了後、D6 を更新する。D6 と D9 の Review note 記述が乖離しないよう管理する。

### 11.2 App Store Connect 設定

Sprint 3 で以下を設定する:

| 設定箇所 | 設定値 |
|---------|--------|
| App Information → Support URL | `https://trancall.app/support` |
| App Information → Marketing URL | `https://trancall.app` |
| App Privacy → Privacy Policy URL | `https://trancall.app/privacy` |

Support URL は App Store のアプリ詳細ページに表示され、ユーザーがサポートへアクセスする入口となる。

### 11.3 審査時のサポート確認シナリオ

Apple の審査員が以下を確認する可能性がある:

1. Settings → お問い合わせ が動作すること
2. お問い合わせフォームが送信できること
3. `support@trancall.app` が受信可能であること (デモ用テストアカウントで送信テストを行う)
4. FAQ 画面が表示されること

Sprint 3 での TestFlight 提出前に上記シナリオを手動で検証すること。

---

## 12. テスト戦略

### 12.1 Unit テスト (Vitest)

`apps/server/src/__tests__/support.test.ts` に以下を実装する:

```typescript
describe("SupportInquirySchema", () => {
  it("正常系: 全フィールド有効", () => {
    // category / subject / body / diagnosticData が有効な場合
    // safeParse が ok: true を返すこと
  });

  it("異常系: category が enum 外の値", () => {
    // safeParse が ok: false を返すこと
    // error に category の validation error が含まれること
  });

  it("異常系: body が空文字", () => {
    // min(1) バリデーション違反
  });

  it("異常系: body が 5001 文字超", () => {
    // max(5000) バリデーション違反
  });

  it("異常系: subject が 201 文字超", () => {
    // max(200) バリデーション違反
  });

  it("異常系: diagnosticData.submittedAt が ISO 8601 でない", () => {
    // z.iso.datetime() バリデーション違反
  });

  it("正常系: subject が省略されている", () => {
    // optional field なので ok: true であること
  });

  it("正常系: subscriptionTier が省略されている", () => {
    // optional field なので ok: true であること
  });
});

describe("estimateResponseHours", () => {
  it("billing カテゴリは 24 時間", () => { /* ... */ });
  it("bug カテゴリは 48 時間", () => { /* ... */ });
  it("feature_request カテゴリは 120 時間", () => { /* ... */ });
});

describe("generateTicketId", () => {
  it("フォーマットが TC-YYYYMMDD-XXXXXX であること", () => {
    // 正規表現 /^TC-\d{8}-[A-F0-9]{6}$/ にマッチすること
  });

  it("連続生成で重複しないこと (1000 件)", () => {
    // Set に格納して size を確認
  });
});
```

### 12.2 Integration テスト (Vitest + supertest)

`apps/server/src/__tests__/support.integration.test.ts` に以下を実装する:

```typescript
// Resend SDK をモック化
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "re_mock_id" }, error: null }),
    },
  })),
}));

describe("POST /api/support/inquiry", () => {
  it("正常系: 有効なリクエストで 200 + ticketId を返す", async () => {
    // 有効な JWT + 有効な body で POST
    // { ok: true, data: { ticketId, estimatedResponseHours } } を返すこと
    // Resend.emails.send が 1 度呼ばれること
  });

  it("異常系: 認証なしで 401 を返す", async () => { /* ... */ });

  it("異常系: rate limit 超過で 429 を返す", async () => {
    // 同一 userId で 6 回送信
    // 6 回目で 429 + SUPPORT_RATE_LIMIT_EXCEEDED を返すこと
  });

  it("異常系: Resend エラー時に 503 を返す", async () => {
    // Resend mock を一時的に error を返すよう変更
    // 503 + SUPPORT_MAIL_SEND_FAILED を返すこと
  });

  it("異常系: body が不正で 422 を返す", async () => { /* ... */ });
});
```

### 12.3 E2E テスト (Maestro — Phase 1b)

`apps/mobile/maestro/flows/support-inquiry.yaml` に以下を実装する:

```yaml
appId: tech.hori.trancall
---
# Settings → お問い合わせ → 送信 → success toast
- launchApp
- tapOn: "設定"
- tapOn: "お問い合わせ"
- assertVisible: "メールでのお問い合わせ"
- tapOn: "カテゴリ"
- tapOn: "バグ報告"
- tapOn: "本文"
- inputText: "E2E テスト用送信 - 自動テスト"
- tapOn: "送信する"
- assertVisible: "お問い合わせを受け付けました"
```

### 12.4 テスト実装の優先度

| 優先度 | テスト種別 | 対象 | Sprint |
|--------|----------|------|--------|
| P0 | Unit | SupportInquirySchema 正常系/異常系 | Sprint 3 |
| P0 | Integration | POST /api/support/inquiry → Resend モック | Sprint 3 |
| P1 | E2E Maestro | Settings → 送信 → Toast | Phase 1b |
| P2 | Unit | generateTicketId フォーマット + 重複なし | Sprint 3 |

---

## 13. 改訂履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| v1.0 | 2026-05-12 | Sprint 2 R1 補追 (C-12 TODO 対応) として新規作成。スコープ: サポート方針 + SLA / Settings → お問い合わせ画面 wireframe + インタラクション仕様 / Zod スキーマ (`SupportInquirySchema` / `DiagnosticDataSchema` / `SupportCategorySchema`) + API endpoint `POST /api/support/inquiry` / Resend メール送信 backend / FAQ 画面 (ja/en/zh、アプリ内 + Web ミラー) / OSS ライセンス表示 (`license-checker` 自動生成) / ステータスページ連携 (BetterStack + Sentry webhook) / Apple App Review note 連携 / テスト戦略 (unit + integration + E2E Maestro)。連絡先 `support@trancall.app`、SLA: 緊急 24 時間・通常 2 営業日・要望 5 営業日。 |
| v1.1 | 2026-05-12 | Round 1 軽量レビュー (Opus) 指摘 Critical 1 + Warning 3 を反映。(Critical) §6.2 `PlanTierSchema` → `PlanTier` (実 export 名)、`UserIdSchema` import 削除 (JWT 取得のため不要)。(Warning) `.nonneg()` → `.nonnegative()` に統一 (既存コードベースとの一貫性)。(Warning) `ticketId` フォーマットを §2.1 `TC-2026-0512-A1B2` と §6.2 実装 `TC-YYYYMMDD-[A-F0-9]{6}` で混在していたため canonical を実装側に統一。(Warning) §3.2 SLA 「営業日 24 時間以内」の意味矛盾を「24 時間以内 (土日含む)」に修正、緊急カテゴリは通話不可 (重大バグ) / 課金トラブル に明示。(Suggestion) §7.1 DNS SPF 設定の `amazonses.com` 言及を削除し Resend (`_spf.resend.com`) 単独確定に。 |
