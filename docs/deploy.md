# TranCall デプロイ設計

## 1. システム構成図

```
                    ┌─────────────────────────────────────┐
                    │          Cloudflare                  │
                    │   DNS + Tunnel + WAF                 │
                    └──────────┬──────────────────────────┘
                               │
               ┌───────────────┼──────────────────┐
               ▼               ▼                  ▼
    ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
    │  API Server       │ │ LiveKit SFU  │ │ Translation      │
    │  (Vercel)         │ │ (LXC)        │ │ Agent (LXC)      │
    │                   │ │              │ │                  │
    │  apps/server      │ │ livekit-     │ │ apps/translation-│
    │  Node.js          │ │ server       │ │ agent            │
    │                   │ │              │ │ Node.js or Python│
    └────────┬──────────┘ └──────┬───────┘ └────────┬─────────┘
             │                   │                   │
             ▼                   │                   ▼
    ┌──────────────────┐         │         ┌──────────────────┐
    │  Supabase Cloud   │         │         │  OpenAI API      │
    │  (PostgreSQL +    │         │         │  GPT-RT-Translate│
    │   Auth + Realtime)│         │         │                  │
    └──────────────────┘         │         └──────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │    LiveKit TURN/STUN     │
                    │    (LiveKit Cloud or     │
                    │     self-hosted coturn)  │
                    └─────────────────────────┘
```

## 2. コンポーネント別デプロイ設計

### 2.1 API Server（apps/server）

| 項目 | 値 |
|------|-----|
| ホスティング | **Vercel** (Serverless Functions) |
| ランタイム | Node.js 22 |
| リージョン | ap-northeast-1 (Tokyo) |
| ドメイン | api.trancall.app |
| CDN | Cloudflare (Vercelの前段) |
| デプロイ | GitHub push → Vercel自動デプロイ |
| 環境変数 | `.env.server.example` 参照 |
| スケーリング | Vercel自動スケール |

