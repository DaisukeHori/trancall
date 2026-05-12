# Render dry-run デプロイ手順 (D2)

| | |
|---|---|
| Status | Draft v1.5 (2026-05-12) |
| Owner | DevOps / バックエンド |
| 目的 | Sprint 2 P0 (Gate Check 実走) の前提として、translation-agent / apps/server / Supabase を Render + Vercel + Supabase Cloud にスムーズに上げる |
| 上位文書 | `docs/deploy.md` (インフラ全体設計、canonical)、`docs/translation-pipeline-design.md` (D1) |
| 補助 | `docs/architecture.md` §2 (システム全体構成図)、`docs/review-responses-v12.md` §9 A4、`apps/translation-agent/Dockerfile` |
| 改訂条件 | Render/Vercel/Supabase の機能変更時 / dry-run の結果フィードバック反映時 |

本書は **Sprint 2 着手時に環境構築で迷わない** ための具体的手順を canonical 化する。`docs/deploy.md` が「**なぜ何を選んだか**」を扱うのに対し、本書は「**どう構築・確認するか**」のオペレーション側を扱う。

---

## 目次

1. スコープと位置付け
2. 前提条件
3. Render Background Worker (translation-agent)
4. Vercel Project (apps/server)
5. Supabase Project
6. LiveKit Cloud Project
7. 環境変数の配布マトリクス (全体)
8. Staging vs Production 分離
9. dry-run チェックリスト (Sprint 2 Gate Check 前)
10. ロールバック
11. ログとアラート初期設定
12. Phase 1b 以降の改善 (deferred)
13. 既知のリスク
14. 改訂履歴

---

## 1. スコープと位置付け

### 1.1 本書が確定すること
- Render Background Worker (translation-agent) の作成手順
- Vercel Project (apps/server) の作成手順
- Supabase Project (DB + Auth + Storage) の作成と migration 実行手順
- LiveKit Cloud Project の作成と Key 発行
- 環境変数の配布マトリクス (どの env をどのプラットフォームに置くか)
- staging vs production の分離方針
- dry-run チェックリスト (Gate Check 実走前の sanity check)
- ロールバック手順
- ログ / アラート初期設定

### 1.2 本書の非スコープ
- ホスティング選定の根拠 (`docs/deploy.md` §2 が canonical)
- CI/CD パイプラインのコード変更 (`docs/deploy.md` §4 が概念図)
- Sentry / Datadog などの観測基盤詳細 (Phase 1b、別書)
- CD 自動化 (`gh workflow` 編集) は Sprint 2 別 PR
- mobile アプリ (EAS Build / TestFlight) — `docs/eas-distribution.md` 等は別 PR
- Stripe / IAP / APNs / FCM 連携の本番化 (Phase 1c)

### 1.3 関連 Sprint 2 設計 PR との依存関係

- **D1 (translation-pipeline-design.md)**: 本書は D1 の Translation Agent ライフサイクルを Render Worker 上で起動・監視する手段を提供する。Gate Check (§9.4) は D1 の Phase 1a 受け入れ基準と連動。
- **D3 (module-contracts.md v1.1.0)**: 本書の HMAC 内部 API、env var 命名、ロールバック発動基準は D3 の facade/event/error code 契約と整合する必要がある。
- **D4 (native call bridge, 後続 PR)**: 本書は APNs/FCM/CallKit 関連 env vars (APNS_*, FCM_SERVICE_ACCOUNT_JSON) の配布先を §7 で定義するが、これらは **D4 完了後に有効化** する。Sprint 2 中は optional のまま staging に空値で投入し、Notification モジュール実装完了後 (Phase 1b 想定) に本番値に切り替える。

---

## 2. 前提条件

### 2.1 アカウントとライセンス
| サービス | アカウント | プラン (Phase 1a) |
|---|---|---|
| Render | GitHub 連携済の team account | Starter ($7/月、Background Worker 用) |
| Vercel | GitHub 連携済の team account | Hobby (商用想定 Phase 1b で Pro $20/月) |
| Supabase | Organization member | Free (Pro $25/月は Phase 1b) |
| LiveKit Cloud | Project owner | Free tier (5,000 participant-min/月) |
| Cloudflare | DNS owner | Free |
| OpenAI | API access (Realtime Translation beta) | usage-based |

### 2.2 リポジトリ状態
- main branch HEAD が **Layer 4 + D1+D3 マージ済** (現状 commit `5ac531d` 以上)
- `apps/translation-agent/Dockerfile` がビルド可能 (`docker build .` 確認)
- `apps/server/package.json` の `build` / `start` が動く
- `supabase/migrations/00001〜00006_*.sql` 6 ファイル存在

### 2.3 secrets 保管
`op` コマンドの利用には 1Password CLI が必要 (`brew install 1password-cli` でインストール、初回 `op signin` でアカウント連携)。

全 secrets は 1Password Vault `TranCall-Infra` に保存 (本書を 1Password 運用の canonical とする)。

- Vault 名: `TranCall-Infra`
- Item 命名規約: `<service>-<env>-<purpose>` (例: `render-prod-hmac-secret`, `vercel-staging-supabase-service-role`)
- アクセス権限: オーナー (堀) のみ。Sprint 2 中はチーム共有なし
- ローカル利用: `op run --env-file=./op.env -- <command>` でプロセス環境に注入し、`.env` ファイルへの書き出し禁止
- シェルヒストリ漏洩防止: `HISTCONTROL=ignorespace` を `.zshrc` に設定し、シークレットを含むコマンドは行頭スペースで実行

- secrets rotation は手動 (Phase 1b で自動化検討)

---

## 3. Render Background Worker (translation-agent)

### 3.1 サービス作成
1. Render Dashboard → New → **Background Worker**
2. Repository: `DaisukeHori/trancall` (GitHub Integration)
3. Branch: `main` (Auto-deploy 有効)
4. Region: **Singapore** (Tokyo は未提供、最寄り)
5. Plan: **Starter ($7/月)** — 512 MB / 0.5 CPU
6. Build & Deploy:
   - Runtime: **Docker**
   - Dockerfile path: `apps/translation-agent/Dockerfile`
   - Docker Build Context: `.` (リポジトリルート、monorepo 全体を Docker に渡す)
