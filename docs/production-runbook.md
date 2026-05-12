# Production 運用 Runbook (D8)

| 項目 | 内容 |
|------|------|
| ドキュメント ID | PROD-RUNBOOK-001 |
| Status | Draft v1.3 (2026-05-12) |
| Sprint | Sprint 2 D8 |
| 上位文書 | `docs/architecture.md` §9/§10 / `docs/deployment-render-dryrun.md` v1.9 (staging canonical、本書で production 拡張) |
| 関連文書 | `docs/security-detail.md` / `docs/notification-detail.md` v1.3 (HMAC) / `docs/translation-pipeline-design.md` v1.5 / `docs/app-store-submission.md` v1.1 / `docs/billing-ui-flow.md` v1.2 / `docs/legal-and-consent.md` (D7) |
| 下位実装対象 | Render Production Worker 設定 / `apps/server/api/index.ts` + `apps/server/vercel.json` / Supabase Prod 環境 / 1Password Production vault / Sentry alert rules / 日次 retention 削除バッチ |
| 想定読者 | Sprint 3-4 で Production 運用する DevOps + on-call |

---

## 目次

1. [スコープと位置付け](#1-スコープと位置付け)
2. [Production 環境概要](#2-production-環境概要)
3. [apps/server/api/index.ts + vercel.json entrypoint 仕様](#3-appsserverapiindexts--vercel-entrypoint-仕様)
4. [Render Production Worker 構築手順](#4-render-production-worker-構築手順)
5. [Supabase Production 構築手順](#5-supabase-production-構築手順)
6. [LiveKit Cloud Production テナント設定](#6-livekit-cloud-production-テナント設定)
7. [APNs Production gateway + FCM Production project](#7-apns-production-gateway--fcm-production-project)
8. [1Password Production vault 構造](#8-1password-production-vault-構造)
9. [HMAC rotation 実行手順](#9-hmac-rotation-実行手順)
10. [日次 retention 削除バッチ](#10-日次-retention-削除バッチ)
11. [Sentry alert ルール + on-call エスカレーション](#11-sentry-alert-ルール--on-call-エスカレーション)
12. [ロールバック判断と手順](#12-ロールバック判断と手順)
13. [デプロイ確認 / smoke test スクリプト](#13-デプロイ確認--smoke-test-スクリプト)
14. [障害対応 runbook](#14-障害対応-runbook)
15. [改訂履歴](#15-改訂履歴)

---

## 1. スコープと位置付け

### 1.1 本書の責務

本書は Sprint 2 D8 として、`docs/deployment-render-dryrun.md` v1.9 (staging canonical、D2) を **Production 環境向けに拡張する** 運用 runbook を canonical 化する。

D2 が「staging dry-run の実行手順」を扱うのに対し、本書は「**本番 (production) 環境の構築・運用・障害対応手順**」を扱う。両書で重複しないよう、staging の手順は D2 に委任し、本書は production 固有の差分と運用手順に集中する。

### 1.2 本書が確定すること

- `apps/server/api/index.ts` + `apps/server/vercel.json` の entrypoint 仕様 (D2 §4.2 で「未確定雛形」とされていた箇所を本書で確定)
- Render Production Worker (D2 staging との差分)
- Supabase Production 環境の構築・migration・backup 設定
- LiveKit Cloud Production テナント設定
- APNs Production gateway / FCM Production project 設定
- 1Password TranCall-Infra-Prod vault 構造
- `TRANCALL_PUSH_HMAC_SECRET` / `TRANCALL_AGENT_HMAC_SECRET` の rotation 実行手順 (24h dual-key)
- 日次 retention 削除バッチ (transcript / consent / external_purchase_tokens)
- Sentry alert 8 ルールと on-call エスカレーション
- ロールバック判断フローチャートと段階的手順
- Production deploy 直後の smoke test スクリプト
- 主要障害シナリオ 6 種の対応手順

### 1.3 本書の非スコープ

| 除外対象 | canonical 参照先 |
|---|---|
| staging dry-run 手順 | `docs/deployment-render-dryrun.md` v1.9 (D2) |
| HMAC 署名・ローテーションの canonical | `docs/notification-detail.md` v1.3 §3 (canonical) / `docs/security-detail.md` §2 (Agent HMAC 形式の参考、rotation 節は未存在) |
| APNs Push payload 構造 | `docs/notification-detail.md` v1.3 §1 / §2 |
| Translation Agent 内部フロー | `docs/translation-pipeline-design.md` v1.5 (D1) |
| heartbeat 課金シーケンス | `docs/billing-detail.md` |
| App Store 提出手続き | `docs/app-store-submission.md` v1.1 (D6) |
| 法務・プライバシーポリシー | `docs/legal-and-consent.md` (D7) |
| Mobile EAS Build / TestFlight | `docs/eas-distribution.md` 等 |
| ホスティング選定の根拠 | `docs/deploy.md` |

### 1.4 D2 との canonical 分担

```
docs/deployment-render-dryrun.md (D2)   = staging canonical
docs/production-runbook.md (本書、D8)   = production canonical
```

両書に記述が必要な共通事項 (env var 一覧、Supabase migration 手順の基本) は D2 を正とし、本書では差分・production 固有の注意点のみを記載する。

---

## 2. Production 環境概要

### 2.1 アーキテクチャ概要図

```
┌─────────────────────────────────────────────────────────────────┐
│ Production Environment                                          │
│                                                                 │
│  [apps/mobile (iOS/Android)]                                    │
│       │ HTTPS (TLS 1.3)               │ WebRTC (DTLS+SRTP)    │
│       ↓                               ↓                        │
│  [Vercel — api.trancall.app]    [LiveKit Cloud — Tokyo]        │
│  apps/server (Fastify + DI)     Prod tenant                    │
│       │ TLS 1.3                      ↑ WebRTC                  │
│       │ HMAC-SHA256                  │                         │
│       ↓ /internal/agent/events       │                         │
│  [Render — trancall-agent-prod]      │                         │
│  translation-agent (Docker)  ────────┘                         │
│       │ TLS 1.3                                                 │
│       ↓                                                         │
│  [OpenAI Realtime Translation API]                              │
│                                                                 │
│  [Supabase — trancall-prod (ap-northeast-1)]                   │
│  DB + Auth + Realtime                                           │
│                                                                 │
│  [Stripe — live mode]   [APNs — Production]   [FCM — Prod]     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 サービス一覧

| サービス | Production 名称 | URL / エンドポイント | 備考 |
|---|---|---|---|
| Vercel (API Server) | `trancall-api-prod` | `https://api.trancall.app` | Region: hnd1 (Tokyo) |
| Render (Translation Agent) | `trancall-agent-prod` | (内部 Worker、HTTP なし) | Region: Singapore (Tokyo 未提供) |
| Supabase | `trancall-prod` | `https://<ref>.supabase.co` | ap-northeast-1 (Tokyo) |
| LiveKit Cloud | `trancall-prod` | `wss://trancall-prod.livekit.cloud` | Region: Tokyo |
| Stripe | — | live mode | `sk_live_...` キー使用 |
| APNs | — | Production gateway | auth key (.p8) 方式 |
| FCM | — | Firebase prod project | HTTP v1 API |
| Sentry | `trancall-prod` | Sentry DSN (prod) | エラー監視 |
| Cloudflare | — | DNS proxy | `api.trancall.app` → Vercel hnd1 |

### 2.3 Production vs Staging の分離サマリ

staging の詳細は D2 §8 を参照。本書では production 固有の相違点のみ列挙する。

| レイヤ | staging (D2) | production (本書) |
|---|---|---|
| Render Worker | `trancall-agent-staging` (Starter $7/月) | `trancall-agent-prod` (Standard $25/月) |
| Vercel Project | `trancall-api-staging` | `trancall-api-prod` |
| Supabase | `trancall-staging` (Free → Pro 移行必須) | `trancall-prod` (Pro $25/月、日次 backup 有効) |
| LiveKit | 兼用可 | 専用 `trancall-prod` project |
| Stripe | test mode | live mode |
| APNs | Development gateway | **Production gateway** |
| FCM | staging Firebase project | production Firebase project |
| Branch | `staging` / `develop` | `main` (タグ付きリリース) |
| Auto-deploy | enabled | **disabled** (手動 promote、§4.3 参照) |
| 1Password Vault | `TranCall-Infra` | `TranCall-Infra-Prod` (別 vault) |
| Sentry | staging project | prod project (alert 有効) |

---

## 3. apps/server/api/index.ts + vercel.json entrypoint 仕様

> **目的**: D2 §4.2 で「未確定雛形 (Sprint 2 Day 1 で動作検証)」「`vercel.json` を先にコミットすると build が module-not-found で失敗する」と警告されていた entrypoint を本書で確定する。Sprint 3 にて `apps/server/api/index.ts` を新設し、同一 PR で `apps/server/vercel.json` をコミットする。

### 3.1 apps/server/api/index.ts

Fastify を Vercel Serverless Function (Node.js runtime) で動かすための serverless adapter entrypoint。

**重要**: `apps/server/src/app.ts` は Sprint 1 (#20) で **`buildApp` 関数** を export する。`apps/server/package.json` は `fastify: "^4.28.1"` を採用しており、**Fastify v4 は `app.handle(req: Request): Promise<Response>` を持たない** (v5 で導入)。よって本書は `@fastify/aws-lambda` 系の serverless adapter ではなく、Vercel が Fastify v4 に推奨する **`serverless-http` ラッパ** 方式を採用する。

```typescript
// apps/server/api/index.ts (Sprint 3 新規)
import serverless from "serverless-http";
import { buildApp } from "../src/app.js";

// Vercel Serverless Function のコールドスタート対策: 同一インスタンス内でアプリをキャッシュ
let cachedHandler: ReturnType<typeof serverless> | null = null;

export default async function handler(req: unknown, res: unknown) {
  if (!cachedHandler) {
    const app = await buildApp({
      logger: { level: process.env["LOG_LEVEL"] ?? "info" },
      // env 検証 (Zod) + DI container 構築は buildApp 内部で実行
    });
    // serverless-http が Fastify の Node http handler を Vercel/Lambda 互換 (req, res) に変換
    cachedHandler = serverless(app.server, { provider: "vercel" });
  }
  return await cachedHandler(req, res);
}

// vercel.json `functions[].runtime` で nodejs20.x 指定済のため
// この config export は不要 (Node.js runtime がデフォルト)
```

**実装上の注意**:
- `buildApp` は `apps/server/src/app.ts` が export する Fastify instance factory。DI container (全 module facade の wire-up) を内包する (Sprint 1 #20 で実装済)
- `cachedHandler` によるインスタンスキャッシュは Vercel Serverless のウォームインスタンス再利用を前提とする。コールドスタート時は毎回 `buildApp` が実行される (約 200-500ms 増加を許容)
- **Fastify v4** では `app.handle(req: Request): Promise<Response>` が存在しないため、`serverless-http` (https://github.com/dougmoscrop/serverless-http) を `apps/server/package.json` の `dependencies` に追加する
- `serverless-http` v3+ で Vercel 互換、`provider: "vercel"` 指定でリクエスト/レスポンス変換が自動
- vercel.json の `functions[].runtime = "nodejs20.x"` で Node.js runtime を指定するため、エントリポイント側の `export const config = { runtime: ... }` は不要
- 将来 Fastify v5 にアップグレードする場合は、`serverless-http` を撤去し `await app.handle(req)` 直接使用に簡略化可能 (Sprint 3 Day 1 Spike で v4 維持を確定)

### 3.2 apps/server/vercel.json

```json
{
  "version": 2,
  "buildCommand": "pnpm --filter @trancall/app-server build",
  "installCommand": "corepack enable && pnpm install --frozen-lockfile",
  "outputDirectory": ".vercel/output",
  "framework": null,
  "functions": {
    "api/index.ts": {
      "runtime": "nodejs20.x",
      "maxDuration": 30
    }
  },
  "regions": ["hnd1"],
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index.ts" }
  ],
  "env": {
    "SUPABASE_URL": "@supabase-url-prod",
    "SUPABASE_SERVICE_ROLE_KEY": "@supabase-service-role-key-prod",
    "//": "SUPABASE_ANON_KEY は Server (Vercel) には不要 — D2 §7 配布マトリクスで Mobile のみと canonical 化",
    "TRANCALL_AGENT_HMAC_SECRET": "@trancall-agent-hmac-secret-prod",
    "TRANCALL_PUSH_HMAC_SECRET": "@trancall-push-hmac-secret-prod",
    "//openai": "OPENAI_API_KEY は Server (Vercel) には不要 — translation-agent (Render) のみが参照",
    "LIVEKIT_URL": "@livekit-url-prod",
    "LIVEKIT_API_KEY": "@livekit-api-key-prod",
    "LIVEKIT_API_SECRET": "@livekit-api-secret-prod",
    "STRIPE_SECRET_KEY": "@stripe-secret-key-prod",
    "STRIPE_WEBHOOK_SECRET": "@stripe-webhook-secret-prod",
    "STRIPE_PRICE_ID_LIGHT": "@stripe-price-id-light-prod",
    "STRIPE_PRICE_ID_STANDARD": "@stripe-price-id-standard-prod",
    "STRIPE_PRICE_ID_BUSINESS": "@stripe-price-id-business-prod",
    "APNS_KEY_ID": "@apns-key-id-prod",
    "APNS_TEAM_ID": "@apns-team-id-prod",
    "APNS_AUTH_KEY": "@apns-auth-key-prod",
    "APNS_BUNDLE_ID": "tech.hori.trancall",
    "FCM_PROJECT_ID": "@fcm-project-id-prod",
    "FCM_SERVICE_ACCOUNT_JSON": "@fcm-service-account-json-prod",
    "INVITE_BASE_URL": "https://trancall.app/invite",
    "ENVIRONMENT": "production",
    "LOG_LEVEL": "info",
    "SENTRY_DSN": "@sentry-dsn-prod"
  }
}
```

**env 変数の登録方法**:

```bash
# Vercel CLI で Production scope に登録 (Interactive)
vercel env add SUPABASE_URL production
# 1Password から値を取得して貼り付け: op item get "supabase-prod" --field password

# または op run でまとめて inject
op run --env-file=./op-prod.env -- vercel env pull .env.production.local
```

`@` prefix の値は Vercel が管理する Secret 参照。Dashboard → Settings → Environment Variables → Production で登録する。

**コミットタイミングの制約**:
- `apps/server/api/index.ts` (実装) と `apps/server/vercel.json` を **必ず同一 PR** でコミットすること
- `vercel.json` を先にコミットすると Vercel build が `api/index.ts` 未存在で失敗する (D2 §13 Known Risk #2 と同じ問題)

### 3.3 Fastify バージョン対応

Sprint 3 Day 1 に以下を Spike として確認する:

1. `apps/server/package.json` の fastify バージョンを確認
2. Fastify v5 以上: `app.handle(req: Request): Promise<Response>` が使えるか確認
3. Fastify v4 (`^4.28.1`) を採用済のため、`serverless-http` を `dependencies` に追加し §3.1 の canonical 実装 (`serverless(app.server, { provider: "vercel" })`) を使用する。Sprint 3 Day 1 Spike は不要 (§3.1 で確定)。Fastify v5 にアップグレードする場合のみ、`serverless-http` を撤去して `app.handle(req)` 直接使用に簡略化する
4. `vercel dev` でローカル 200 確認 → staging → production の順に昇格

---

## 4. Render Production Worker 構築手順

### 4.1 D2 staging との差分一覧

D2 §3 を staging の canonical 手順として参照すること。本書では production 固有の差分のみを列挙する。

| 項目 | staging (D2 §3) | production (本書) |
|---|---|---|
| Service name | `trancall-agent-staging` | `trancall-agent-prod` |
| Plan | Starter ($7/月、512 MB / 0.5 CPU) | **Standard ($25/月、2 GB / 1 CPU)** |
| Region | Singapore | Singapore (Tokyo は Render 未提供) |
| Branch | `staging` / `develop` | `main` |
| Auto-deploy | enabled | **disabled** (手動 deploy のみ) |
| Env Group | `trancall-staging-secrets` | `trancall-prod-secrets` |
| `LOG_LEVEL` | `debug` | `info` |
| `ENVIRONMENT` | `staging` | `production` |
| `AGENT_NAME` | `trancall-translation-agent-staging` | `trancall-translation-agent` |
| `TRANCALL_SERVER_URL` | `https://api-staging.trancall.app` | `https://api.trancall.app` |
| Sentry | optional (未設定可) | **必須** (`SENTRY_DSN` を設定) |
| Health check | Logs に 5 分以内 LiveKit 接続成功ログ | 同 + Sentry `agent_started` event 受信確認 |

### 4.2 render.yaml の production 差分

D2 §3.2 の `render.yaml` を参照し、以下の差分を適用する:

```yaml
# render.yaml の production worker セクション (抜粋、差分のみ)
services:
  - type: worker
    name: trancall-agent-prod
    runtime: docker
    repo: https://github.com/DaisukeHori/trancall
    branch: main
    region: singapore
    plan: standard          # D2 は starter
    dockerfilePath: apps/translation-agent/Dockerfile
    dockerContext: .
    autoDeploy: false       # D2 は true。Production は手動 deploy を強制
    envVars:
      - key: NODE_ENV
        value: production
      - key: ENVIRONMENT
        value: production   # D2 は staging
      - key: LOG_LEVEL
        value: info         # D2 は debug
      - key: AGENT_NAME
        value: trancall-translation-agent
      - key: SENTRY_DSN
        sync: false         # Production は必須 (D2 は optional)
      - fromGroup: trancall-prod-secrets
```

### 4.3 Production deploy 手順 (autoDeploy: false)

Production への deploy は以下の手順で実施する。

```bash
# Step 1: main ブランチにマージ確認
git log --oneline -5

# Step 2: staging で 30 分以上の動作確認 (D2 §9.4 Gate Check 完了済であること)

# Step 3: Render Dashboard → trancall-agent-prod → Manual Deploy
# Dashboard URL: https://dashboard.render.com/worker/<service-id>/deploys
# "Deploy Latest Commit" ボタンをクリック

# Step 4: Logs で起動確認 (5 分以内に以下が出ること)
# [agent] worker started
# [livekit] connected wss://trancall-prod.livekit.cloud
# [sentry] initialized dsn=https://...sentry.io/...

# Step 5: Sentry で agent_started event 受信確認
# Dashboard → trancall-prod project → Issues → Search "agent_started"
```

### 4.4 Production Worker のリソース管理

Standard plan ($25/月) のリソース上限と監視指針:

| リソース | 上限 | 警告閾値 | 対応 |
|---|---|---|---|
| メモリ (RSS) | 2 GB | 1.5 GB (75%) | Sentry alert → Scale up 検討 |
| CPU | 1.0 vCPU | 80% (30 分継続) | Sentry alert → 水平 scale 検討 |
| 同時通話 | 約 40 通話 (Phase 1a 想定) | 30 通話 | 手動 scale out (Render Dashboard) |

> **Phase 1a の水平 scale**: Render Standard plan は 1 worker 固定。Phase 1b で複数 worker への horizontal scaling を検討する。同時通話 30 通話超のアラートが発生したら手動で worker を追加デプロイ。

---

## 5. Supabase Production 構築手順

### 5.1 D2 との差分

D2 §5 を staging の canonical 手順として参照すること。本書は production 固有の差分のみを記載する。

| 項目 | staging (D2 §5) | production (本書) |
|---|---|---|
| Project 名 | `trancall-staging` | `trancall-prod` |
| Plan | Free (Pro は Phase 1b) | **Pro $25/月 (即時移行必須)** |
| Region | ap-northeast-1 (Tokyo) | ap-northeast-1 (Tokyo) |
| Backup | なし (Free tier) | **日次 backup 有効 (Pro 機能)** |
| DB Password | 使い捨て可 | **1Password `TranCall-Infra-Prod` に保管、90 日で rotation** |

### 5.2 Production migration 実行手順

D2 §5.2 の手順を参考に、staging で完全検証済の migration を production に適用する。

```bash
# 前提: staging で全 migration が適用済み、dry-run 出力を 1Password に保存済み

# Step 1: production project に link
supabase link --project-ref <prod-project-ref>

# Step 2: link 先が production であることを必ず確認
cat .supabase/config.toml | grep project_id
# → project_id = "<prod-project-ref>" を確認

# Step 3: migration 状態確認
supabase migration list --linked

# Step 4: dry-run (diff 確認)
supabase db diff --linked --schema public,trancall_auth,trancall_room,trancall_contact,trancall_billing,trancall_transcript,trancall_notification,trancall_event

# Step 5: 差分を目視確認 (DROP/ALTER がないことを確認)

# Step 6: production push (初回は --include-all)
supabase db push --linked --include-all

# Step 7: 適用確認
supabase migration list --linked
```

**Production migration の鉄則**:
- staging で先に試してエラーなしを確認してから production に push (順序厳守)
- push 前に staging の `supabase db diff` 出力を 1Password に保存
- `supabase link` 切替後は必ず `cat .supabase/config.toml | grep project_id` で確認
- production への初回 push は `--include-all` フラグ必須 (D2 §5.2 と同様の理由)

### 5.3 Supabase Pro plan 設定

Production は Free では運用不可。Pro plan ($25/月) に移行後、以下を設定する。

1. **日次 backup の有効化**:
   - Supabase Dashboard → Settings → Backups → Enable Daily Backups
   - Backup retention: 7 日 (Pro plan デフォルト)

2. **Connection pooling (PgBouncer) 設定**:
   - Pool mode: `transaction` (Serverless 環境との相性が良い)
   - `SUPABASE_URL` は `https://<ref>.supabase.co` のまま (Supabase JS クライアント用、Pooler URL は使えない)。**Prisma / pg ドライバを採用する場合のみ** `DATABASE_URL` を別途 env var 化し Pooler URL `postgresql://<ref>-pooler.supabase.co:6543/postgres` を設定する。本書 Sprint 3 は Supabase JS クライアント単独採用前提のため `DATABASE_URL` 不要

3. **Realtime の同時接続数**:
   - Pro plan: 最大 500 同時接続 (Phase 1a では十分)
   - 接続数が 400 を超えたら Sentry alert を設定

### 5.4 RLS 確認 (Production 適用後)

```bash
# RLS が全テーブルで有効になっていることを Dashboard で確認
# Supabase Dashboard → Table Editor → 各テーブル → RLS → Enabled

# または Supabase SQL Editor で確認
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname IN ('trancall_auth','trancall_room','trancall_contact','trancall_billing','trancall_transcript','trancall_notification','trancall_event')
ORDER BY schemaname, tablename;
# rowsecurity = true であること
```

### 5.5 Auth 設定 (Production)

```
Authentication → Providers:
  - Email/Password: 有効、Confirm email ON
  - Google OAuth: Phase 1b で追加
  - Apple OAuth: Phase 1b で追加

Authentication → URL Configuration:
  Site URL: https://trancall.app
  Redirect URLs:
    - trancall://callback           (mobile deeplink)
    - trancall://billing/stripe-success  (Stripe success deeplink)
    - trancall://billing/stripe-cancel   (Stripe cancel deeplink)
    - trancall://billing/external-success  (External Purchase deeplink)
```

---

## 6. LiveKit Cloud Production テナント設定

### 6.1 Production Project 作成

1. LiveKit Cloud Dashboard → New Project
2. Name: `trancall-prod`
3. Region: **Tokyo (Asia-Pacific)**
4. Plan: **Build tier ($50/月、50,000 participant-min/月)** — Production から即時 Build tier を利用。Free tier (5,000 participant-min) は staging でのみ使用

### 6.2 API Key の分離

Production では Server 用と Agent 用の 2 キーを発行する (D2 §6.2 は Phase 1a で単一キーを共通配布としていたが、Production は 2 キー分離を推奨)。

| キー用途 | Render 配布 | Vercel 配布 | 説明 |
|---|---|---|---|
| `trancall-server-prod` | — | ✓ | Token 発行・Room CRUD |
| `trancall-agent-prod` | ✓ | — | Agent の Room join |

漏洩時のローテーション範囲を限定できる (一方が漏洩しても他方に影響しない)。

> **Phase 1a 暫定**: 2 キー分離が難しい場合は、D2 §6.2 と同様に単一キーを共通配布してもよい。Phase 1b で分離する。

### 6.3 Webhook 設定 (Phase 1b)

Phase 1b で以下の webhook を LiveKit Cloud に設定する:

- `room_started` → `https://api.trancall.app/internal/livekit/webhook`
- `room_ended` → 同上
- `participant_joined` / `participant_left` → 同上

HMAC 認証: LiveKit が提供する `LIVEKIT_WEBHOOK_SECRET` を Vercel の env に追加する。

---

## 7. APNs Production gateway + FCM Production project

### 7.1 APNs Production gateway

**D2 との差分**: D2 §2 では APNs を Phase 1b として optional 扱いにしていたが、Production の Phase 1c (App Store 公開) 時点では必須。

#### 7.1.1 auth key 方式 (推奨)

`docs/app-store-submission.md` v1.1 §4 で canonical 化済み。本書は env var の配布のみを記述する。

| 環境変数 | 取得元 | 配布先 |
|---|---|---|
| `APNS_KEY_ID` | Apple Developer → Keys → `.p8` ファイルのキー ID (10 文字英数) | Vercel (Production scope) |
| `APNS_TEAM_ID` | Apple Developer → Membership → Team ID (10 文字英数) | Vercel (Production scope) |
| `APNS_BUNDLE_ID` | `tech.hori.trancall` (固定) | `vercel.json` にハードコード (§3.2) |
| `APNS_AUTH_KEY` | `.p8` ファイルの内容 (PEM 形式、改行を `\n` でエスケープ) | Vercel → Secret として登録 |

> **重要**: APNs auth key (.p8 ファイル) は **1 回しかダウンロードできない**。ダウンロード後は即座に 1Password `TranCall-Infra-Prod` に保存すること。

#### 7.1.2 Production vs Development gateway

| gateway | 環境変数 | 用途 |
|---|---|---|
| Production | `APNS_ENV=production` (または apps/server 側で NODE_ENV 判定) | App Store / TestFlight 外部テスター |
| Sandbox | `APNS_ENV=sandbox` | TestFlight 内部テスター / 開発端末 |

`apps/server/src/adapters/apns.ts` が `process.env["ENVIRONMENT"] === "production"` を判定して gateway を切り替える実装を Sprint 3 で追加する。

### 7.2 FCM Production project

#### 7.2.1 Firebase prod project の作成

1. Firebase Console → Create project: `trancall-prod`
2. Android アプリ登録: `tech.hori.trancall` (bundle ID)
3. サービスアカウントキーの発行:
   - Project Settings → Service accounts → Firebase Admin SDK → Generate new private key
   - JSON ファイルを 1Password `TranCall-Infra-Prod` に保存
   - 内容を Vercel env `FCM_SERVICE_ACCOUNT_JSON` として登録

#### 7.2.2 FCM の配布先

```
FCM_SERVICE_ACCOUNT_JSON → Vercel (Production scope)
FCM_PROJECT_ID → Vercel (Production scope)
```

FCM は Render (Agent) には不要 (Push 送信は Server のみ)。

---

## 8. 1Password Production vault 構造

### 8.1 Vault 命名

| Vault | 用途 |
|---|---|
| `TranCall-Infra` | Staging / 共通 secrets (D2 §2.3 canonical) |
| `TranCall-Infra-Prod` | **Production 専用 secrets (本書 canonical)** |

Production secrets は `TranCall-Infra-Prod` vault に完全に分離する。Staging vault からのコピーペーストは禁止 (環境取り違えのリスク)。

### 8.2 TranCall-Infra-Prod のアイテム一覧

```
TranCall-Infra-Prod/
├── supabase-prod
│   ├── url: https://<ref>.supabase.co
│   ├── anon-key: (公開可、RLS で保護)
│   ├── service-role-key: (Server only, 絶対公開禁止)
│   └── db-password: (90 日で rotation)
│
├── livekit-prod
│   ├── url: wss://trancall-prod.livekit.cloud
│   ├── api-key-server: APIxxxxxxxxxxxx
│   └── api-secret-server: xxxxxxxxxxxxxxxxxx
│   ├── api-key-agent: APIyyyyyyyyyyyy
│   └── api-secret-agent: yyyyyyyyyyyyyyyyyy
│
├── openai-prod
│   └── api-key: sk-proj-xxxx...
│
├── stripe-prod
│   ├── secret-key: sk_live_...
│   ├── webhook-secret: whsec_...
│   ├── price-id-light: price_xxxxx
│   ├── price-id-standard: price_yyyyy
│   └── price-id-business: price_zzzzz
│
├── apns-prod
│   ├── key-id: XXXXXXXXXX (10 文字)
│   ├── team-id: YYYYYYYYYY (10 文字)
│   ├── bundle-id: tech.hori.trancall
│   └── auth-key-p8: -----BEGIN PRIVATE KEY-----\n...
│
├── fcm-prod
│   ├── project-id: trancall-prod
│   └── service-account-json: {...}  (JSON 全体)
│
├── hmac-prod
│   ├── TRANCALL_PUSH_HMAC_SECRET: (64 hex chars、rotation 対象)
│   ├── TRANCALL_PUSH_HMAC_SECRET_NEXT: (rotation 中のみ存在)
│   ├── TRANCALL_PUSH_HMAC_SECRET_PREV: (rotation 後 7 日間保持)
│   ├── TRANCALL_AGENT_HMAC_SECRET: (64 hex chars、rotation 対象)
│   ├── TRANCALL_AGENT_HMAC_SECRET_NEXT: (rotation 中のみ存在)
│   └── TRANCALL_AGENT_HMAC_SECRET_PREV: (rotation 後 7 日間保持)
│
└── sentry-prod
    └── dsn: https://xxxxxxxx@o.ingest.sentry.io/xxxxxxx
```

### 8.3 アクセス権限

- **アクセス可能なメンバー**: Production vault は Owner (堀) + DevOps on-call のみ
- **共有方針**: Sprint 3-4 の on-call メンバーに必要なアイテムのみ共有リンクで渡す (vault 全体を共有しない)
- **コマンドライン利用**:
  ```bash
  # 1Password CLI で値を安全に取得
  op item get "hmac-prod" --field "TRANCALL_PUSH_HMAC_SECRET" --vault "TranCall-Infra-Prod"

  # シェルヒストリ漏洩防止: 行頭スペースで実行
   op item get "hmac-prod" --field "TRANCALL_PUSH_HMAC_SECRET" --vault "TranCall-Infra-Prod"
  ```

---

## 9. HMAC rotation 実行手順

`docs/notification-detail.md` v1.3 §3.1 の HMAC rotation 方針と `docs/security-detail.md` §2 の HMAC 設計を受けて、本書では **実行 runbook** を canonical 化する。

### 9.1 対象 HMAC secret

| 環境変数 | 用途 | 配布先 |
|---|---|---|
| `TRANCALL_PUSH_HMAC_SECRET` | iOS VoIP Push payload 署名 (Server → Mobile) | Vercel (Production) + Mobile (EAS Secrets) |
| `TRANCALL_AGENT_HMAC_SECRET` | Agent ↔ Server 内部 API 認証 | Vercel (Production) + Render (trancall-agent-prod) |

### 9.2 rotation 頻度と契機

| 契機 | 推奨対応 |
|---|---|
| **定期 rotation** | 90 日ごと (1Password の "Last Rotated" メモで管理) |
| **漏洩疑い** | 即時 rotation (手順を最速で実施、24h dual-key なしで即切替) |
| **担当者退職** | 退職日に rotation 実施 |
| **Sentry alert `hmac_verification_failed` 急増** | rotation 失敗の可能性、§14.4 に従い調査 |

### 9.3 TRANCALL_PUSH_HMAC_SECRET rotation 手順

#### Phase 1: 新鍵生成と準備

```bash
# Step 1: 新鍵生成 (32 bytes = 64 hex chars)
NEW_PUSH_SECRET=$(openssl rand -hex 32)
echo "新鍵: ${NEW_PUSH_SECRET}"  # 確認用 (ヒストリに残る場合は行頭スペース推奨)

# Step 2: 1Password に保存
op item edit "hmac-prod" \
  "TRANCALL_PUSH_HMAC_SECRET_NEXT=${NEW_PUSH_SECRET}" \
  --vault "TranCall-Infra-Prod"

# Step 3: 現在の TRANCALL_PUSH_HMAC_SECRET を PREV に退避
CURRENT_SECRET=$(op item get "hmac-prod" --field "TRANCALL_PUSH_HMAC_SECRET" --vault "TranCall-Infra-Prod")
op item edit "hmac-prod" \
  "TRANCALL_PUSH_HMAC_SECRET_PREV=${CURRENT_SECRET}" \
  --vault "TranCall-Infra-Prod"
```

#### Phase 2: Server 側への配布

```bash
# Step 4: Vercel に NEXT を追加
vercel env add TRANCALL_PUSH_HMAC_SECRET_NEXT production
# プロンプトに NEW_PUSH_SECRET を入力

# Step 5: Vercel を redeploy して NEXT が有効化されることを確認
# Vercel Dashboard → trancall-api-prod → Deployments → Redeploy
```

#### Phase 3: Mobile への配布

```bash
# Step 6: EAS Secrets に NEXT を追加 (次回 EAS Build 時に組み込まれる)
eas secret:push --scope project --env-file .env.production
# .env.production に TRANCALL_PUSH_HMAC_SECRET_NEXT=<新鍵> を追記して実行

# Step 7: EAS Build を実施し、TestFlight 内部テスター に配信
# 内部テスターが新鍵での HMAC 検証が通ることを確認
```

#### Phase 4: 24h dual-key 期間 (切替待機)

`docs/notification-detail.md` v1.3 §3.1 の通り、Mobile が PREV → NEXT の順に試行する 24h dual-accept 期間を設ける。Server 側は `TRANCALL_PUSH_HMAC_SECRET` (旧鍵) と `TRANCALL_PUSH_HMAC_SECRET_NEXT` (新鍵) の両方を検証可能にする必要がある。

`apps/server/src/adapters/push.ts` に dual-key accept のロジックを Sprint 3 で実装すること (片方が失敗したら他方で再試行)。

24h 経過後、Sentry で `hmac_verification_failed` が増加していないことを確認してから Phase 5 に進む。

#### Phase 5: 切替完了

```bash
# Step 8: 24h 経過後、新鍵を PRIMARY に昇格
# ※ NEW_PUSH_SECRET は Phase 1 と別セッションのため再取得が必要
NEW_PUSH_SECRET=$(op item get "hmac-prod" --field "TRANCALL_PUSH_HMAC_SECRET_NEXT" --vault "TranCall-Infra-Prod")
op item edit "hmac-prod" \
  "TRANCALL_PUSH_HMAC_SECRET=${NEW_PUSH_SECRET}" \
  --vault "TranCall-Infra-Prod"
op item edit "hmac-prod" \
  --remove-field "TRANCALL_PUSH_HMAC_SECRET_NEXT" \
  --vault "TranCall-Infra-Prod"

# Step 9: Vercel の TRANCALL_PUSH_HMAC_SECRET を新鍵に更新
vercel env rm TRANCALL_PUSH_HMAC_SECRET production --yes
vercel env add TRANCALL_PUSH_HMAC_SECRET production
# プロンプトに新鍵を入力

# Step 10: NEXT を Vercel から削除
vercel env rm TRANCALL_PUSH_HMAC_SECRET_NEXT production --yes

# Step 11: Vercel redeploy
# (Deployment を trigger: Vercel Dashboard → Redeploy または `git commit --allow-empty && git push`)
```

#### Phase 6: PREV の削除 (7 日後)

```bash
# Step 12: 7 日後、PREV を 1Password から削除
op item edit "hmac-prod" \
  --remove-field "TRANCALL_PUSH_HMAC_SECRET_PREV" \
  --vault "TranCall-Infra-Prod"
```

注: §9.3 全体で `op item` の field 削除は `--remove-field` 形式に統一する (`op item delete-field` は旧記法、`op item edit --remove-field` に統一)。

### 9.4 TRANCALL_AGENT_HMAC_SECRET rotation 手順

Agent HMAC は Mobile への配布が不要な点が PUSH HMAC との主な差分。手順は §9.3 と同様だが、Phase 3 (Mobile EAS Build) はスキップする。

```
Phase 1: 新鍵生成 + 1Password 保存 (同手順)
Phase 2: Vercel に NEXT を追加 + redeploy
Phase 2b: Render の Env Group に NEXT を追加 + redeploy (trancall-agent-prod)
Phase 4: 24h dual-key 期間 (Server と Agent 双方が PREV/NEXT を試行)
Phase 5: 新鍵を PRIMARY に昇格 (Vercel + Render 両方を更新)
Phase 6: PREV の削除 (7 日後)
```

**重要**: Agent (Render) と Server (Vercel) は **同じ HMAC secret を共有**しているため、両方の更新が完了してから redeployすること。片方だけ更新すると `/internal/agent/events` が 401 を返し始める。

### 9.5 rotation 中の監視

- Sentry alert `hmac_verification_failed`: rotation 失敗の早期検知
- rotation 実施を Slack `#trancall-ops` に事前告知 (rotation 開始の 1h 前)
- rotation 後 1h は Sentry / Vercel / Render のログを監視

---

## 10. 日次 retention 削除バッチ

`docs/architecture.md` §6.2 の `trancall_transcript.segments.retention_until` と `docs/billing-ui-flow.md` v1.2 §15.3 の `external_purchase_tokens.expires_at` と整合する削除バッチを canonical 化する。

### 10.1 削除対象テーブルと条件

| テーブル | 削除条件 | 理由 |
|---|---|---|
| `trancall_transcript.segments` | `retention_until < now()` | プラン別保持期間超過 (Free=7日/Light=30日/Standard=90日/Business=365日) |
| `trancall_transcript.transcript_access` | `deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL '30 days'` | 退会 grace period (30日) 経過後の論理削除行を物理削除 |
| `trancall_billing.external_purchase_tokens` | `expires_at < now()` | TTL 切れ redirectToken (TTL=5分、§15.3 の設計通り) |
| `trancall_auth.consent_versions` (旧バージョン記録) | `created_at < now() - INTERVAL '5 years'` | 法定保管期間 (5年) 経過後の物理削除 |

> **注意**: `segments` の削除は `retention_until` が過去になった行のみ。`transcript_access.deleted_at` が NULL の行 (アクティブなアクセス) は対象外。

### 10.2 実装

#### 方針: Supabase Edge Function (推奨) または Render Cron Worker

| 方式 | メリット | デメリット |
|---|---|---|
| Supabase Edge Function | DB と同一 VPC、低レイテンシ | Cold start、execution time 制限 |
| Render Cron Worker (`apps/cron/`) | 柔軟なエラーハンドリング、Sentry 統合容易 | 別 service 追加が必要 |

Sprint 3 では Supabase Edge Function を採用し、実行時間が 30 秒を超える場合は Render Cron Worker に切り替える。

#### Supabase Edge Function の実装スケルトン

```typescript
// supabase/functions/daily-retention-cleanup/index.ts (Sprint 3 新規)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  const results: Record<string, number> = {};
  const errors: string[] = [];

  try {
    // 1. transcript.segments の retention 削除
    const { count: segmentCount, error: segmentError } = await supabase
      .schema("trancall_transcript").from("segments")
      .delete({ count: "exact" })
      .lt("retention_until", new Date().toISOString());
    if (segmentError) errors.push(`segments: ${segmentError.message}`);
    else results.segments = segmentCount ?? 0;

    // 2. transcript_access の物理削除 (grace period 経過)
    const gracePeriodCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: accessCount, error: accessError } = await supabase
      .schema("trancall_transcript").from("transcript_access")
      .delete({ count: "exact" })
      .not("deleted_at", "is", null)
      .lt("deleted_at", gracePeriodCutoff);
    if (accessError) errors.push(`transcript_access: ${accessError.message}`);
    else results.transcript_access = accessCount ?? 0;

    // 3. external_purchase_tokens の TTL 切れ削除
    const { count: tokenCount, error: tokenError } = await supabase
      .schema("trancall_billing").from("external_purchase_tokens")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());
    if (tokenError) errors.push(`external_purchase_tokens: ${tokenError.message}`);
    else results.external_purchase_tokens = tokenCount ?? 0;

    // 4. consent_versions 旧バージョンの 5 年経過後削除 (法定保管期間超過分)
    const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const { count: consentCount, error: consentError } = await supabase
      .schema("trancall_auth").from("consent_versions")
      .delete({ count: "exact" })
      .lt("effective_at", fiveYearsAgo);
    if (consentError) errors.push(`consent_versions: ${consentError.message}`);
    else results.consent_versions = consentCount ?? 0;

    // 5. Sentry に summary report 送信
    // (Sentry SDK の初期化は別途)
    console.log("[retention-cleanup] completed", { results, errors });

    if (errors.length > 0) {
      // Sentry にエラーを report
      throw new Error(`Batch partially failed: ${errors.join(", ")}`);
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200 });
  } catch (err) {
    console.error("[retention-cleanup] failed", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
```

#### Cron スケジュール設定

```toml
# supabase/config.toml に追加 (Sprint 3)
[functions.daily-retention-cleanup]
verify_jwt = false  # 内部 cron からの呼び出し

# Supabase Cron (pg_cron 経由)
# Dashboard → Database → Cron Jobs → New Cron Job
# Schedule: 0 17 * * * (UTC 17:00 = JST 02:00)
# Command: SELECT net.http_post(url := '...', ...) (Supabase Edge Function URL)
```

または Render Cron Worker を使う場合:

```yaml
# render.yaml に追加
services:
  - type: cron
    name: trancall-retention-cron-prod
    runtime: node
    schedule: "0 17 * * *"   # UTC 17:00 = JST 02:00
    buildCommand: pnpm --filter @trancall/cron build
    startCommand: pnpm --filter @trancall/cron run retention
    envVars:
      - fromGroup: trancall-prod-secrets
```

### 10.3 監視

| Alert | 条件 | 理由 |
|---|---|---|
| `retention_batch_failure` | Edge Function / Cron Worker が非 200 で終了 | バッチ失敗の検知 |
| `retention_batch_zero_rows` | 7 日連続で全テーブルの削除件数が 0 | バッチ停止疑い (通常は 1 日でも数件は削除されるはず) |

Sentry の summary report から削除件数を確認する。削除件数が急増した場合は schema migration ミスや billing プラン変更の影響を調査する。

### 10.4 手動再実行

```bash
# バッチ失敗時の手動再実行 (Supabase Edge Function)
curl -X POST "https://<ref>.supabase.co/functions/v1/daily-retention-cleanup" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"

# Render Cron Worker の場合
pnpm --filter @trancall/cron run retention
```

---

## 11. Sentry alert ルール + on-call エスカレーション

### 11.1 Sentry alert ルール一覧

Sentry の `trancall-prod` project に以下の alert を設定する。

| Alert 名 | 条件 | 通知先 | Severity | 備考 |
|---|---|---|---|---|
| `agent_disconnect_high` | translation-agent → OpenAI WS 切断が 1h で 50 件超 | Slack `#on-call` + メール | High | `agent_disconnect_high` は D1 §10.2 の reconnect 失敗を起点とする |
| `hmac_verification_failed` | HMAC 検証失敗が 1h で 100 件超 | Slack `#on-call` + メール | High | HMAC rotation 失敗の可能性。§9.5 参照 |
| `webhook_signature_failed` | Stripe / Apple webhook 署名検証失敗が 1h で 10 件超 | Slack `#on-call` + メール | High | リプレイ攻撃または key 不一致 |
| `audio_publish_error_burst` | LiveKit AudioFrame publish 失敗が 5 連続 | Slack `#on-call` | Medium | D1 §10.3 の `agent_publish_failed` トリガー |
| `consent_required_burst` | `AUTH_CONSENT_REQUIRED` が同一ユーザーで 5 回連続 | Slack `#trancall-ops` のみ | Low | 同意フロー実装バグの可能性 |
| `billing_payment_failed_burst` | `BILLING_PAYMENT_FAILED` が 1h で 30 件超 | Slack `#billing` + メール | Medium | Stripe / Apple IAP 障害疑い |
| `gate_check_p95_breach` | PERF-002 p95 (totalEndToEnd) が 3 秒超え状態が 30 分継続 | Slack `#on-call` | Critical | OpenAI or LiveKit 側の degradation |
| `retention_batch_failure` | 日次削除バッチが失敗 (non-200 レスポンス) | Slack `#on-call` | High | §10.3 参照 |

### 11.2 Sentry alert の設定手順

```
Sentry Dashboard → trancall-prod project → Alerts → Create Alert Rule

例: hmac_verification_failed の設定
  - Alert type: Issue Alert
  - Conditions: 
      "An issue is seen more than 100 times in 1 hour"
      "The issue's tag: error.code equals hmac_verification_failed"
  - Actions:
      Send a Slack notification to #on-call
      Send an email to devops@trancall.app
  - Rate limit: Once per 1 hour (同じ alert の再通知を抑制)
```

### 11.3 on-call エスカレーション

**Phase 1a-1b の簡易体制** (Sprint 3-4 時点):

```
Level 1: Slack #on-call への alert 通知 (自動)
    ↓ 15 分応答なし
Level 2: 堀大輔 (Owner) に Slack DM + SMS (on-call 担当が手動で連絡)
    ↓ 30 分応答なし または Critical alert
Level 3: 該当 PaaS (Render / Vercel / Supabase / LiveKit) のサポートに連絡
```

**Phase 1c 以降** (App Store 公開後): PagerDuty または Opsgenie による正式 on-call ローテーションを導入する。

### 11.4 Sentry Performance Monitoring の設定

```
trancall-prod project → Settings → Performance → Thresholds
  - Apdex: T = 3000ms (PERF-002 p95 基準)
  - Transaction names:
      POST /internal/agent/events  → threshold: 1000ms
      POST /api/rooms              → threshold: 2000ms
      GET /api/auth/profile        → threshold: 500ms
```

---

## 12. ロールバック判断と手順

### 12.1 ロールバック発動基準 (Production)

| 対象 | 発動基準 | 確認方法 |
|---|---|---|
| Vercel (API Server) | 5 分間 5xx 率 > 5%、または `GET /health` が 3 連続失敗 | Vercel Dashboard → Logs / Sentry |
| Render (Translation Agent) | Service が `Crashed` 状態、または Logs に起動ログが 5 分以内に出ない | Render Dashboard → Service → Events |
| Supabase Migration | `supabase db push` がエラー終了、または RLS ポリシー破壊を検知 | Supabase Dashboard → Tables → RLS / SQL diff |
| HMAC 認証 | HMAC 検証失敗が 1 分間に 5 件以上 | Render Logs `level: "error"` フィルタ |
| Production 全停止 | 上記複数が同時発生、ユーザーから通話不可の報告が複数件 | 複数 Dashboard の統合確認 |

### 12.2 ロールバック判断フローチャート

```
[障害検知 (Sentry / ユーザー報告)]
    |
    v
[影響範囲の特定]
    |
    +---(a) 全サービス停止 (API + Agent 両方が応答しない)
    |         |
    |         v
    |    [全体ロールバック] → §12.3.a
    |
    +---(b) translation-agent のみ異常 (API は正常)
    |         |
    |         v
    |    [Render のみロールバック] → §12.3.b
    |
    +---(c) mobile アプリのみクラッシュ (API / Agent は正常)
    |         |
    |         v
    |    [TestFlight 前バージョンに戻す] → §12.3.c
    |
    +---(d) 特定機能のみ異常 (例: HMAC 検証失敗)
              |
              v
         [部分的な緊急対応] → §12.3.d
```

### 12.3 ロールバック手順

#### 12.3.a 全体ロールバック

```bash
# Step 1: Vercel を直前の stable deployment にロールバック
# Vercel Dashboard → trancall-api-prod → Deployments → 直前の deployment → "Promote to Production"
# ダウンタイム: 数秒

# Step 2: Render を直前の commit にロールバック
# Render Dashboard → trancall-agent-prod → Deploys → 直前の Deploy → "Rollback"
# ダウンタイム: 30 秒程度 (自動再起動)

# Step 3: Supabase migration ロールバック (必要な場合のみ)
# → §12.3.a の migration rollback は §12.4 を参照

# Step 4: HMAC secret の整合確認
# Vercel と Render の TRANCALL_AGENT_HMAC_SECRET が一致しているか確認
# (古い deploy が新しい secret を持つ場合は secret を旧値に戻す)
```

#### 12.3.b Render のみロールバック

```bash
# Render Dashboard → trancall-agent-prod → Deploys → 直前の Deploy → "Rollback"

# Mobile に degraded 状態を通知 (§14.1 の対応手順を参照)
# translation.degraded event を Data Channel で配信 (自動: D1 §7.1 の degraded 判定が発火)
```

#### 12.3.c Mobile アプリのみ

```
TestFlight:
  App Store Connect → My Apps → TranCall → TestFlight →
  内部テストグループの「現在のバージョン」を直前の build に手動切り替え

App Store (公開後):
  App Store Connect → My Apps → TranCall → App Store Connect API で
  新バージョンを「開発者削除」した後、前バージョンを最新に昇格
  (Apple の審査なしで即時可、ただし App Store の反映に数時間かかる場合がある)
```

#### 12.3.d 部分的な緊急対応 (特定機能の異常)

```bash
# HMAC 検証失敗の場合: §9.3 rotation 手順を確認し、24h dual-key が正常機能しているか確認
# Stripe Webhook 署名失敗の場合: STRIPE_WEBHOOK_SECRET が Vercel で正しく設定されているか確認
# LiveKit 接続失敗の場合: LiveKit Cloud Status page を確認し、LIVEKIT_URL が正しいか確認
```

### 12.4 Supabase migration ロールバック (危険)

Supabase は migration の自動 down 機能を持たない。migration ロールバックは慎重に実施すること。

```bash
# 方法 1 (推奨): forward fix (新しい migration で修正)
# 問題のある migration の逆方向 SQL を新規ファイルとして作成
touch supabase/migrations/00007_revert_xxx.sql
# 内容を記述してから push
supabase db push --linked

# 方法 2 (最終手段): DB Backup からのリストア
# Supabase Dashboard → Settings → Backups → 直前の backup → Restore
# Pro plan で日次 backup が有効 (§5.3)
# 注意: リストアするとその時点以降の全データが失われる
```

**Production DB ロールバックの判断者**: Owner (堀) のみ。on-call は Owner に連絡してから実施する。

### 12.5 ロールバック後の再デプロイ手順

D2 §10.5 のインシデント対応プロトコルを Production でも適用する。

1. ロールバック直後にインシデント記録: GitHub Discussion `incidents/YYYY-MM-DD-<short>` に状況・rollback 範囲・暫定影響を記録
2. 修正方針が決まるまで `main` への merge を停止 (PR は draft に戻す)
3. 修正コードは新しい feature branch で PR を作成、CI 緑 + reviewer 承認後 `main` merge
4. staging で 30 分連続 OK を確認後、production に手動 promote
5. インシデント記録に rollback → 再デプロイの完了タイムスタンプを追記

---

## 13. デプロイ確認 / smoke test スクリプト

### 13.1 smoke test の目的と実施タイミング

Production deploy (Vercel または Render) の直後に必ず実施する。deploy 後 5 分以内に完了すること。

### 13.2 smoke test 手順

```bash
# smoke test 環境変数の設定 (1Password から取得)
export SMOKE_API_URL="https://api.trancall.app"
export SMOKE_TEST_TOKEN=$(op item get "smoke-test-user" --field "supabase-access-token" --vault "TranCall-Infra-Prod")
export SMOKE_HMAC_SECRET=$(op item get "hmac-prod" --field "TRANCALL_AGENT_HMAC_SECRET" --vault "TranCall-Infra-Prod")
```

#### Step 1: ヘルスチェック

```bash
curl -sf "${SMOKE_API_URL}/health" | jq .
# 期待: {"ok": true}
```

#### Step 2: Auth プロフィール取得

```bash
curl -sf "${SMOKE_API_URL}/api/auth/profile" \
  -H "Authorization: Bearer ${SMOKE_TEST_TOKEN}" | jq .
# 期待: {"user_id": "...", "trancall_id": "@smoke_test_user", ...}
```

#### Step 3: Room 作成 (LiveKit Token 取得)

```bash
curl -sf -X POST "${SMOKE_API_URL}/api/rooms" \
  -H "Authorization: Bearer ${SMOKE_TEST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"inviteeIds": ["00000000-0000-0000-0000-000000000099"]}' | jq .data.roomId  # CreateRoomSchema: { inviteeIds: UserId[] } (room-routes.ts canonical)
# 期待: UUID 形式の roomId が返る
```

#### Step 4: HMAC 内部 API 疎通確認

```bash
BODY='{"type":"agent.metrics","agentJobId":"00000000-0000-0000-0000-000000000001","roomId":"00000000-0000-0000-0000-000000000002","latencyMs":{"captureToAgent":[30],"agentToOpenAI":[10],"openAIFirstDelta":[400],"agentPublish":[15],"totalEndToEnd":[455]},"memoryRssBytes":209715200,"collectedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
IDEMPOTENCY_KEY="smoke-$(date +%s)"
SIGNATURE=$(echo -n "${BODY}|${IDEMPOTENCY_KEY}" | openssl dgst -sha256 -hmac "${SMOKE_HMAC_SECRET}" | awk '{print $2}')

curl -sf -X POST "${SMOKE_API_URL}/internal/agent/events" \
  -H "Content-Type: application/json" \
  -H "x-trancall-agent: trancall-translation-agent" \
  -H "x-trancall-signature: ${SIGNATURE}" \
  -H "x-trancall-idempotency-key: ${IDEMPOTENCY_KEY}" \
  -d "${BODY}" | jq .
# 期待: {"ok": true}
```

#### Step 5: Sentry に smoke_passed event 送信

```bash
# smoke test の成功を Sentry に記録 (Sprint 3 で Sentry SDK を通じた実装に置き換え)
curl -sf -X POST "https://sentry.io/api/0/projects/<org>/<project>/store/" \
  -H "X-Sentry-Auth: Sentry sentry_key=<dsn_key>,sentry_version=7" \
  -H "Content-Type: application/json" \
  -d '{"message": "prod_smoke_passed", "level": "info", "tags": {"env": "production"}}'
```

### 13.3 smoke test スクリプト化 (Sprint 3)

上記の手順は Sprint 3 で `scripts/prod-smoke.sh` または `scripts/prod-smoke.ts` として実装し、CI の deploy ワークフローに組み込む。

```bash
# 実行方法 (Sprint 3 以降)
pnpm --filter @trancall/scripts run prod-smoke
# 5 ステップを順次実行し、失敗したらエラーコードで終了
```

### 13.4 Render Agent の起動確認

Render Dashboard → `trancall-agent-prod` → Logs で以下が 5 分以内に出ることを確認する:

```
[agent] worker started
[livekit] connected wss://trancall-prod.livekit.cloud
[sentry] initialized dsn=https://...sentry.io/...
```

---

## 14. 障害対応 runbook

### 14.1 OpenAI Realtime WS 切断頻発

**検知**: Sentry alert `agent_disconnect_high` (1h で 50 件超の切断)

**対応手順**:

```
1. OpenAI Status page 確認: https://status.openai.com/
   → 障害が報告されている場合: 復旧待ち、ユーザーに degraded 状態を通知

2. 自社インシデントか切り分け:
   - Render Logs で切断のパターンを確認 (特定 roomId / agentJobId に集中しているか)
   - OpenAI API key の quota を確認 (OpenAI Dashboard → Usage → Rate limits)

3. 緩和措置:
   - translation-agent の retry interval を一時的に短縮:
     Render → trancall-agent-prod → Env → OPENAI_WS_RETRY_INTERVAL_MS=1000 (default: 3000ms)
     → Save → Manual Deploy
   - 同時翻訳セッション数を一時的に制限 (将来実装の設定値、Phase 1b)

4. mobile UI への通知:
   - translation.degraded event が Agent から Data Channel 経由で自動配信される (D1 §7.4)
   - 必要に応じて Server 側で全ユーザーへのシステム通知を送信 (Phase 1b の機能)

5. 復旧後:
   - translation.recovered event が Agent から自動配信 (D1 §7.2)
   - Sentry で `agent_disconnect_high` が収束したことを確認
   - OPENAI_WS_RETRY_INTERVAL_MS を元の値に戻す
```

### 14.2 Supabase ダウン

**検知**: `GET /health` 失敗、Sentry で DB 接続エラーが burst

**対応手順**:

```
1. Supabase Status page 確認: https://status.supabase.com/
   → 障害が報告されている場合: Supabase support チケットを起票

2. 影響範囲の確認:
   - DB が完全ダウン: 全 API が 503
   - Realtime のみ: 字幕配信が停止 (通話自体は継続)
   - Auth のみ: 新規ログイン / Token refresh が失敗

3. 緩和措置 (短時間ダウン):
   - mobile に read-only mode を強制 (cached subscription state で動作継続)
   - 新規通話の開始を一時的に無効化 (Server 側の route で 503 を返す緊急 patch)

4. 長時間ダウン (30 分以上):
   - ユーザーへの告知 (App Store の What's New / 外部ステータスページ)
   - Supabase support に緊急対応依頼

5. 復旧後:
   - DB 接続確認: `GET /health` が 200 返却
   - Realtime 接続確認: Supabase Dashboard → Realtime → Connections
   - バックログ同期: 通話中に保存できなかった transcript を再送する仕組みは Phase 1b 以降で実装
```

### 14.3 Vercel デプロイ失敗 (build error)

**検知**: GitHub Actions / Vercel Dashboard の build failure

**対応手順**:

```
1. Vercel Dashboard → trancall-api-prod → Deployments → 失敗した deployment のログを確認

2. よくある失敗原因:
   a. apps/server/api/index.ts のビルドエラー (TypeScript 型エラー)
      → PR をリバートして修正 PR を作成
   b. pnpm install の失敗 (lockfile 不整合)
      → pnpm install --frozen-lockfile でローカル確認後、lockfile を更新して再 push
   c. env var の参照エラー (Secret が未登録)
      → Vercel Dashboard → Settings → Environment Variables で確認

3. 緊急時の直前 deployment への切り替え:
   Vercel Dashboard → Deployments → 直前の stable deployment → "Promote to Production"
   (これにより Production は stable な deployment に戻り、ビルドエラーは修正後に再デプロイ)

4. 修正後の再デプロイ:
   - 修正コードを PR として作成
   - CI (TypeScript チェック + テスト) が緑であることを確認
   - staging deploy で動作確認
   - main merge → 手動 promote (§4.3 参照)。Production の autoDeploy は §2.3 方針通り **disabled** に統一済
     または手動 promote
```

### 14.4 HMAC rotation 中の検証失敗

**検知**: Sentry alert `hmac_verification_failed` (1h で 100 件超)

**対応手順**:

```
1. rotation 中かどうかを確認:
   - 1Password TranCall-Infra-Prod の hmac-prod に
     TRANCALL_PUSH_HMAC_SECRET_NEXT が存在するか確認
   - 存在する場合 → rotation 進行中

2. dual-key accept が機能しているか確認:
   - Vercel の apps/server の push adapter が NEXT 鍵を試行しているか Logs で確認
   - 試行していない場合 → apps/server の dual-key ロジックに不具合あり

3. Mobile の EAS Build が完了しているか確認:
   - EAS Dashboard で最新 build の status を確認
   - TestFlight で内部テスターが NEXT 鍵のアプリを使っているか確認

4. 即時緩和:
   - PREV 鍵が失効していれば TRANCALL_PUSH_HMAC_SECRET_PREV を復活させる
   - Vercel の TRANCALL_PUSH_HMAC_SECRET を旧鍵に戻す (一時的なロールバック)
   - Mobile に告知: HMAC 検証失敗は VoIP Push が来ない状態 (着信不可)

5. 再 rotation:
   - §9.3 の手順を最初からやり直す
```

### 14.5 LiveKit Cloud 障害

**検知**: 全通話で Room 接続が失敗、Sentry で LiveKit 関連エラーが burst

**対応手順**:

```
1. LiveKit Status page 確認: https://status.livekit.io/
   → 障害報告がある場合: 復旧待ち

2. 障害が Tokyo region のみか確認:
   - LiveKit Dashboard → Rooms → region フィルタで確認
   - Tokyo のみなら Singapore fallback を検討 (将来の設定、Phase 1b)

3. 緩和措置 (短時間 < 15 分):
   - アプリ起動時に「サービスメンテナンス中」のバナーを表示 (Server 側の feature flag 経由)
   - 新規通話開始ボタンを disabled にする緊急 patch

4. LiveKit support への連絡:
   https://livekit.io/support (Build tier 以上は priority support)

5. 復旧後:
   - LiveKit Cloud Dashboard で room creation が正常に動くことを確認
   - Sentry の LiveKit 関連エラーが収束したことを確認
   - メンテナンスバナーを解除
```

### 14.6 retention 削除バッチ失敗

**検知**: Sentry alert `retention_batch_failure`

**対応手順**:

```
1. Edge Function / Cron Worker のログ確認:
   - Supabase Dashboard → Functions → daily-retention-cleanup → Logs
   - または Render Dashboard → trancall-retention-cron-prod → Logs

2. よくある失敗原因:
   a. DB 接続エラー: Supabase ダウン → §14.2 対応
   b. Permission エラー: SUPABASE_SERVICE_ROLE_KEY が期限切れまたは誤り → 1Password で確認
   c. Timeout: 削除対象が多すぎて実行時間超過 → バッチを分割実行

3. 手動再実行:
   # §10.4 の手動再実行コマンドを実行
   curl -X POST "https://<ref>.supabase.co/functions/v1/daily-retention-cleanup" \
     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"

4. ユーザーへの影響:
   - 削除遅延のみ (データが残るだけで機能影響なし)
   - 法令上の問題が生じる可能性があるのは consent_versions の 5 年保管超過のみ
     (現実的には数日の遅延は問題なし)

5. 再発防止:
   - timeout が原因の場合: バッチを table 単位に分割して別 cron job に
   - 定期的な削除件数ゼロアラートの設定 (§10.3)
```

---

## 15. Gate Check 合否判定 runbook (PERF-002 計測)

`docs/native-call-bridge.md` v1.4 §11.6 Phase 1a 完了 Gate Check の **PERF-002 (latency p50/p95/p99) 計測手順** を本書で canonical 化する。Phase 1a 完了の絶対条件であり、Sprint 3 終盤に必ず実走する。

### 15.1 計測対象

`docs/requirements.md` §4 PERF-002:
- **p50** ≤ 1.5 秒 (絶対条件)
- **p95** ≤ 3.0 秒 (絶対条件、英日など語順差大ペアは 4.0 秒も許容)
- **p99** ≤ 5.0 秒 (努力目標)

計測対象は `agent_metrics.latency_ms.totalEndToEnd` (mic capture → Callee 再生まで)。`notification-detail.md` v1.3 §1 で確定済の JSONB 構造に従う。

### 15.2 事前準備

- staging 環境を §3-§7 の手順で構築済
- iOS / Android 実機を 1 台ずつ (`docs/native-call-bridge.md` v1.4 §11.3 同等)
- テストアカウント 2 つ (sandbox.tester1, sandbox.tester2)、それぞれ `nativeLanguage: ja / en` で `profiles` に登録済
- `gate-check` 実行用 PC 1 台 (`scripts/gate-check.ts` から Supabase に直接 SQL 発行)

### 15.3 計測手順

```bash
# Step 1: 既存の agent_metrics をクリア (staging のみ)
psql "${SUPABASE_DB_URL_STAGING}" -c \
  "DELETE FROM trancall_event.agent_metrics WHERE created_at < now();"

# Step 2: 計測シナリオを 100 回実行
# - シナリオ A: ja → en の 30 秒通話 (50 回)
# - シナリオ B: en → ja の 30 秒通話 (50 回、語順差大)
# 各通話で:
#   1. sandbox.tester1 (ja) が sandbox.tester2 (en) に発信
#   2. 応答後、自動応答 bot が事前録音した 30s 発話を再生
#   3. 30s 経過で自動終話
#   4. agent_metrics が INSERT されたことを確認

# Step 3: 計測結果を集計
pnpm --filter @trancall/scripts gate-check \
  --env staging \
  --scenarios 100 \
  --output gate-check-report-$(date -u +%Y%m%d).json
```

### 15.4 集計 SQL (Supabase Dashboard で実行)

```sql
-- p50 / p95 / p99 を集計
WITH latencies AS (
  SELECT
    jsonb_array_elements_text(latency_ms->'totalEndToEnd')::int AS latency_ms_value,
    source_lang || '-' || target_lang AS scenario_key  -- scalar concatenation (W-1: 旧 row 型は GROUP BY エラーになるため修正)
  FROM trancall_event.agent_metrics
  WHERE created_at > now() - INTERVAL '6 hours'
)
SELECT
  scenario_key,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms_value) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms_value) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms_value) AS p99_ms,
  count(*) AS sample_size
FROM latencies
GROUP BY scenario_key;
```

### 15.5 合否判定基準

| 判定 | 条件 |
|---|---|
| **PASS** | (a) p50 ≤ 1500ms かつ p95 ≤ 3000ms (ja↔en どちらの方向も)、(b) p99 ≤ 5000ms (努力目標、未達でも PASS だが §15.6 記録)、(c) sample size ≥ 50 (各シナリオ) |
| **CONDITIONAL_PASS** | p95 ≤ 4000ms (英日など語順差大ペア、`source-target` で `en-ja` のみ許容)、p50 ≤ 1500ms 必須 |
| **FAIL** | p50 > 1500ms または p95 > 4000ms (どのシナリオでも)、または sample size < 30 |

### 15.6 記録テンプレ (Gate Check 結果)

```markdown
## Gate Check 結果 — YYYY-MM-DD HH:MM JST

**実施環境**: staging / production 候補
**実施者**: <name>
**サンプル数**: ja-en {N}件、en-ja {N}件
**iOS 実機**: iPhone XX / iOS YY
**Android 実機**: Pixel ZZ / Android WW

### 結果

| シナリオ | p50 | p95 | p99 | サンプル | 判定 |
|---|---|---|---|---|---|
| ja-en | XXX ms | XXX ms | XXX ms | 50 | PASS |
| en-ja | XXX ms | XXX ms | XXX ms | 50 | CONDITIONAL_PASS (p95 = 3.4s、語順差大許容) |

### 結論

[ ] PASS (Phase 1a 完了基準クリア)
[ ] FAIL (理由: ...)

### 改善アクション (FAIL の場合)
- OpenAI WS 接続が ap-northeast-1 経由か確認
- Translation Agent コンテナの CPU/Memory が逼迫していないか
- LiveKit region が Tokyo 近隣か
```

### 15.7 PERF-002 達成不可時のエスカレーション

p95 > 3000ms が定常化した場合:
1. Translation Agent の Render region を Singapore → Tokyo に変更検討 (D2 §3.1 と整合)
2. OpenAI Realtime Translation API の region 設定確認 (US default を ap-northeast-1 にできるか問合せ)
3. LiveKit Cloud の Region を US-West → Asia-Pacific (Tokyo or Singapore) に変更
4. 上記いずれでも未達なら、Phase 1a 完了基準の見直し (例: p95 ≤ 3.5s に緩和、`docs/requirements.md` §4 更新)、もしくは Phase 1a 延長

---

## 16. セキュリティ監査チェックリスト

Sprint 3 末 / Production deploy 直前に **Opus 3 並列監査** で実施する統合チェックリスト (memory `feedback-three-opus-audit-before-deploy.md` 適用)。

### 16.1 RLS (Row Level Security) — 監査観点 7 件

| # | テーブル | 監査項目 | 期待結果 |
|---|---|---|---|
| 1 | `trancall_auth.profiles` | 自分のみ読み書き可、他は表示名等のみ参照可 | RLS policy あり |
| 2 | `trancall_auth.user_consents` (D7 新規) | 自分の同意のみ参照可、書込は service_role のみ | `user_consents_self_read` policy 確認 |
| 3 | `trancall_room.rooms / participants` | 自分が participant の room のみ | RLS あり |
| 4 | `trancall_billing.subscriptions / usage_windows` | 自分のみ | RLS あり |
| 5 | `trancall_billing.external_purchase_tokens` (D5 新規) | 自分のみ参照、書込 service_role のみ | `external_purchase_tokens_self_select` + `_no_write` policy 確認 |
| 6 | `trancall_transcript.segments / transcript_access` | `transcript_access.can_view=true AND deleted_at IS NULL` で可視性判定 | RLS join で実装 |
| 7 | `trancall_notification.device_tokens` | 自分のみ | RLS あり |

監査 SQL: 全テーブル列挙 → `pg_policies` を join で確認。

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname LIKE 'trancall_%'
ORDER BY schemaname, tablename;
```

### 16.2 HMAC 検証 — 監査観点 6 件

| # | 対象 | 監査項目 | canonical 出典 |
|---|---|---|---|
| 1 | Agent → Server `/internal/agent/events` | `x-trancall-signature` + `x-trancall-idempotency-key`、`timingSafeEqual` で比較 | `docs/module-contracts.md` §7 |
| 2 | VoIP Push payload (mobile bridge) | `HMAC<SHA256>.isValidAuthenticationCode` (CryptoKit) / `MessageDigest.isEqual` (Java) で constant-time | `docs/notification-detail.md` v1.3 §3.4 |
| 3 | HMAC rotation 24h dual-key 期間中 | 旧鍵 + 新鍵の両方を試行 | §9.3 |
| 4 | `TRANCALL_PUSH_HMAC_SECRET` 値長 | ≥ 32 文字 | §9.1 |
| 5 | `TRANCALL_AGENT_HMAC_SECRET` 値長 | ≥ 32 文字 | §9.4 |
| 6 | log に secret が出ていない | server / agent ログを grep | 各 logger 設定 |

### 16.3 PII 取扱 — 監査観点 5 件

| # | データ | 監査項目 |
|---|---|---|
| 1 | 通話音声 | OpenAI ZDR 合意済 (D7 §9.1)、TranCall 側保存なし (LiveKit / Agent でメモリ上のみ) |
| 2 | トランスクリプト | プラン別 retention (7/30/90/365 日)、`retention_until` 列で管理、削除バッチで物理削除 (§10) |
| 3 | IP アドレス / User-Agent (consent 監査証跡) | `user_consents.ip_address / user_agent` に保存、暗号化推奨 (Phase 2)、`docs/legal-and-consent.md` v1.1 §3.3 |
| 4 | デバイストークン (APNs / FCM) | `device_tokens` で管理、revoke 時に `is_active=false`、削除 API 提供 |
| 5 | クラッシュレポート (Sentry) | PII 自動除外、`callerName / message` 等を beforeSend で sanitize |

### 16.4 retention 削除バッチ — 監査観点 4 件

| # | 監査項目 |
|---|---|
| 1 | §10.1 4 テーブル全て削除実装あり (segments / transcript_access / external_purchase_tokens / consent_versions) |
| 2 | pg_cron スケジュール正しい (毎日 17:00 UTC = JST 02:00) |
| 3 | 削除件数の Sentry summary report 送信 |
| 4 | 失敗時 alert (`retention_batch_failure`、§11) |

### 16.5 同意フロー — 監査観点 5 件 (D7 連動)

| # | 監査項目 | canonical 出典 |
|---|---|---|
| 1 | Onboarding で `legal_terms` + `privacy_policy` 同意必須 | D7 §6.1 |
| 2 | 初回通話前に `voice_to_openai` 同意必須 | D7 §6.2 |
| 3 | `revokeConsent` が `legal_terms` / `privacy_policy` で `AUTH_CONSENT_IRREVOCABLE` を返す | D7 §14.1 |
| 4 | Settings → アカウント削除へのアクセスが 1-2 タップ (Apple 5.1.1(v) 遵守) | D7 §12 |
| 5 | 規約改訂時の再同意フロー機能している | D7 §13 |

### 16.6 OpenAI ZDR 合意 — 監査観点 2 件 (公開直前必須)

| # | 監査項目 |
|---|---|
| 1 | OpenAI と Zero Data Retention (ZDR) 合意契約締結済 | D7 §9.1 が前提とする |
| 2 | ZDR 合意証跡を Apple Review note (D6 §10) に添付準備 |

### 16.7 監査実行手順

```bash
# Opus 3 並列監査の起動コマンド (memory feedback-three-opus-audit-before-deploy.md 適用)
# Sprint 3 末で Production deploy 直前に実行
# 各 reviewer に §16.1〜§16.6 のチェックリストを渡し、独立に確認
# 3 全員 OK で deploy、1 件でも NG なら修正後再監査
```

監査結果は `docs/audit-reports/YYYY-MM-DD-prod-audit.md` に記録 (Sprint 3 で作成)。

---

## 17. 改訂履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-05-12 | Sprint 2 D8 設計書 初版。スコープ: `apps/server/api/index.ts` + `apps/server/vercel.json` entrypoint 仕様確定 (D2 §4.2 未確定雛形の解消) / Render Production Worker 構築手順 (D2 staging との差分、Standard plan / autoDeploy: false / deploy 手順) / Supabase Production 構築手順 (Pro plan / 日次 backup / migration 手順) / LiveKit Cloud Production テナント設定 (Build tier / 2 キー分離) / APNs Production gateway + FCM Production project (env var 配布) / 1Password TranCall-Infra-Prod vault 構造 / `TRANCALL_PUSH_HMAC_SECRET` + `TRANCALL_AGENT_HMAC_SECRET` rotation 実行手順 (24h dual-key、6 Phase 手順) / 日次 retention 削除バッチ (Supabase Edge Function スケルトン、Cron 設定、監視、手動再実行) / Sentry alert 8 ルール + on-call エスカレーション / ロールバック判断フローチャート + 4 シナリオ手順 / smoke test スクリプト 5 ステップ / 障害対応 6 シナリオ (OpenAI WS 切断 / Supabase ダウン / Vercel build 失敗 / HMAC rotation 失敗 / LiveKit 障害 / retention バッチ失敗)。 |
| v1.1 | 2026-05-12 | Round 1 レビュー (Opus A/B/C 並列) 指摘 Critical 2 + Warning 8 を反映。**Critical**: (A) §3.1 entrypoint コードを実装整合に修正 — `createApp` → `buildApp` (実 export 名)、Fastify v4 では `app.handle()` 不在のため `serverless-http` adapter 採用、`apps/server/package.json` に dependency 追加が必要、Sprint 3 Day 1 Spike 不要。(C) §10.2 Supabase JS クライアントの `.from("schema.table")` を `.schema("xxx").from("yyy")` 形式に修正 (3 テーブル + 4 番目に consent_versions 削除を追加)。**Warning**: (A+B) §3.2 vercel.json から SUPABASE_ANON_KEY / OPENAI_API_KEY を削除 (Server には不要、D2 §7 配布マトリクスと整合)。(A) §11.1 / §13.2 / §14 の `/api/health` を実 endpoint `/health` に統一 (app.ts line 55)。(A) §13.2 smoke test の room 作成 body を `{ invitee_id }` から `{ inviteeIds: [...] }` (CreateRoomSchema canonical) に修正、レスポンスも `data.roomId` に。(B) §2.4 関連文書欄の HMAC 出典を `notification-detail.md v1.3 §3 (canonical)` + `security-detail.md §2 (参考)` に整理、`security-detail.md` に rotation 節は未存在の旨を明記。(B) §14.3 「autoDeploy が enabled の場合」記述を「手動 promote (§4.3)」に書き換え §2.3 と内部整合。(C) §9.3 Phase 5 で `NEW_PUSH_SECRET` を 1Password から再取得するステップを追加、`vercel env rm` に `--yes` フラグ付与、`op item` の field 削除を `--remove-field` 形式に統一。 |
| v1.2 | 2026-05-12 | Round 2 統合判定の残 Warning + Suggestion を反映: vercel.json env に `APNS_AUTH_KEY: @apns-auth-key-prod` を追加 (§7.1.1 と整合)、§3.3 旧 Spike 記述を `serverless-http` 確定方針 (§3.1) と整合する 1 行に書換、§5.3 Pooler URL 指示を Supabase JS クライアント (`https://` 維持) と Prisma / pg 用 `DATABASE_URL` 別建てに分離 (JS クライアント初期化失敗を回避)。 |
| v1.3 | 2026-05-12 | Sprint 2 R1 補追: **§15 新規** Gate Check 合否判定 runbook (PERF-002 計測手順、集計 SQL、判定基準、記録テンプレ、未達時エスカレーション) を追加し A-4 TODO をカバー。**§16 新規** セキュリティ監査チェックリスト統合 (RLS 7 / HMAC 6 / PII 5 / retention 4 / 同意フロー 5 / OpenAI ZDR 2 = 29 項目) を追加し D-3 TODO をカバー。各観点で D5/D6/D7/D8 の canonical 出典を参照リンクとして整理。 |
