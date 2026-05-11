# TranCall デプロイ設計

> 第11回レビューで「最初からクラウド」「Proxmox オンプレは廃止」「LiveKit Cloud を採用」
> という方針が確定したため、旧設計（Proxmox LXC `.207/.208` 固定IP）から全面的に書き直した。

## 1. システム構成図（クラウド前提）

```
                      ┌──────────────────────────────────┐
                      │       Cloudflare                  │
                      │  DNS + WAF + Rate Limit           │
                      └──────────┬───────────────────────┘
                                 │
            ┌────────────────────┼─────────────────────────┐
            ▼                    ▼                         ▼
  ┌──────────────────┐  ┌──────────────────┐   ┌──────────────────┐
  │  API Server      │  │  LiveKit Cloud   │   │ Translation      │
  │  (Vercel)        │  │  (managed SFU)   │   │ Agent (Render or │
  │                  │  │                  │   │  Fly.io)         │
  │  apps/server     │  │  - SFU            │   │                  │
  │  Next.js / Node  │  │  - TURN / STUN    │   │ apps/translation-│
  │                  │  │  - Token verify   │   │ agent (Node.js)  │
  └────────┬─────────┘  └────────┬─────────┘   └────────┬─────────┘
           │                     │                       │
           ▼                     │                       ▼
  ┌──────────────────┐           │             ┌──────────────────┐
  │  Supabase Cloud  │           │             │  OpenAI API      │
  │  (Postgres +     │           │             │  GPT-RT-Translate│
  │   Auth + Realtime│           │             │                  │
  │   + Storage)     │           │             └──────────────────┘
  └──────────────────┘           │
                                 │
                       (RTC media は LiveKit Cloud の
                        グローバルエッジを直接利用)
```

すべて **マネージドサービス**で構成し、サーバーOS / ネットワーク / ファイアウォール / TLS 終端を自前で持たない。
これにより Phase 1a の TestFlight 期間は **インフラ運用に時間を取られない**。

## 2. コンポーネント別デプロイ設計

### 2.1 API Server（apps/server）

| 項目 | 値 |
|------|-----|
| ホスティング | **Vercel** |
| ランタイム | Node.js 22 |
| リージョン | Tokyo (hnd1) |
| ドメイン | api.trancall.app |
| デプロイ | GitHub push → Vercel 自動デプロイ |
| 環境変数 | Vercel Dashboard（`.env.server.example` 参照） |

ホスティング判断:
- Next.js Server / REST API / Server Action は Vercel で動く（実行時間制限内で完結する処理のみ）
- **WebSocket 常時接続を要する処理は Vercel に置かない**:
  - Translation Agent → 別ホスティング（2.3 参照）
  - LiveKit SFU → LiveKit Cloud（2.2 参照）
  - クライアント↔Server リアルタイム通信 → Supabase Realtime
- 内部 API `/internal/agent/events` は HMAC-SHA256 で検証（`apps/translation-agent/src/internal-api-client.ts` と同じ鍵）

### 2.2 LiveKit SFU（マネージド）

| 項目 | 値 |
|------|-----|
| ホスティング | **LiveKit Cloud**（managed、Apache 2.0 ベース） |
| プラン | Phase 1a: Free tier（5,000 participant-min/月） |
| | Phase 1b 以降: Build tier（$50/月、50,000 minutes） |
| URL | `wss://trancall-xxxx.livekit.cloud`（プロジェクト作成時に発行） |
| TURN/STUN | LiveKit Cloud に統合済み |
| グローバル展開 | 自動（東京・米西海岸・EU など複数リージョン） |

採用理由:
- WebRTC SFU は UDP / TCP ポートを直接握る host networking が必要で、Vercel のような serverless では構造的に動かない
- 自前ホスト（Render / Fly.io / Cloud Run）でも稼働は可能だが、グローバルエッジを自前で構築するコストが Phase 1a の費用対効果に合わない
- LiveKit Cloud は Free tier だけで TestFlight 100名 × 1人あたり 50分/月 = 5,000 分まで賄える計算

注意点:
- API Key / Secret は **Vercel と Translation Agent ホスティング**にだけ環境変数として配布する。クライアントには絶対に渡さない（Token 発行は Server 側で完結）

### 2.3 Translation Agent（apps/translation-agent）