7. Service name:
   - staging: `trancall-agent-staging`
   - production: `trancall-agent-prod`

> **⚠️ 警告**: `autoDeploy: true` は `main` push が即 production に反映される。Sprint 2 dry-run 期間中は **一時的に `autoDeploy: false` に設定** し、Render/Vercel Dashboard から手動 promote で確認しながら進めることを推奨。Phase 1b で本番化する際に再度 `true` に戻す。

### 3.2 `render.yaml` (IaC、Sprint 2 で初版作成)

```yaml
services:
  - type: worker
    name: trancall-agent-prod
    runtime: docker
    repo: https://github.com/DaisukeHori/trancall
    branch: main
    region: singapore
    plan: starter
    dockerfilePath: apps/translation-agent/Dockerfile
    dockerContext: .
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: ENVIRONMENT
        value: production
      - key: LOG_LEVEL
        value: info
      - key: AGENT_NAME
        value: trancall-translation-agent
      - fromGroup: trancall-prod-secrets
  - type: worker
    name: trancall-agent-staging
    runtime: docker
    repo: https://github.com/DaisukeHori/trancall
    branch: develop
    region: singapore
    plan: starter
    dockerfilePath: apps/translation-agent/Dockerfile
    dockerContext: .
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: ENVIRONMENT
        value: staging
      - key: LOG_LEVEL
        value: debug
      - key: AGENT_NAME
        value: trancall-translation-agent-staging
      - fromGroup: trancall-staging-secrets

envVarGroups:
  - name: trancall-prod-secrets
    envVars:
      - key: LIVEKIT_URL
        sync: false
      - key: LIVEKIT_API_KEY
        sync: false
      - key: LIVEKIT_API_SECRET
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: TRANCALL_AGENT_HMAC_SECRET
        sync: false
      - key: TRANCALL_SERVER_URL
        value: https://api.trancall.app
  - name: trancall-staging-secrets
    envVars:
      - key: LIVEKIT_URL
        sync: false
      - key: LIVEKIT_API_KEY
        sync: false
      - key: LIVEKIT_API_SECRET
        sync: false
      - key: OPENAI_API_KEY
        sync: false
      - key: TRANCALL_AGENT_HMAC_SECRET
        sync: false
      - key: TRANCALL_SERVER_URL
        value: https://api-staging.trancall.app
```

`sync: false` の env vars は Render Dashboard で手動入力 (1Password から転記)。

### 3.3 環境変数 (本番)
`apps/translation-agent/src/config.ts` の Zod schema と完全一致:

| Key | Source | 例 |
|---|---|---|
| `LIVEKIT_URL` | LiveKit Cloud Dashboard | `wss://trancall-prod.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit Cloud → Settings → Keys | `APIxxxxxxxxxxxx` |
| `LIVEKIT_API_SECRET` | 同上 | `xxxxxxxxxxxxxxxxxx` |
| `OPENAI_API_KEY` | OpenAI Dashboard → API Keys | `sk-proj-xxxx...` |
| `OPENAI_REALTIME_TRANSLATE_URL` | (optional override) | デフォルト `wss://api.openai.com/v1/realtime/translations` |
| `TRANCALL_AGENT_HMAC_SECRET` | `openssl rand -hex 32` で生成 → 1Password 保存 | 64 桁 hex |
| `TRANCALL_SERVER_URL` | Vercel deployment URL | `https://api.trancall.app` |
| `AGENT_NAME` | 固定 | `trancall-translation-agent` |
| `LOG_LEVEL` | `info` (prod) / `debug` (staging) | |
| `NODE_ENV` | `production` (prod/staging 共通、Zod enum 制約) | |
| `ENVIRONMENT` | `production` (prod) / `staging` (staging) | 論理環境識別用 |
| `SENTRY_DSN` | Phase 1b 以降、未設定 | optional |

### 3.4 ヘルスチェック
Render は worker タイプでは HTTP ヘルスチェックを行わない。代わりに:
- **プロセスが exit したら自動再起動** (`docs/deploy.md` §2.3)
- ログを Dashboard で 14 日保持
- exit code != 0 が 5 分以内に 3 回発生で Render が「Crashed」状態にマーク
- Slack 通知は Render Webhook → Slack incoming webhook で実装 (Sprint 2 内)

### 3.5 リソース上限
- メモリ: **512 MB**、`process.memoryUsage().rss` が 450 MB 超で Slack 警告 (Agent metrics 経由)
- 1 ワーカー = 同時 10 通話 × 1-2 翻訳セッション (Phase 1a 想定、`docs/deploy.md` §2.3 採用理由)
- 水平 scale: Phase 1a は 1 worker 固定、Phase 1b で manual scaling

---

## 4. Vercel Project (apps/server)

> **注**: `docs/deploy.md` §2.1 では API Server の説明で "Next.js" と表記されている箇所があるが、`apps/server` の実装は Fastify。`deploy.md` 側の表記揺れは別 PR で修正予定 (Sprint 2 docs cleanup タスク)。本書は Fastify 前提で手順を記述する。

### 4.1 プロジェクト作成
1. Vercel Dashboard → New Project → Import `DaisukeHori/trancall`
2. Project Name:
   - staging: `trancall-api-staging` (Preview Deployment はこの Project から自動)
   - production: `trancall-api-prod`
3. Root Directory: `apps/server`
4. Framework: **Other** (Node.js raw、Next.js ではない)
5. Build Command: `pnpm turbo run build --filter=@trancall/app-server`
6. Output Directory: (空欄、Vercel 自動検出)
7. Install Command: `corepack enable && pnpm install --frozen-lockfile`
8. Node.js version: **22** (`engines.node` で固定)
9. Region:
   - production: **hnd1** (Tokyo)
   - staging: hnd1 (同上、レイテンシ揃え)