制約:
- Vercel Serverless Functionsは実行時間上限あり（Pro: 60秒、Hobby: 10秒）
- WebSocket長時間接続は不可 → Supabase Realtimeに委譲
- 内部API（/internal/*）はVercel Edge Middleware でAgent IP/署名を検証

Phase 1a代替案:
- Vercelが制約で合わない場合、Proxmox LXC (IP: .207) にNode.jsサーバーをデプロイ
- Cloudflare Tunnel経由で公開

### 2.2 LiveKit SFU

| 項目 | 値 |
|------|-----|
| ホスティング | **Proxmox LXC** (VMID: TBD) |
| IPアドレス | 192.168.70.207 (予定) |
| OS | Ubuntu 24.04 (LXCテンプレート314ベース) |
| CPU / メモリ | 4 core / 8 GB |
| ストレージ | 20 GB |
| 外部公開 | Cloudflare Tunnel → livekit.trancall.app |
| TURN/STUN | LiveKit組み込みTURN or coturn |
| 自動起動 | systemd |

設定ファイル: `/etc/livekit/config.yaml`
```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  tcp_port: 7881
keys:
  APIxxxxxxxx: <secret>
logging:
  level: info
```

Phase 1a → Phase 1c スケーリング:
- Phase 1a: 単一LXC（同時10通話まで）
- Phase 1c: LiveKit Cloud への移行を検討（グローバル展開時）

### 2.3 Translation Agent（apps/translation-agent）

| 項目 | 値 |
|------|-----|
| ホスティング | **Proxmox LXC** (VMID: TBD) |
| IPアドレス | 192.168.70.208 (予定) |
| OS | Ubuntu 24.04 (LXCテンプレート314ベース) |
| CPU / メモリ | 2 core / 2 GB（Agent 1プロセスあたり） |
| ストレージ | 10 GB |
| プロセス管理 | **pm2** |
| 自動再起動 | pm2 + systemd |
| メモリ上限 | 512 MB / プロセス |
| 最大Room数 | 10 / プロセス |

pm2設定: `ecosystem.config.cjs`
```javascript
module.exports = {
  apps: [{
    name: "trancall-agent",
    script: "dist/index.js",
    instances: 1,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      AGENT_MAX_ROOMS: "10",
    },
    // 自動再起動設定
    exp_backoff_restart_delay: 1000,
    max_restarts: 10,
    restart_delay: 1000,
  }]
};
```

スケーリング:
- Phase 1a: 1プロセス（同時10 Room）
- Phase 1c: 2-3プロセス（pm2 cluster mode）
- Phase 2: 別LXCに分離、ロードバランサー追加

### 2.4 Supabase

| 項目 | 値 |
|------|-----|
| ホスティング | **Supabase Cloud** |
| プラン | Pro ($25/month) |
| リージョン | ap-northeast-1 (Tokyo) |
| DB | PostgreSQL 15+ |
| 認証 | Supabase Auth (email + OAuth) |
| リアルタイム | Supabase Realtime (WebSocket) |
| ストレージ | Supabase Storage (アバター画像用) |

### 2.5 Cloudflare

| サービス | 用途 |
|---------|------|
| DNS | trancall.app ドメイン管理 |
| Tunnel | LXCサーバーの外部公開（API/LiveKit/Agent） |
| WAF | DDoS防御、Rate Limiting |
| SSL/TLS | 全エンドポイントのTLS終端 |

Tunnelルーティング:
```
api.trancall.app      → 192.168.70.207:3000 (API Server or Vercel)
livekit.trancall.app  → 192.168.70.207:7880 (LiveKit SFU)
agent.trancall.app    → 192.168.70.208:3001 (Translation Agent 内部)
```

## 3. 監視・ログ・アラート

### 3.1 メトリクス収集

| メトリクス | 収集元 | 方法 |
|----------|--------|------|
| 翻訳レイテンシー (p50/p95/p99) | Translation Agent | gate-check.ts / カスタムメトリクス |
| 通話ドロップ率 | LiveKit SFU | LiveKit Dashboard / Webhook |
| API応答時間 | API Server | Vercel Analytics or カスタム |
| WebSocket再接続回数 | Translation Agent | pm2 logs + カスタムカウンター |
| メモリ使用量 | Translation Agent | pm2 monit |
| 同時通話数 | LiveKit SFU | LiveKit Server SDK roomList |
| OpenAI APIエラー率 | Translation Agent | カスタムカウンター |
| DB接続数 | Supabase | Supabase Dashboard |

### 3.2 アラート条件

| 条件 | 重要度 | 通知先 |
|------|--------|--------|
| 翻訳レイテンシー p95 > 4秒 | Critical | Slack + メール |
| Agent プロセス再起動 | Warning | Slack |
| Agent メモリ > 450MB | Warning | Slack |
| LiveKit SFU CPU > 80% | Warning | Slack |
| OpenAI 429エラー 5回/分 | Critical | Slack + メール |
| 同時通話数 > 8 (上限10の80%) | Warning | Slack |
| DB接続数 > 80% | Warning | Slack |

### 3.3 ログ設計

| コンポーネント | ログ出力 | 保持期間 |
|-------------|---------|---------|
| API Server | Vercel Logs (自動) | 30日 |
| Translation Agent | pm2 logs → ファイル | 14日 (logrotate) |
| LiveKit SFU | systemd journal | 14日 |
| Supabase | Supabase Dashboard | プランに依存 |

ログに含めてはいけないもの:
- 音声データ
- トランスクリプト本文
- OpenAI APIキー
- ユーザーのメールアドレス（ハッシュ化してログ）

ログに含めるべきもの:
- correlation_id（通話ごとのトレースID）
- session_id
- room_id
- participant_id（ブランド型のまま）
- レイテンシー数値
- エラーコード・メッセージ

## 4. CI/CD パイプライン

```
GitHub push (main)
    │
    ├──→ GitHub Actions CI
    │    ├── lint
    │    ├── typecheck
    │    ├── test (unit + RLS)
    │    └── build
    │
    ├──→ Vercel (API Server)
    │    └── 自動デプロイ（Vercel GitHub Integration）
    │
    └──→ [手動 or Webhook] LiveKit SFU / Translation Agent
         ├── SSH → LXC
         ├── git pull
         ├── pnpm install --frozen-lockfile
         ├── pnpm turbo build --filter=@trancall/app-translation-agent
         └── pm2 reload trancall-agent
```

Phase 1a では Translation Agent のデプロイは手動 SSH。
Phase 1c で GitHub Actions → SSH デプロイの自動化を検討。

## 5. バックアップ・リカバリ

| 対象 | バックアップ | 頻度 | 保持 |
|------|------------|------|------|
| Supabase DB | Supabase自動バックアップ | 日次 | 7日 |
| LiveKit設定 | Git管理 | コミット時 | 永続 |
| Agent設定 | Git管理 | コミット時 | 永続 |
| LXC全体 | Proxmox vzdump | 週次 | 4世代 |

## 6. ドメイン・証明書

| ドメイン | 用途 | 証明書 |
|---------|------|--------|
| trancall.app | Webサイト + ディープリンク | Cloudflare自動 |
| api.trancall.app | API Server | Cloudflare自動 |
| livekit.trancall.app | LiveKit SFU WebSocket | Cloudflare自動 |

Apple Universal Links / Android App Links:
- `trancall.app/.well-known/apple-app-site-association`
- `trancall.app/.well-known/assetlinks.json`
- 招待リンク `trancall.app/invite/{token}` のディープリンク対応