| 項目 | 値 |
|------|-----|
| ホスティング | **Render（Background Worker）が第一候補** |
| 代替案 | Fly.io / Google Cloud Run（min-instances=1 必須） |
| プラン | Render Starter ($7/月、512MB / 0.5 CPU、Always-on) |
| OS | Linux x86_64（@livekit/rtc-node の native binding が動く） |
| プロセス管理 | Render の Background Worker（再起動・ヘルスチェック内蔵） |
| 自動再起動 | Render が exit 時に自動再起動 |
| メモリ上限 | 512 MB / プロセス |
| 環境変数 | Render Dashboard（`.env.agent.example` 参照） |
| デプロイ | GitHub push → Render 自動デプロイ |

採用理由:
- Translation Agent は **LiveKit Server との WebSocket 常時接続 + OpenAI Realtime API への別 WebSocket** を持つため、Vercel の Edge Function / Serverless Function では動かない
- Render の Background Worker は HTTP リクエストを受けない常駐プロセス専用で、料金が最も安く（$7/月）、Dockerfile デプロイが簡単
- LiveKit Cloud と同リージョンに置きたいので Tokyo 系の datacenter を選択（Render は Singapore が最寄り、Fly.io は `nrt`（Tokyo）あり）

代替評価:
| プラットフォーム | 月額 | Tokyo | Memo |
|---|---|---|---|
| Render Background Worker | $7 | Singapore | 設定が最も簡単、Dockerfile or Build Cmd |
| Fly.io Machine | $0〜$3（使用分） | あり（nrt） | グローバル展開しやすい、CLI 慣れ要 |
| Google Cloud Run (always-on) | $10〜（min-instances=1） | あり（asia-northeast1） | min-instances=1 を必ず設定（idle 停止すると Job 取り逃がす） |
| Railway | $5〜 | US | 安いが日本リージョン不在 |

Phase 1a Sprint 0 で **Render に dry-run デプロイ** → Sprint 1 で gate-check を回して採否確定。

スケーリング:
- Phase 1a: 1 ワーカー（同時 10 通話、各 1〜2 翻訳セッション）
- Phase 1b: 2〜3 ワーカー（Render は同じサービスで manual scaling、Fly.io は `fly scale count`）
- Phase 1c: Agent dispatch を `agentName` ベースに切り替え、Worker pool に分割

### 2.4 Supabase

| 項目 | 値 |
|------|-----|
| ホスティング | **Supabase Cloud** |
| プラン | Phase 1a: Free → Phase 1b: Pro ($25/月) |
| リージョン | ap-northeast-1 (Tokyo) |
| DB | Postgres 15+ |
| 認証 | Supabase Auth (email + Google + Apple OAuth) |
| Realtime | Supabase Realtime (WebSocket) |
| Storage | アバター画像・トランスクリプト PDF |

### 2.5 Cloudflare

| サービス | 用途 |
|---------|------|
| DNS | trancall.app ドメイン管理 |
| WAF | DDoS 防御、Rate Limit、Bot Fight |
| TLS | trancall.app 系の Universal SSL |

注意:
- LiveKit Cloud は `livekit.cloud` ドメイン直接利用（Cloudflare の前段は不要）
- Vercel は Cloudflare 経由でも直接でもよいが、Cloudflare 経由にすると Apple App Site Association のキャッシュ制御が容易

ルーティング:
```
trancall.app           → Vercel（ランディング・Universal Links）
api.trancall.app       → Vercel（API Server）
livekit-xxxx.livekit.cloud → LiveKit Cloud（直接、Cloudflare 経由しない）
```

Translation Agent には **公開ドメインを当てない**（インバウンドは LiveKit Server からの WebSocket のみ）。
内部 API のコールバック先 `https://api.trancall.app/internal/agent/events` は **Server → Cloudflare → Vercel** 経路。

## 3. 監視・ログ・アラート

### 3.1 メトリクス収集

| メトリクス | 収集元 | 方法 |
|----------|--------|------|
| 翻訳レイテンシ (p50/p95/p99) | Translation Agent | `internal-api-client` 経由で Server に送信 → Supabase に蓄積 |
| 通話ドロップ率 | LiveKit Cloud | LiveKit Cloud Dashboard / Webhook |
| API 応答時間 | API Server | Vercel Analytics（OpenTelemetry に拡張予定） |
| Agent ワーカー再起動 | Render | Render Dashboard + Webhook → Slack |
| Agent メモリ使用量 | Translation Agent | `process.memoryUsage()` を5秒ごとサンプリングし `agent.metrics` イベントで送信 |
| 同時通話数 | LiveKit Cloud | RoomServiceClient.listRooms |
| OpenAI API エラー率 | Translation Agent | カスタムカウンター（Sentry にも転送） |
| DB 接続数 | Supabase | Supabase Dashboard |

### 3.2 アラート条件

