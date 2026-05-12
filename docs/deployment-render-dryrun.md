# Render dry-run デプロイ手順 (D2)

| | |
|---|---|
| Status | Draft v1 (2026-05-12) |
| Owner | DevOps / バックエンド |
| 目的 | Sprint 2 P0 (Gate Check 実走) の前提として、translation-agent / apps/server / Supabase を Render + Vercel + Supabase Cloud にスムーズに上げる |
| 上位文書 | `docs/deploy.md` (インフラ全体設計、canonical)、`docs/translation-pipeline-design.md` (D1) |
| 補助 | `docs/architecture.md` §10、`docs/review-responses-v12.md` §9 A4、`apps/translation-agent/Dockerfile` |
| 改訂条件 | Render/Vercel/Supabase の機能変更時 / dry-run の結果フィードバック反映時 |

本書は **Sprint 2 着手時に環境構築で迷わない** ための具体的手順を canonical 化する。`docs/deploy.md` が「**なぜ何を選んだか**」を扱うのに対し、本書は「**どう構築・確認するか**」のオペレーション側を扱う。

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
- 全 secrets は **1Password Vault `TranCall-Infra`** に保存 (Sprint 1 で運用合意済、`docs/deploy.md` §5)
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
| `NODE_ENV` | `production` (prod) / `staging` (staging) | |
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

### 4.1 プロジェクト作成
1. Vercel Dashboard → New Project → Import `DaisukeHori/trancall`
2. Project Name:
   - staging: `trancall-api-staging` (Preview Deployment はこの Project から自動)
   - production: `trancall-api-prod`
3. Root Directory: `apps/server`
4. Framework: **Other** (Node.js raw、Next.js ではない)
5. Build Command: `pnpm turbo run build --filter=@trancall/app-server`
6. Output Directory: `dist`
7. Install Command: `corepack enable && pnpm install --frozen-lockfile`
8. Node.js version: **22** (`engines.node` で固定)
9. Region:
   - production: **hnd1** (Tokyo)
   - staging: hnd1 (同上、レイテンシ揃え)

### 4.2 `vercel.json` (Sprint 2 で初版作成)

```json
{
  "version": 2,
  "buildCommand": "pnpm turbo run build --filter=@trancall/app-server",
  "outputDirectory": "apps/server/dist",
  "installCommand": "corepack enable && pnpm install --frozen-lockfile",
  "functions": {
    "apps/server/dist/index.js": {
      "runtime": "nodejs22.x",
      "maxDuration": 30
    }
  },
  "regions": ["hnd1"],
  "rewrites": [
    { "source": "/(.*)", "destination": "/apps/server/dist/index.js" }
  ]
}
```

**注意**: Vercel Serverless は `apps/server` の Fastify を **コールドスタートあり** で動かす。LiveKit Token 発行は実行時間が短いので問題ないが、Stripe Webhook 等で 30 秒超の処理が必要になれば `vercel.json` の `maxDuration` を引き上げる (Pro plan で最大 300 秒)。

### 4.3 環境変数
`apps/server/src/config.ts` の Zod schema 完全一致:

| Key | Source | Production / Staging 共通? |
|---|---|---|
| `PORT` | Vercel が自動設定 | (Vercel デフォルト 3000 不要) |
| `NODE_ENV` | `production` / `staging` | 各 |
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

# 1. ローカルから target project を link
supabase link --project-ref <project-ref>
# project-ref は Dashboard URL `https://supabase.com/dashboard/project/{ref}` の {ref} 部分

# 2. migration を push (本番反映)
supabase db push