### 4.2 `vercel.json` (Sprint 2 で初版作成)

> **⚠️ 重要: 未確定雛形 (Sprint 2 Day 1 で動作検証)**
>
> 本節の `vercel.json` は素案。`apps/server` は Fastify で実装されており、Vercel Serverless Functions (Node.js Runtime) で動作させるには `fastify-serverless-http` 等の adapter 経由で `(req, res) => app.handle(req, res)` 形式に変換する必要がある。Sprint 2 Day 1 の Spike タスクで以下を確定する:
>
> 1. `apps/server/src/index.vercel.ts` (serverless エントリポイント) を新設
> 2. `fastify-serverless-http` 等の adapter を `dependencies` に追加
> 3. `vercel.json` の `functions` キーは `outputDirectory` 基準の相対パス (例: `index.js`) または Vercel 公式 Turborepo テンプレートに従い `apps/server/api/index.ts` 形式に切り替え
> 4. ローカル `vercel dev` で 200 が返ることを確認
>
> §13 known risks #2 と連動。Spike で動かない場合は Render Web Service 等の代替を検討。

```json
{
  "version": 2,
  "buildCommand": "pnpm turbo run build --filter=@trancall/app-server",
  "installCommand": "corepack enable && pnpm install --frozen-lockfile",
  "functions": {
    "api/index.ts": {
      "runtime": "nodejs22.x",
      "maxDuration": 30
    }
  },
  "regions": ["hnd1"],
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index.ts" }
  ]
}
```

> ⚠️ **注意**: 本 vercel.json は `apps/server/api/index.ts` を entrypoint として参照する。同ファイルは Sprint 2 内の別タスク (Fastify → Vercel serverless adapter 実装) で作成予定。**それまで vercel.json をコミットすると Vercel build が module-not-found で失敗する**。本 PR では仕様のみ示し、commit は entrypoint 実装と同 PR で行う。

**注意**: Vercel Serverless は `apps/server` の Fastify を **コールドスタートあり** で動かす。LiveKit Token 発行は実行時間が短いので問題ないが、Stripe Webhook 等で 30 秒超の処理が必要になれば `vercel.json` の `maxDuration` を引き上げる (Pro plan で最大 300 秒)。

### 4.3 環境変数
`apps/server/src/config.ts` の Zod schema 完全一致:

| Key | Source | Production / Staging 共通? |
|---|---|---|
| `PORT` | Vercel が自動設定 | (Vercel デフォルト 3000 不要) |
| `NODE_ENV` | `production` (prod/staging 共通、Zod enum 制約) | 共通 |
| `ENVIRONMENT` | `production` / `staging` | 各 |
| `SUPABASE_URL` | Supabase Dashboard | 各 (別 project) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | 各 |
| `LIVEKIT_URL` | LiveKit Cloud | 共通 (Free tier 1 project で OK) |
| `LIVEKIT_API_KEY` | 同上 | 共通 |
| `LIVEKIT_API_SECRET` | 同上 | 共通 |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | 各 (test mode vs live mode) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks | 各 |
| `STRIPE_PRICE_ID_LIGHT/STANDARD/BUSINESS` | Stripe → Products | 各 |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | 固定 | 各 |
| `APNS_*` (5 個) | Apple Developer | Phase 1b、optional 維持 |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase Console | Phase 1b、optional |
| `TRANCALL_AGENT_HMAC_SECRET` | 1Password (Render と同値) | 各 |
| `INVITE_BASE_URL` | 固定 | 各 |

> **注**: `SUPABASE_ANON_KEY` は Vercel (Server) には不要。Server は `SUPABASE_SERVICE_ROLE_KEY` のみ使用 (apps/server/src/config.ts 定義済)。Mobile (`EXPO_PUBLIC_SUPABASE_ANON_KEY`) のみで配布する。詳細は §7 配布マトリクス。

設定方法: Vercel Dashboard → Settings → Environment Variables → Production / Preview / Development の 3 環境で分けて投入。

### 4.4 カスタムドメイン
- production: `api.trancall.app` (Cloudflare DNS で Vercel に proxy)
- staging: `api-staging.trancall.app` (同上)
- CNAME: `cname.vercel-dns.com`

### 4.5 ヘルスチェック
- `GET /health` (apps/server `app.ts` インライン定義、`{ok: true}` を返す)
- 監視: Better Uptime / UptimeRobot 等の外部監視 (Phase 1b)

---

## 5. Supabase Project

### 5.1 プロジェクト作成
1. Supabase Dashboard → New Project
2. Name:
   - staging: `trancall-staging`
   - production: `trancall-prod`
3. Database Password: `openssl rand -base64 32` → 1Password 保存
4. Region: **ap-northeast-1 (Tokyo)**
5. Plan: Free (Phase 1b で Pro $25/月)

### 5.2 Migrations 実行
Sprint 1 時点で `supabase/migrations/` 配下に 6 ファイル。実行方法を **本書で確定** (deploy.md にも未記載だった項目):

```bash
# 前提: supabase CLI インストール済 (`brew install supabase/tap/supabase`)
cd /Users/horidaisuke/trancall

# 1. ローカルから staging project を link
supabase link --project-ref <staging-project-ref>
# project-ref は Dashboard URL `https://supabase.com/dashboard/project/{ref}` の {ref} 部分
# ここでは staging に link していることを明確に意識すること

# 2. 現在の migration 状態を確認
supabase migration list --linked

# 3. ローカルとリモートの差分をプレビュー (dry-run 相当)
supabase db diff --linked --schema public,trancall_auth,trancall_room,trancall_contact,trancall_billing,trancall_transcript,trancall_notification,trancall_event
# ※ translation 関連テーブル (translation_sessions / translation_events / agent_metrics) は trancall_event 配下。
#    スキーマ詳細は docs/architecture.md §6 (データベース設計) を参照。