| 条件 | 重要度 | 通知先 |
|------|--------|--------|
| 翻訳レイテンシ p95 > 4s | Critical | Slack + メール |
| Agent プロセス再起動 | Warning | Slack |
| Agent メモリ > 450MB | Warning | Slack |
| LiveKit Cloud Free tier 残量 < 500 minutes | Warning | Slack |
| OpenAI 429 エラー 5回/分 | Critical | Slack + メール |
| 同時通話数 > 8（Phase 1a 上限10の80%） | Warning | Slack |
| Supabase DB 接続数 > 80% | Warning | Slack |

### 3.3 ログ設計

| コンポーネント | ログ出力先 | 保持期間 |
|-------------|---------|---------|
| API Server | Vercel Logs（自動） | 30日 |
| Translation Agent | stdout JSON Lines → Render Logs | 14日 |
| LiveKit SFU | LiveKit Cloud Dashboard | プランに依存 |
| Supabase | Supabase Dashboard | プランに依存 |

将来的に Sentry を追加して、Agent / Server の error log を集約する（Phase 1b）。

ログに含めてはいけないもの:
- 音声 PCM データ（Base64 含む）
- トランスクリプト本文（ID と sequence のみ）
- OpenAI API キー / LiveKit Secret / TRANCALL_AGENT_HMAC_SECRET
- ユーザーのメールアドレス（ハッシュ化してログ）

ログに含めるべきもの:
- correlation_id（通話ごとのトレース ID）
- agentJobId / roomId / sourceParticipantId（Branded UUID のまま）
- レイテンシ数値
- エラーコード・メッセージ

## 4. CI/CD パイプライン

```
GitHub push (main)
    │
    ├──→ GitHub Actions CI
    │    ├── pnpm install
    │    ├── lint (eslint)
    │    ├── typecheck (tsc --noEmit)
    │    ├── test (vitest run, all packages)
    │    └── build (turbo build)
    │
    ├──→ Vercel（API Server）
    │    └── GitHub Integration が自動デプロイ
    │
    └──→ Render（Translation Agent）
         └── GitHub Integration が自動デプロイ
              ├── Dockerfile build
              └── 既存ワーカーを Rolling Restart
```

すべて GitHub Integration で自動化する想定。SSH 経由のデプロイは廃止。

## 5. バックアップ・リカバリ

| 対象 | バックアップ | 頻度 | 保持 |
|------|------------|------|------|
| Supabase DB | Supabase 自動バックアップ | 日次 | Pro: 7日 |
| LiveKit Cloud | LiveKit 側の責任分界 | - | - |
| Vercel ビルド成果物 | Git tag + Vercel Deployment 履歴 | コミット時 | 90日 |
| Render ビルド成果物 | Git tag + Render Deployment 履歴 | コミット時 | プランに依存 |
| 環境変数 | 1Password Vault（手動同期） | 更新時 | 永続 |

## 6. ドメイン・証明書

| ドメイン | 用途 | 証明書 |
|---------|------|--------|
| trancall.app | ランディング + Universal Links | Vercel + Cloudflare |
| api.trancall.app | API Server | Vercel + Cloudflare |
| trancall-xxxx.livekit.cloud | LiveKit SFU WebSocket | LiveKit Cloud 提供 |

Apple Universal Links / Android App Links:
- `https://trancall.app/.well-known/apple-app-site-association`
- `https://trancall.app/.well-known/assetlinks.json`
- 招待リンク `https://trancall.app/invite/{token}` のディープリンク対応

## 7. 旧設計（オンプレ Proxmox）からの変更点

| 旧設計 | 新設計（Phase 1a 〜） | 理由 |
|---|---|---|
| LiveKit を Proxmox LXC `.207` に設置 | LiveKit Cloud | グローバル展開時のエッジネットワークと TURN サーバを自前で構築する手間を回避 |
| Translation Agent を Proxmox LXC `.208` に設置 | Render Background Worker | Phase 1a の TestFlight 期間は管理しやすさ優先 |
| Cloudflare Tunnel 経由で公開 | Vercel / LiveKit Cloud / Render は直接公開 | Tunnel は内部資源を公開する用途、マネージドホストには不要 |
| 固定IP `.207/.208` の重複検証必要 | 不要（IP管理が消滅） | 全てクラウドホスト |
| LXC テンプレート 314 ベースで構築 | Render の Dockerfile（`node:22-bookworm`） | クラウドプロバイダ提供のイメージを使う |

将来的にコスト最適化が必要になれば、Phase 2 以降で **LiveKit セルフホスト + Fly.io / Cloud Run** に段階的に移行する選択肢を残す。