# 3. 確認: 6 migrations が applied されたか
supabase migration list
```

**注意**:
- `supabase db push` は **差分のみ適用** (idempotent)
- staging で先に試して問題ないことを確認してから production に push (順序厳守)
- production への push 前に **必ず staging で行う dry-run の出力を 1Password に保存**

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
  - `trancall-server-prod` (Vercel に配布)
  - `trancall-agent-prod` (Render に配布)
- 両方が **同じ Project の Key** であること (異なる project だと Token 認証失敗)

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

### 9.4 Gate Check 実行
- [ ] `pnpm --filter @trancall/app-translation-agent gate-check` をローカルから staging に向けて実行
- [ ] 30 分連続実行で WS 切断/再接続が記録される
- [ ] PERF-002 初回計測値 (`latencyMs` p50/p95/p99) が `agent_metrics` テーブルに記録される
- [ ] メモリ RSS が 450 MB 以下

### 9.5 観測確認
- [ ] Render Dashboard で CPU / Memory グラフが取れる
- [ ] Vercel Analytics で API レイテンシが見える
- [ ] Supabase Logs で SQL query が観察できる
- [ ] LiveKit Cloud Dashboard で room creation が見える

---

## 10. ロールバック手順

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

---

## 11. ログとアラート初期設定

### 11.1 Render
- Dashboard → Service → Logs (14 日保持、default)
- Webhook 設定: Settings → Notifications → "Deploy failed" / "Service crashed" → Slack incoming webhook
- 高度な log 集約は Phase 1b で Sentry / Datadog 追加

### 11.2 Vercel
- Dashboard → Deployments → Runtime Logs (30 日)
- Vercel Analytics は Hobby plan で 1000 events/日 (Phase 1a 上限内)

### 11.3 Supabase
- Dashboard → Logs → Postgres / API / Auth 別ビュー
- 高負荷時のスロークエリは Phase 1c で pg_stat_statements 拡張

### 11.4 LiveKit Cloud
- Dashboard → Rooms → 各通話の duration / participants 確認
- Webhook (room_started / room_ended) は Phase 1b で実装

### 11.5 Slack 通知
- `#trancall-alerts` チャンネル新設
- 初期: Render crash + Vercel deploy failed のみ
- Phase 1b で latency p95 警告、Free tier 残量警告を追加 (`docs/deploy.md` §3.2 参照)

---

## 12. Phase 1b 以降の改善 (deferred)

- Sentry 統合 (Agent + Server、`SENTRY_DSN` 既に config.ts で optional 定義済)
- CD 自動化 (`.github/workflows/deploy.yml` 追加、Render / Vercel への手動 promote を排除)
- Supabase Pro plan + 日次 backup
- LiveKit Cloud Build tier ($50/月) で 50,000 minutes
- Render Standard plan ($25/月) でメモリ 2 GB / CPU 1.0 にスケールアップ
- DNS failover (Cloudflare で Vercel と別ホストを multi-origin で利用)

---

## 13. 既知のリスク

1. **`render.yaml` 未作成**: 本書 §3.2 に雛形を canonical 化したが、Sprint 2 Day 1 に commit して Render Dashboard の "Sync from Blueprint" を実行する必要あり。
2. **`vercel.json` 未作成**: 同様、§4.2 雛形を Sprint 2 Day 1 に commit。`apps/server` を Fastify で動かす場合の Vercel での compatibility が未検証 (一般的に Express/Fastify を Vercel Serverless で動かすには adapter が必要)。**dry-run の最大リスク要因**。
3. **Supabase migration deploy フロー**: 本書 §5.2 で `supabase db push` を確定したが、Sprint 1 までドキュメント化されていなかった。実行権限のあるメンバーは現状 1 名 (オーナーアカウント)、Phase 1b で複数名対応。
4. **OpenAI Realtime Translation beta access**: API key が beta access を保有していることを Sprint 2 Day 1 に確認 (現状 owner アカウントのみ確認済、追加開発者は別途申請)。
5. **LiveKit Cloud Free tier の消費**: Gate Check 30 分 × 複数回で残量 5,000 min を消費。Phase 1a で Build tier ($50) に上げる判断が必要かもしれない (Sprint 2 中盤)。
6. **HMAC secret rotation 中の整合**: 本書 §8.3 で 同時更新を必須としたが、現状自動化なし。手順失敗で内部 API が止まるリスク。
7. **Render Singapore リージョン**: Tokyo 未提供のため。LiveKit Cloud (Tokyo) との間で 50-80ms 程度のレイテンシ加算、PERF-002 への影響を Gate Check で計測。

---

## 14. 改訂履歴

- v1 (2026-05-12) 初版。Sprint 2 D2 として `docs/deploy.md` (overall 設計) を補完する実行手順を canonical 化。`render.yaml` / `vercel.json` の雛形、env vars 配布マトリクス、Supabase migration 実行手順、dry-run チェックリスト、ロールバック手順を含む。