# 4. 差分を目視確認 (想定外の DROP/ALTER がないか)

# 5a. staging で migration を適用 — 初回 seed 未適用の場合 (staging を本手順で初めてセットアップするケース)
supabase db push --linked --include-all

# 5b. staging で migration を適用 — 2 回目以降 (seed 既適用前提)
supabase db push --linked

# 上記 5a / 5b はどちらか一方のみ実行する。staging 初回かどうかは Supabase Dashboard → SQL Editor で seed 由来テーブル (例: 任意の master データ) が存在するかで判別する。

# 6. staging で RLS テスト + アプリ疎通確認 (§9.2 参照)

# 6.5. production push の前に link 先を production に切り替える
supabase link --project-ref <prod-project-ref>
# link 先が production ref に変わったことを必ず目視確認する
cat .supabase/config.toml | grep project_id
# → project_id = "<prod-project-ref>" が表示されることを確認してから次のステップへ進む

# 7. production push (確認プロンプトに y で応答)
supabase db push --linked --include-all
# `--include-all`: staging push (step 5b) では CI/手動で seed ファイルが既に適用済を前提とするため不要。
# production 初回投入時は seed ファイルが未適用のため --include-all で seed も含めて適用する。
# step 5a/5b に --include-all を付けるべきでは? という疑問: staging 初回 (5a) は --include-all 付き、2 回目以降 (5b) は不要。本番初回のみ有効。

# 8. push 後の確認
supabase migration list --linked
```

**注意**:
- `supabase db push` は **差分のみ適用** (idempotent)
- staging で先に試して問題ないことを確認してから production に push (順序厳守)
- production への push 前に **必ず staging で行う dry-run の出力を 1Password に保存**
- **staging/prod 取り違え防止**: `supabase link` で切り替えた後は必ず `cat .supabase/config.toml | grep project_id` で対象 ref を目視確認すること。`--linked` フラグは `.supabase/config.toml` に記録された link 先を参照するため、env var での上書きは効かない点に注意。

### 5.3 Auth 設定
- Authentication → Providers:
  - Email/Password: 有効、Confirm email を ON
  - Google OAuth: Phase 1b で追加 (Apple OAuth 同時)
  - Apple OAuth: Phase 1b
- Authentication → URL Configuration:
  - Site URL: `https://trancall.app`
  - Redirect URLs: `trancall://callback` (mobile deeplink)

### 5.4 RLS 確認
`supabase/migrations/00004_strengthen_rls_policies.sql` が適用された状態であることを Dashboard で確認 (Tables → 各テーブル → RLS が enabled になっていれば OK)。pgTAP テストは Phase 1c。

### 5.5 取得すべき情報 (Vercel / Mobile に配布)
- `SUPABASE_URL`: `https://xxxx.supabase.co`
- `SUPABASE_ANON_KEY`: 公開可能 (Mobile + Web で使用)
- `SUPABASE_SERVICE_ROLE_KEY`: Server only、絶対に公開しない

---

## 6. LiveKit Cloud Project

### 6.1 プロジェクト作成
1. LiveKit Cloud Dashboard → New Project
2. Name: `trancall-prod` (本番)、`trancall-staging` (Phase 1a は 1 project で兼用も可、課金抑制)
3. Region: **Tokyo (Asia-Pacific)**

### 6.2 Key 発行
- Settings → Keys → Create API Key
- 用途別に 2 つ:
  - `trancall-server-prod` (Vercel に配布、Server からの Token 発行・Room CRUD 用)
  - `trancall-agent-prod` (Render に配布、Agent からの Room join 用)

> **注**: LiveKit Cloud の API Key は同一 Project 内では権限スコープを分離できない (全権キー)。キーを分ける目的は **漏洩時のローテーション範囲を限定** すること。Server 側キーが漏洩しても Agent を停止せず Server だけローテーション可能、その逆も同様。

> **※ Phase 1a における実運用**: 2 キー分離は Phase 1b 以降の改善計画。Phase 1a (本 dry-run 時点) では単一の `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` を Render と Vercel 双方に共通配布する。詳細は §7 配布マトリクス参照。

### 6.3 URL 確認
- `wss://trancall-xxxx.livekit.cloud` 形式で発行される
- 本書の §3 §4 の `LIVEKIT_URL` env vars に転記

---

## 7. 環境変数の配布マトリクス (全体)

