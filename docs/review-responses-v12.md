# Review Responses v12 — Sprint 1 完了報告

| | |
|---|---|
| Date | 2026-05-12 |
| Phase | Sprint 1 → Sprint 2 移行 |
| Status | Draft (本書の合意で Sprint 1 クローズ) |
| 前回 | `docs/review-responses-v11.md` (2026-05-12 朝、Layer 1-A 完了時点) |
| 次回 | v13 = Sprint 2 中間レビュー (Layer 5 着手後) |

v7/v8 と同様に v12 もスキップせず発行。本書は「review への返答」フォーマットを継承するが、内容は **Sprint 1 全体の完了スナップショット + Sprint 2 引き継ぎ** とする。

---

## 1. Sprint 1 の到達点 (一行要約)

**10 モジュール + 4 アプリのうち、モバイルアプリ Layer 1〜4 を実装完了**。Phase 1a の Gate Check 実走と translation-agent ↔ OpenAI 音声パイプライン完成は Sprint 2 に持ち越し。

---

## 2. マージ済み PR (Sprint 1 全期間)

時系列で 26 PR。直近の Layer 4 のみ番号確定、それ以前は git 履歴参照。

| Layer | PR | 内容 | main マージ |
|---|---|---|---|
| 1-A | (#1〜#10 系) | shared-kernel / auth / media (C-005 含む) / DB migrations 6 本 | 2026-05-12 朝 |
| 1-B | (#11〜#17 系) | billing / contact / notification / transcript / translation / ui-kit / integration-tests | 2026-05-12 午前 |
| 2 | #18 | room facade (DomainEvent 構造を `payload: {}` nested に統一) | 2026-05-12 |
| 3-A | #19 | translation-agent 実装 (agents-js 1.0 / OpenAI WS / 内部 API) | 2026-05-12 |
| 3-B | #20 | apps/server (Fastify + DI + Supabase Repository 13 ファイル + 11 routes) | 2026-05-12 |
| Lint | #23 | Zod v4 統一 + warning 158→97 | 2026-05-12 |
| Design | #21 | TranCall Design System (canonical UI 仕様) 配置 | 2026-05-12 |
| 4-A | #22 | Expo skeleton + Auth/Onboarding (SCR-001/Login/SignUp) | 2026-05-12 |
| 4-B | #25 | 一般画面 5 screens (Home/Contacts/Settings/AddContact/ContactProfile) | 2026-05-12 00:24 |
| 4-C | #26 | 通話画面 4 screens + LiveKit/CallKit/VoIP 統合 (TS 層のみ) | 2026-05-12 00:50 |
| 4-D | #24 | 通話後 2 screens (CallSummary/FullTranscript) | 2026-05-12 00:09 |

main HEAD: `49822a0` (Layer 4-C マージ)

---

## 3. Layer 別の成果サマリ

### Layer 1-A: 基盤 (`shared-kernel` / `auth` / `media`)
- BrandedType, Result<T>, DomainEventBase, language schema を `shared-kernel` に集約
- `AuthFacade.getProfile` 実装、Repository interface のみ (実装は Layer 3-B server 側 Supabase 具象)
- `MediaFacade.issueAccessToken` で **C-005** を実装: client は `nativeLanguage` を渡さず、サーバが DB から取得して LiveKit Token metadata に焼き込む、`canUpdateOwnMetadata=false`

### Layer 1-B: ドメインモジュール 5 種
| パッケージ | facade 主要メソッド | テスト |
|---|---|---|
| billing | reserveMinutes (冪等), confirmHeartbeat, reconcile, getPlanInfo | 8 ファイル |
| contact | addContact, blockUser, searchContacts, generateInvite | 1 (要追加) |
| notification | registerDevice, sendIncomingCall, sendMissedCall | 4 ファイル |
| transcript | recordSegment, validateLiveDelta, search, exportTranscript (501 stub) | 5 ファイル |
| translation | shouldStartSession (同言語判定), startSession | 4 ファイル |

### Layer 2: room
- `RoomFacade` = createCall / joinCall / endCall / getState
- 依存: billing.canStartCall, media.createRoom, notification.sendIncomingCall (best-effort)
- DomainEvent 構造を `payload: {}` nested に統一 (auth/translation と同形)
- `billing.reserveMinutes / reconcile` は Layer 3-B server 責務に隔離

### Layer 3-A: translation-agent (別プロセス)
- agents-js 1.0 の `defineAgent({ entry })` パターン
- OpenAI Realtime WS: 自動再接続 (exponential backoff 最大 60s)、30s heartbeat
- internal-api-client: HMAC-SHA256 で `/internal/agent/events` を叩く
- 5 テストファイル
- **未完了**: AudioFrame → OpenAI → LiveKit publish の実接続パイプライン (Sprint 2 P0)

### Layer 3-B: apps/server
- Fastify + DI container (`container.ts`) で 10 facade + Repository 具象 13 ファイルを組み立て
- 11 routes: auth / room / billing / contact / notification / transcript / agent (HMAC) / health
- `EventBus` (in-process pub/sub、Phase 2 で Redis/Kafka)
- middleware: auth, hmac, error-handler
- 10 テストファイル + `app.inject()` パターン

### Layer 4: mobile (Sprint 1 のメイン成果)
- **15 screens** 実装済み (SCR-001 〜 SCR-012 + Login/SignUp + placeholder tab)
- **6 stores** (Zustand v5 curried): auth, call, contacts, recent-calls, subtitle, transcript
- **5 API clients** (Result<T> + Zod safeParse)
- **6 navigation** (auth-stack / root / main-tabs / contacts / recent / settings / call-overlay)
- **lib/callkit** (3 ファイル、Phase 1b 用 scaffold + DI 差し替え可能設計)
- **lib/livekit** (3 ファイル: connect 鴨型 / audio-routing / subtitles DataChannel)
- **6 components** (call-controls, subtitle-overlay-live, stats-card, transcript-search-bar/-segment-row, empty-state, recent-call-row)
- **12 テストファイル** (Vitest + fetch stub)

### ui-kit
- 11 コンポーネント (Avatar系/Badge/Button/CallCard/Card/ContactRow/Input/LanguagePicker/PlanCard/SubtitleOverlay)
- tokens.ts に `callBg: "#1C1C1E"` 追加 (Layer 4-C で light/dark 共通 dark surface)
- i18n: ja/en/zh 全 289 キー (zh は v9 で全面翻訳)

### integration-tests
- 4 ファイル / 15 件: call-flow, billing-heartbeat, contact-block, transcript-translation
- in-memory mock で facade 間結合シーケンスを検証

---

## 4. テスト総数

| カテゴリ | ファイル数 |
|---|---|
| packages (11 モジュール) | 40 |
| apps/server | 10 |
| apps/translation-agent | 5 |
| apps/mobile | 12 |
| **合計** | **67 ファイル** |

直近実測 (PR #26 マージ後):
- ui-kit: 47 tests / 5 files
- app-mobile: 166 tests / 12 files
- packages 全体は CI 上で **全 SUCCESS** (lint/typecheck/test 23-24 タスク)

---

## 5. DB Migrations (Supabase)

6 ファイル、`supabase/migrations/`:
1. initial schema (purchase_channel 採用、iap_platform 廃止 — v10 で確定)
2. translation_sessions (`ended_reason` 列名で予約語回避)
3. agent_metrics (`latencyMs` は JSONB)
4. RLS strengthening
5. indexes
6. translation_sessions.agent_job_id UNIQUE (冪等性保証、PR #15 系)

---

## 6. canonical 文書の状態 (本 v12 で確定)

| 文書 | 状態 | 備考 |
|---|---|---|
| `docs/requirements.md` | 安定 | PERF/AVAIL 数値は目標のみ、実測未着手 |
| `docs/architecture.md` | 安定 | Section 10 CI/CD のみ、observability 章は Sprint 2 で追加 |
| `docs/module-contracts.md` | 安定 (v1.0.0) | Layer 1 完了時点抽出、Layer 3 で `translation.degraded/recovered` 追記予定 |
| `docs/design/design-system.md` | 安定 | UI 仕様 canonical、L151 で通話画面 dark surface 固定明記 |
| `docs/test-strategy.md` | **要更新** | "Detox or Maestro" 表記が残る。v12 で Maestro 確定したため別 PR で反映 |
| `docs/e2e-test-design.md` | **新規 (本日)** | Maestro 採用確定、Phase 1a でコード 0 行 |

---

## 7. 未実装 / Phase 2 / Sprint 2 送り

### P0 (Sprint 2 必須)
1. translation-agent → OpenAI AudioFrame pipeline 完成
2. Gate Check (`scripts/gate-check.ts`) 実走、PERF-002 p50/p95/p99 初回計測
3. Render / Fly.io dry-run デプロイ

### P1 (Sprint 2 推奨)
- `exportTranscript` PDF/TXT 実装 (現状 501 stub)
- `GET /api/rooms/history` 実装 (mobile recent-calls-store が待機中)
- callkeep 代替の自前 Native Module 設計・実装 (CallKit/ConnectionService)
- APNs VoIP Push 詳細実装 + FCM
- billing store → mobile UI 結合 (Home の残量、Pre-call のコスト見積もり)
- `translation.degraded/recovered` DomainEvent + LiveKit Data Channel 配信
- ESLint `no-restricted-imports` で依存違反を CI ブロック

### P2 (Phase 1c 以降)
- Stripe 課金 UI / IAP / プラン管理 UI
- QR コード連絡先追加 / 端末連絡先インポート
- contact-profile → pre-call 発信導線
- `X-Agent-Timestamp` リプレイ攻撃防止 (5 分以内チェック)
- recent-calls-store の server 履歴取得実装
- E2E (Maestro) の P0 12 flows + CI 統合 — `docs/e2e-test-design.md` §8 参照

### 既知の小ズレ (実害なし、次回 docs sweep)
- `packages/media/CLAUDE.md` に「auth を直接 import しない」記述残存 (C-005 対応後は import OK)
- Agent 側 `latencyMs[*] = z.number()` vs Server 側 `nonnegative()` — Agent 側を将来揃える

---

## 8. Sprint 1 中に確定した設計判断 10 項目

1. **C-005**: LiveKit Token metadata はサーバが DB から `nativeLanguage` を焼き込む
2. **agents-js 1.0 / Python fallback 廃止**: `defineAgent({ entry })` 単一パターン
3. **Expo SDK 54 + Legacy Architecture opt-out**: New Arch 移行は Phase 1b 以降
4. **OpenAI 接続は WebSocket 先行**: WebRTC は Sprint 2 比較計測
5. **StoreKit External Purchase 採用**: `storekit_external` チャネル (日本市場対応)
6. **purchase_channel 列・iap_platform 廃止**: v10 migration 修正済み
7. **全マネージドクラウド**: Proxmox LXC 廃止、LiveKit Cloud + Supabase Cloud + Render
8. **`exportTranscript` 501 stub で Sprint 1 完了**: 実装は Sprint 2
9. **i18n zh 全 289 キー翻訳完了**: v9 で全面書き直し
10. **DomainEvent 構造 `payload: {}` nested に統一**: PR #18 で room 側を移行、auth/translation と同形

---

## 9. Sprint 2 オープニング Action Items

| # | Action | Owner | 期限 |
|---|---|---|---|
| A1 | `docs/test-strategy.md` を Maestro 確定で更新 PR (Detox 言及削除) | Opus | Sprint 1 クローズ前 |
| A2 | Sprint 2 着手判断会議 (P0 3 項目の順序確定) | プロダクト | Sprint 2 Day 1 |
| A3 | translation-agent pipeline 設計レビュー (OpenAI 接続パターンの確定) | バックエンド | Sprint 2 Day 1-2 |
| A4 | Render dry-run 環境準備 (env vars / Supabase 接続) | DevOps | Sprint 2 Day 3 まで |
| A5 | callkeep 代替の調査 → `docs/native-call-bridge.md` 起票 | モバイル | Sprint 2 Day 1-3 |
| A6 | `docs/module-contracts.md` v1.1.0 起票 (translation.degraded/recovered 追加) | バックエンド | Layer 5 着手時 |

---

## 10. リスク & 申し送り

- **Gate Check 未実走**: Sprint 1 完了基準に「translation-agent パイプライン完成」が含まれていたが、AudioFrame → OpenAI → LiveKit publish の実接続は **未完了**。Sprint 2 で最優先。仕様上は CallKit 統合と同時並行可能。
- **テスト数の偏り**: contact (1 ファイル) と auth (1 ファイル) はテスト追加が薄い。Sprint 2 で reservation/heartbeat 系結合テストを伸ばすか、E2E 側でカバーするか方針確定が必要。
- **Worktree が 3 つ残存**: `/Users/horidaisuke/trancall-mobile-b/c/d` がローカルに残る。次の作業に入る前に整理推奨 (`git worktree remove`)。
- **E2E (Maestro) は Phase 1b スコープ**: Sprint 1 では設計書のみ確定、Sprint 2 で mock-server + P0 12 flows 実装。詳細は `docs/e2e-test-design.md`。

---

## 改訂履歴
- v12 (2026-05-12) Sprint 1 完了報告として初版。v11 までの review responses フォーマットを継承しつつ完了スナップショットを兼ねる。