| 変数 | Render Agent | Vercel API | Mobile (EAS) | Supabase | 注記 |
|---|---|---|---|---|---|
| `LIVEKIT_URL` | ✓ | ✓ | (EXPO_PUBLIC で別形式) | - | mobile は `EXPO_PUBLIC_LIVEKIT_URL` |
| `LIVEKIT_API_KEY` | ✓ | ✓ | - | - | server-side のみ |
| `LIVEKIT_API_SECRET` | ✓ | ✓ | - | - | 同上 |
| `OPENAI_API_KEY` | ✓ | - | - | - | Agent のみ |
| `SUPABASE_URL` | - | ✓ | ✓ (EXPO_PUBLIC) | (自身) | mobile は `EXPO_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | - | ✓ | - | (自身) | server-side のみ |
| `SUPABASE_ANON_KEY` | - | - | ✓ (EXPO_PUBLIC) | (自身) | client-side OK (RLS で保護) |
| `STRIPE_SECRET_KEY` | - | ✓ | - | - | webhook 受信 |
| `STRIPE_WEBHOOK_SECRET` | - | ✓ | - | - | webhook 署名検証 |
| `TRANCALL_AGENT_HMAC_SECRET` | ✓ | ✓ | - | - | **両方に同一値必須**、内部 API 認証 |
| `TRANCALL_SERVER_URL` | ✓ | - | (EXPO_PUBLIC_API_URL) | - | Agent → Server callback |
| `APNS_*` | - | ✓ | (アプリ署名) | - | Phase 1b |
| `FCM_SERVICE_ACCOUNT_JSON` | - | ✓ | - | - | Phase 1b |
| `ENVIRONMENT` | ✓ | ✓ | - | - | 論理環境識別 (staging/production) |

**鉄則**:
- `SERVICE_ROLE_KEY` / `API_SECRET` / `SECRET_KEY` / `HMAC_SECRET` の付く変数は **絶対に mobile に置かない** (EAS Build に含めない)
- `EXPO_PUBLIC_*` 変数は **公開される前提** で設計 (Supabase は RLS で保護、LiveKit は Token 発行を server で行うため URL のみ公開で問題なし)

---

## 8. Staging vs Production 分離

### 8.1 分離レベル
| レイヤ | staging | production |
|---|---|---|
| Render Worker | `trancall-agent-staging` | `trancall-agent-prod` |
| Vercel Project | `trancall-api-staging` (Preview) | `trancall-api-prod` |
| Supabase Project | `trancall-staging` | `trancall-prod` |
| LiveKit Project | (兼用可) | `trancall-prod` |
| Stripe | test mode | live mode |
| OpenAI | 同 API Key (usage 計上注意) | 同上、要計上分離 |
| Domain | `api-staging.trancall.app` | `api.trancall.app` |

### 8.2 GitHub Branch との対応
- `main` → production deploy (Vercel + Render)
- `develop` → staging deploy
- `feat/*` / `fix/*` → Vercel Preview Deployment (ephemeral)

> **⚠️ 警告**: `autoDeploy: true` は `main` push が即 production に反映される。Sprint 2 dry-run 期間中は **一時的に `autoDeploy: false` に設定** し、Render/Vercel Dashboard から手動 promote で確認しながら進めることを推奨。Phase 1b で本番化する際に再度 `true` に戻す。

### 8.3 secrets rotation 方針
- Phase 1a: 手動 (1Password の "Last Rotated" メモを 90 日で更新)
- HMAC secret は **両側同時** に更新 (Render Dashboard と Vercel Dashboard で同時に変更してから両方 redeploy)
- LiveKit API Key は **Project ごと再発行** (古い Key は使えなくなる、ダウンタイム発生)

---

## 9. dry-run チェックリスト (Sprint 2 Gate Check 前)

### 9.1 デプロイ確認
- [ ] Render `trancall-agent-staging` が起動 (Logs に `[agent] worker started` が出る)
- [ ] Render Logs にエラーなし
- [ ] Vercel `trancall-api-staging` が 200 OK を返す (`curl https://api-staging.trancall.app/health`)
- [ ] Supabase `trancall-staging` に 6 migrations が applied
- [ ] LiveKit Cloud Dashboard で `trancall-prod` project が active

### 9.2 接続疎通
- [ ] **LiveKit Token 発行**: `curl -X POST https://api-staging.trancall.app/api/rooms` → 200 + JWT 返却
- [ ] **HMAC 内部 API**: Render Logs に `POST /internal/agent/events -> 200` が出る (Agent → Server)
- [ ] **OpenAI 接続**: Agent Logs に `[openai-ws] connected wss://api.openai.com/v1/realtime/translations` が出る
- [ ] **Supabase 接続**: Vercel Logs に `[supabase] connected` (起動時のみ)

### 9.3 env vars 検証
- [ ] `TRANCALL_AGENT_HMAC_SECRET` が Render と Vercel で **完全に一致** (1Password で比較)
- [ ] `LIVEKIT_URL` が 3 (server / agent / mobile) で一致
- [ ] `SUPABASE_URL` が server と mobile で一致
- [ ] Render Logs に Zod validation error (`config.parse failed`) なし
- [ ] Vercel Logs に Zod validation error なし
- [ ] `ENVIRONMENT` の値が `staging` または `production` のいずれかであることを確認 (Zod enum 外の値が入っていないか)

### 9.4 Gate Check 実行
- [ ] `TRANCALL_SERVER_URL=https://api-staging.trancall.app pnpm --filter @trancall/app-translation-agent gate-check` をローカルから staging に向けて実行
- [ ] 30 分連続実行で WS 切断/再接続が記録される
- [ ] PERF-002 初回計測値 (`latency_ms` JSONB) が `agent_metrics` テーブルに記録される
- [ ] メモリ RSS が 450 MB 以下

> 確認手順: Render Dashboard → 対象 Service → **Metrics** タブ → **Memory** グラフを 30 分間隔で表示。ピーク値が 450 MB 未満であることを確認。Render の Memory metrics は RSS 相当値を表示する (VSZ との区別は提供されない)。512 MB プラン上限の 88% 以下を維持できれば OK 判定。

**WS 切断ログ例** (正常な再接続フロー):

```
[openai-ws] disconnected, reconnecting in 3s...
[openai-ws] reconnect attempt 1/5
[openai-ws] connected wss://api.openai.com/v1/realtime/translations
```

5 回以上の再接続失敗が続く場合は OpenAI 側の障害または rate limit を疑う (§13 #8 参照)。

**`agent_metrics` の Supabase Dashboard 確認手順**:
Supabase Dashboard → Table Editor → schema=`trancall_event` → `agent_metrics` を開き、以下を目視確認する:

- (a) 直近 1h の行数が想定 throughput と乖離していないこと
- (b) `latency_ms` JSONB 列 (raw 配列格納) 内の `totalEndToEnd` キーの最大値が 1500ms を大きく超えていないこと

`latency_ms` 1 行の JSONB 構造例 (migration `00003_add_agent_metrics_table.sql` 定義より):

```json
{
  "captureToAgent":    [32, 28, 35],
  "agentToOpenAI":     [12, 10, 14],
  "openAIFirstDelta":  [380, 410, 395],
  "agentPublish":      [18, 22, 19],
  "totalEndToEnd":     [442, 470, 463]
}
```

`totalEndToEnd` はルートキーの配列 (計測ごとの raw 値、単位 ms)。Table Editor では JSON ツリー表示で `totalEndToEnd` 配列を展開し、配列要素の最大値を確認する。

`agent_metrics` テーブルの `latency_ms` JSONB 列には raw 配列が格納されており、p50/p95 等の集計は後段で行う設計のため、Dashboard では上記 (a)(b) の目視確認に留める。集計用 SQL は Phase 1b で別途整備予定。

### 9.5 観測確認
- [ ] Render Dashboard で CPU / Memory グラフが取れる
- [ ] Vercel Analytics で API レイテンシが見える
- [ ] Supabase Logs で SQL query が観察できる
- [ ] LiveKit Cloud Dashboard で room creation が見える

---

## 10. ロールバック

### 10.0 ロールバック発動基準

以下のいずれかを観測したら即座に rollback 判断:

| 対象 | 基準 | 確認方法 |
|------|------|----------|
| Render Worker | Render Dashboard 上で Service が `Crashed` 状態にマークされる、または Logs に起動ログが 5 分以内に出ない (LiveKit 接続成功ログ未出現) | Render Dashboard → Service → Events / Logs |
| Vercel Server | 5 分間 5xx 率 > 5%、または `/health` が 3 連続失敗 | Vercel Dashboard → Logs |
| Supabase Migration | `supabase db push` がエラー終了、または migration 後に RLS ポリシーの目視確認/差分確認で問題を検知 | Supabase Dashboard で対象テーブルの RLS Policy 一覧を目視確認、または `supabase db diff --linked --schema <schema>` を staging に対して実行し差分なしを確認。`supabase/tests/rls/*.sql` が存在し手動実行可能 (Phase 1b で CI 化予定)。`packages/db` は存在しないため `pnpm --filter @trancall/db` コマンドは使用不可 |
| HMAC 認証 | Server → Agent の HMAC 401 が 1 分間に 5 件以上 | Render Logs `level: "error"` フィルタ |

判断者: dry-run フェーズはオーケストレーター (堀)、本番フェーズはオンコール担当 (Phase 1b で確立)。

### 10.1 Render
- Dashboard → Service → Deploys タブ → 直前の Deploy → "Rollback"
- 自動再起動でダウンタイム 30 秒程度

### 10.2 Vercel
- Dashboard → Deployments → 直前の deployment → "Promote to Production"
- 反映までダウンタイム数秒

### 10.3 Supabase migration ロールバック (危険)
- Supabase は migration の自動 down 機能なし
- 手動で逆方向 SQL を `supabase/migrations/` に追加 (例: `00007_revert_xxx.sql`) して `supabase db push`
- **本番 DB のロールバックは DB Backup からのリストアが安全** (Free tier は backup なし、Phase 1b の Pro plan で日次 backup 利用)
- Phase 1a の dry-run 段階では **データを消して migration 再実行** が現実的

### 10.4 連鎖ロールバック
- Vercel と Render を同時にロールバックする必要がある場合、**HMAC secret 不一致** に注意
- 古い deploy が新しい HMAC secret を持つと内部 API が 401 を返す
- 順序: secret を旧値に戻す → 両 deploy を同時にロールバック

### 10.5 ロールバック後の再デプロイ手順

1. ロールバック直後にインシデント記録 (GitHub Discussion `incidents/YYYY-MM-DD-<short>` に状況・rollback 範囲・暫定影響を記録)
2. 修正方針が決まるまで `main` への merge を停止 (PR は draft に戻す)
3. 修正コードは新しい feature branch で PR を作成、CI 緑 + reviewer 承認後 `main` merge
4. 自動デプロイ (autoDeploy: true) で staging に流れる → §9 dry-run チェックリストを再実行
5. staging で 30 分連続 OK を確認後、production に手動 promote (Render Dashboard / Vercel Dashboard)
6. インシデント記録に rollback → 再デプロイの完了タイムスタンプを追記

**インシデント記録項目** (GitHub Discussion テンプレート):

- 発生時刻 (UTC + JST 併記)
- 検知トリガ (Sentry alert / ユーザー報告 / 内部監視)
- 影響サービスと影響ユーザー数 (推定値でも可)
- 暫定原因仮説
- 対応アクション (rollback / hotfix / 観察継続)
- rollback 範囲 (Render only / Vercel only / Supabase migration revert 含む)
- 恒久対応 PR 番号
- 再発防止策 (テスト追加 / 監視強化 / runbook 改訂)

---

## 11. ログとアラート初期設定

### 11.1 Render
- Dashboard → Service → Logs (14 日保持、default)
- Webhook 設定: Settings → Notifications → "Deploy failed" / "Service crashed" → Slack incoming webhook
- 高度な log 集約は Phase 1b で Sentry / Datadog 追加

> **Phase 1a の代替**: Sentry を導入しない期間中、Agent/Server のエラーは Render Logs / Vercel Logs の `level: "error"` 行を **dry-run 期間中は 1 日 1 回手動確認**。エラーが頻発する (1 日 10 件超) 場合は Sprint 2 内で Sentry 前倒し導入を判断する。

### 11.2 Vercel
- Dashboard → Deployments → Runtime Logs (30 日)
- Vercel Analytics は Hobby plan で 1000 events/日 (Phase 1a 上限内)

### 11.3 Supabase
- Dashboard → Logs → Postgres / API / Auth 別ビュー
- 高負荷時のスロークエリは Phase 1c で pg_stat_statements 拡張

### 11.4 Phase 1a の横断調査

> **前提**: 本節の `correlation_id` フィルタおよび `ENVIRONMENT` タグは Sprint 2 内の別タスクで config.ts / logger 実装を追加したのちに有効化される。Phase 1a (本 dry-run 実施時点) では未実装のため、`timestamp` 範囲 + `service` 名 + `room_id` で代替相関を取る。

3 サービス (Render / Vercel / Supabase) のログは別々の Dashboard に分かれる。

#### 11.4.1 Phase 1a (現在の暫定運用)

`correlation_id` は未実装のため、`timestamp` 範囲 (UTC 時刻帯) + `service` 名 + `room_id` を手掛かりに各 Dashboard を横断検索する手動運用とする:

1. インシデント発生時刻の UTC 時刻帯を特定する
2. Render Logs → 時刻帯で絞り込み → `room_id` でフィルタして Agent 側ログを確認
3. Vercel Logs → 同時刻帯で絞り込み → `room_id` でフィルタして Server 側ログを確認
4. Supabase Logs → Postgres / API タブで同時刻帯の SQL を確認
5. 3 つの Dashboard のログを時系列で突き合わせてエラー箇所を特定する

#### 11.4.2 Phase 1b 以降 (correlation_id 実装後)

Sprint 2 内の別タスクで logger に `correlation_id` を追加した後は、以下の手順で横断調査が可能になる:

1. Mobile → Server リクエスト時に `correlation_id` (UUID v4) を生成し HTTP header に付与
2. Server → Agent HMAC リクエストにも `correlation_id` を伝搬
3. 各サービスのログには `{ "correlation_id": "...", ... }` を JSON Lines で出力
4. インシデント調査時は Render Logs / Vercel Logs / Supabase Logs それぞれで `correlation_id` を検索

Phase 1b で Sentry または Datadog Logs に集約予定。

### 11.5 LiveKit Cloud
- Dashboard → Rooms → 各通話の duration / participants 確認
- Webhook (room_started / room_ended) は Phase 1b で実装

### 11.6 Slack 通知
- `#trancall-alerts` チャンネル新設
- 初期: Render crash + Vercel deploy failed のみ
- Phase 1b で latency p95 警告、Free tier 残量警告を追加 (`docs/deploy.md` §3.2 参照)

---

## 12. Phase 1b 以降の改善 (deferred)

> 各項目は Sprint 2 完了時点で **GitHub Issues (label: `phase-1b`)** に登録予定 (Sprint 2 振り返り MTG で issue 化)。

- Sentry 統合 (Agent + Server、`SENTRY_DSN` 既に config.ts で optional 定義済)
- CD 自動化 (`.github/workflows/deploy.yml` 追加、Render / Vercel への手動 promote を排除)
- Supabase Pro plan + 日次 backup
- LiveKit Cloud Build tier ($50/月) で 50,000 minutes
- Render Standard plan ($25/月) でメモリ 2 GB / CPU 1.0 にスケールアップ
- DNS failover (Cloudflare で Vercel と別ホストを multi-origin で利用)
- LiveKit API キーの Server/Agent 用 2 キー分離 (漏洩時ローテーション範囲限定、Phase 1a は単一キー共通配布)

---

## 13. 既知のリスク

1. **`render.yaml` 未作成**: 本書 §3.2 に雛形を canonical 化したが、Sprint 2 Day 1 に commit して Render Dashboard の "Sync from Blueprint" を実行する必要あり。
   Mitigation: §3.2 の雛形を Day 1 タスクとしてチケット化し、commit と Dashboard 反映を当日ブロッカーとして管理する。
2. **`vercel.json` 未作成 + `apps/server/api/index.ts` 未作成**: §4.2 雛形を Sprint 2 Day 1 に commit 予定だが、`apps/server/api/index.ts` (serverless adapter エントリポイント) が未作成のため **vercel.json を先にコミットすると Vercel build が module-not-found で失敗する**。`apps/server` を Fastify で動かす場合の Vercel での compatibility が未検証。**dry-run の最大リスク要因**。entrypoint 実装と vercel.json は同一 PR でコミットすること。
   Mitigation: Sprint 2 Day 1 までに entrypoint 実装が完了しない場合、Vercel ではなく Render Web Service への暫定切替を検討する判断を Sprint 2 Day 0 EOD に行う。
3. **Supabase migration deploy フロー**: 本書 §5.2 で `supabase db push` を確定したが、Sprint 1 までドキュメント化されていなかった。実行権限のあるメンバーは現状 1 名 (オーナーアカウント)、Phase 1b で複数名対応。
   Mitigation: migration 実行前に §5.2 のコマンドを staging で必ず先行検証し、dry-run 出力を 1Password に保存する。
4. **OpenAI Realtime Translation beta access**: API key が beta access を保有していることを Sprint 2 Day 1 に確認 (現状 owner アカウントのみ確認済、追加開発者は別途申請)。
   Mitigation: beta access が取得できない場合は Whisper streaming + GPT-4o text → TTS の段組み代替パイプラインを Phase 1b 候補として保持する。
5. **LiveKit Cloud Free tier の消費**: Gate Check 30 分 × 複数回で残量 5,000 min を消費。Phase 1a で Build tier ($50) に上げる判断が必要かもしれない (Sprint 2 中盤)。
   Mitigation: dry-run 中は 1 セッション 30 分以内に制限する。Free tier 上限 5,000 participant-min/月の 50% (= 2,500 participant-min) に到達した時点で Pro tier (Build tier $50/月) 移行を検討する。
6. **HMAC secret rotation 中の整合**: 本書 §8.3 で同時更新を必須としたが、現状自動化なし。手順失敗で内部 API が止まるリスク。
   Containment: 旧 secret を 24h 並行 accept する dual-key 期間を設け、Vercel→Render 双方の env を順次更新する。ロールバック時は旧 secret を復活させる手順を事前に用意しておく。
7. **Render Singapore リージョン**: Tokyo 未提供のため。LiveKit Cloud (Tokyo) との間で 50-80ms 程度のレイテンシ加算、PERF-002 への影響を Gate Check で計測。
   Mitigation: 日本ユーザー向けレイテンシが p95 で 400ms を超える場合、Phase 1b で Tokyo region (Render が対応する場合) または別 PaaS への移設を検討。
8. **OpenAI Realtime API rate limit**: beta access では RPM/TPM 制限が厳しい場合がある。Gate Check 中に 429 が頻発した場合は中断し OpenAI に quota 引き上げを申請する。
   Mitigation: dry-run 中は同時セッション数を 1 に制限し、429 発生時は exponential backoff で再接続。Phase 1b で OpenAI 組織 tier 引き上げを申請。
9. **Supabase Free tier の制限**: バックアップ機能なし (誤 migration / データ誤削除は復元不可)、同時 DB 接続数 60 上限。Phase 1a の staging は使い捨て前提、production 切替前に必ず Pro plan に移行。
   Mitigation: Phase 1a dry-run 期間中はステータスを「使い捨て staging」と位置づけ、マイグレーション前に SQL ダンプを手動バックアップする。
10. **NODE_ENV と ENVIRONMENT の役割分離**: Render/Vercel に投入する `NODE_ENV` は config.ts Zod enum (development/test/production) 制約のため `production` 固定。staging/prod の論理的環境識別は別途 `ENVIRONMENT` 環境変数で行う。
    Mitigation: `NODE_ENV` は Zod enum 制約により誤設定が起動時に検出される。`ENVIRONMENT` の Zod validation 追加は §13 #11 の Sprint 2 別タスクで対応する。
11. **`ENVIRONMENT` / `correlation_id` 未実装 (Sprint 2 内タスク)**: `ENVIRONMENT` 環境変数は `apps/translation-agent/src/config.ts` および `apps/server/src/config.ts` のいずれにも未定義 (2026-05-12 時点)。`correlation_id` も両サービスの logger で未実装。§11.4 の横断調査フローは実装完了後に有効化される。
   Mitigation: 本 PR では実装変更を行わず、Sprint 2 内の別タスク (config.ts + logger 修正) として管理し、チケットで追跡する。

---

## 14. 改訂履歴

- v1 (2026-05-12) 初版。Sprint 2 D2 として `docs/deploy.md` (overall 設計) を補完する実行手順を canonical 化。`render.yaml` / `vercel.json` の雛形、env vars 配布マトリクス、Supabase migration 実行手順、dry-run チェックリスト、ロールバック手順を含む。
- v1.1 (2026-05-12): NODE_ENV/ENVIRONMENT 役割分離 (§13 #10)、vercel.json adapter 注記 (§4.2)、ロールバック発動基準 (§10.0)、§13 risk 追加。§2.3 (secrets 保管 / 1Password vault 構造) 新設。§10.5 (インシデント対応プロトコル) 新設。§11.4 (横断調査クエリ例) 新設。§9.4 (ナビゲーション) 追記。§11.1 Sentry 代替記述。§3.1 / §8.2 autoDeploy 警告。§12 label 注記。目次追加。
- v1.2 (2026-05-12): Round 2 レビュー指摘 Critical 3 + Major 7 + Minor 3 を反映。§10.0 RLS テストコマンドを実在しない packages/db から supabase/tests/rls + Dashboard 目視に差し替え (Fix-1)。§5.2 schema 一覧を実 7 schema (trancall_event 等) に修正、translation 関連テーブルは trancall_event 配下と注記 (Fix-2)。§10.0 Worker ヘルス判定を /health 失敗から Crashed/Logs 無出力に修正 (Fix-3)。§11.4 冒頭に correlation_id / ENVIRONMENT 未実装の代替相関注記を追加、§13 #11 に Sprint 2 内タスクとして追記 (Fix-4)。§4.2 vercel.json コミット時 build 失敗の警告強化、§13 #2 更新 (Fix-5)。§10.5 インシデント記録テンプレ追加 (Fix-6)。§13 risks #1/#3/#4/#6 に mitigation/containment 追記 (Fix-7)。目次 6 項目を実節タイトルと完全一致に修正 (Fix-8)。§14 v1.1 改訂履歴を補完し v1.2 行を追加 (Fix-9)。§2.3 1Password CLI 前提追記 (Fix-10)。§9.4 WS 切断ログ例 + agent_metrics Dashboard 確認手順追記 (Fix-11)。
- v1.3 (2026-05-12): Round 3 指摘 Major 5 + Minor 4 反映 — §5.2 supabase db push --linked が env var 上書き不可な動作不整合を解消し link 切替手順 (step 1 staging 明示 / step 6.5 re-link / step 7 env var 削除 / 末尾注記) に書換、§14 v1.1 改訂履歴の §1.3→§2.3 番号誤記修正、§9.4 agent_metrics の実在しないカラム名 (partial/final_latency_ms_p95) を実 schema (latency_ms JSONB / totalEndToEnd) に対応、§6.2 に Phase 1a 単一キー配布の明示注記追加、§11.4 を Phase 1a (暫定運用) と Phase 1b 以降 (correlation_id 実装後) の 2 サブ節に再構成し冒頭注記との矛盾解消。Minor: §5.2 architecture.md 参照を §2 から §6 (データベース設計) に修正、§13 #2/#5/#7/#8 に mitigation 補完、§13 #6 typo (「で 同時」→「で同時」) 修正、§9.4 gate-check コマンドに staging 向け env var (TRANCALL_SERVER_URL) 付与例を追記、§12 に LiveKit 2 キー分離 (Phase 1b 以降) を追加。
- v1.4 (2026-05-12): Round 4 残存 Minor 4 件反映 — §13 #5 mitigation 数値を 5,000 participant-min/月の 50% (= 2,500) に修正、§13 #10 mitigation 追加で全 11 リスク mitigation 完備、§5.2 step 7 `--include-all` フラグ意図のインラインコメント、§9.4 agent_metrics JSONB 構造例追加
- v1.5 (2026-05-12): Round 5 残存 Minor 2 件反映 — §13 #11 に Mitigation: ラベル付与で全 11 リスクの形式統一達成、§5.2 step 5 に staging 初回セットアップ時の `--include-all` 付与条件をインラインコメントで補足
- v1.6 (2026-05-12): Round 6 残存 Minor 1 件反映 — §5.2 step 5 を 5a (staging 初回 seed 未適用、`--include-all`) / 5b (2 回目以降) の条件分岐構造に再構成し operator のコピーペースト誤操作リスクを排除
