# 第11回レビュー対応 (v11)

レビュー実施日: 2026-05-12
対応者: Claude (Anthropic)
対応ブランチ: `feat/11th-review-implementation`

## 対応サマリ

| 項目 | 状態 |
|---|---|
| C-001 agents-js Node 1.0 採用 / Python fallback 廃止 | ✅ 対応 |
| C-002 WebSocket vs WebRTC | ⏸ Phase 1a Sprint 1-2 で並行検証 |
| C-003 Translation Agent PoC スケルトン実装 | ✅ 対応 |
| C-004 iOS 27 / Phone Live Translation 差別化 | ✅ 対応（README 差別化表に明記） |
| C-005 Token metadata server-side 焼き込み | ✅ 実装 + テスト |
| M-001 README 差別化テーブル | ✅ Phone Live Translation の制約を明記 |
| M-002 モジュール循環依存 | ⏸ Sprint 0 で auth / media のみ着手、残りは Sprint 1 |
| M-003 2セッション課金検証 | 🚫 ユーザー指示により無視 |
| M-004 purchase_channel 中間状態 | ⏸ Sprint 1（billing モジュール着手時） |
| M-005 react-native-callkeep New Arch 対応 | ✅ 再調査 → SDK 54 で Legacy Arch opt-out 戦略採用 |
| M-006 Agent Job 重複 | ✅ agent-flow.md に防御策記載 |
| M-007 Expo SDK 53→54 移行 | ✅ SDK 54 採用方針確定 |
| M-008 電気通信事業届出 | 🚫 ユーザー指示により無視 |
| m-001 review-responses v7/v8 欠番 | ✅ 本ドキュメントで言及 |
| m-002 deploy.md 固定IP重複 | ✅ クラウド前提への書き直しで消滅 |
| m-003 agents-js パターン | ✅ defineAgent パターンに統一 |
| m-004 webhook idempotency | ✅ Idempotency-Key 実装 |
| m-005 AudioFrame 型境界 | ⏸ Sprint 1 |
| m-006 gate-check.ts スタブ | ✅ スケルトン実装（Room接続+模擬WAV+stdout記録） |
| m-007 OpenAI Safety Identifier | ⏸ Sprint 1 で session.update 時に追加 |
| m-008 LiveSubtitleDelta nullable | ⏸ Sprint 1 |
| m-009 Free 3分vs5分矛盾 | ⏸ Sprint 1 |
| m-010 TranCall ID 生成 | ⏸ Sprint 1 |
| m-011 iOS 26.2 MSCA 対応 | ✅ unit-economics.md は v10 で対応済み |

## 追加調査結果

### M-005 — react-native-callkeep の New Architecture 対応状況

再調査ポイント:
- 本家リポジトリ `react-native-webrtc/react-native-callkeep` は **2024年11月18日が最終リリース** (npm `4.3.16`)
- **Issue #866** (2025年12月10日 open のまま): TurboModule Interop が `displayIncomingCall` メソッドの重複定義をパースできずクラッシュ
- **Issue #798** (2024年7月): 同様の TurboModule Interop エラー（Android）
- Expo 公式 docs によれば、**2026年1月時点で EAS Build の約83%が New Architecture を採用** している
- `@imatis/react-native-callkeep` fork は 9ヶ月前最終更新（npm registry 上で他のプロジェクトに使われていない実質単独 fork）

判定:
1. Expo SDK 55 で Legacy Architecture が廃止される予定なので、**そのまま callkeep を使い続けるのは Phase 1b で詰む可能性が高い**
2. 退路: **SDK 54** を採用しつつ、Phase 1a〜1b は `newArchEnabled=false`（Legacy Arch opt-out）で逃げる
3. 中期: **Expo Modules API で自前 CallKit + ConnectionService ラッパーを書く**（Sprint 2-3 で見積もり）

### M-007 — Expo SDK 53 vs 54

判定: **SDK 54 採用**

主な根拠（Expo 公式 changelog / Callstack ライブストリーム）:
- 2025年8月19日 beta、2025年9月安定リリース → 半年枯らされている
- React Native 0.81 + React 19.1.0
- **iOS precompiled XCFrameworks**: RNTester の clean build が 120秒→10秒（10倍）
- iOS 26 Liquid Glass 対応、Android 16 edge-to-edge
- **Legacy Architecture を `newArchEnabled=false` で opt-out できる最後の SDK**
- SDK 53 は古い（RN 0.79）、SDK 55 は Legacy 廃止予定

### Q-004 — LiveKit Cloud vs セルフホスト / Vercel で動くか

判定: **最初から LiveKit Cloud。Vercel では絶対に動かせない**

根拠:
- LiveKit SFU は WebRTC SFU で UDP/TCP の host networking が必要 → Vercel serverless 構造的に不可
- LiveKit Cloud は Apache 2.0 ベースのマネージドSFU、**5,000 participant-minutes/月 無料**
- Translation Agent も WebSocket 常時接続が必要なので Vercel 不可 → **Render Background Worker / Fly.io / Cloud Run** で稼働
- Vercel に置けるのは Next.js Server / API Server のみ

### サーバー全体構成

旧設計（オンプレ Proxmox `.207/.208`）は破棄。新設計は **全マネージドクラウド**:

| コンポーネント | ホスティング |
|---|---|
| API Server | Vercel (Tokyo) |
| LiveKit SFU | LiveKit Cloud |
| Translation Agent | Render Background Worker (or Fly.io) |
| DB / Auth / Storage | Supabase Cloud (Tokyo) |
| DNS / WAF | Cloudflare |

詳細は `docs/deploy.md` を参照。

## 実装一覧

### 新規ファイル

- `apps/translation-agent/src/config.ts` — Zod 環境変数バリデーション
- `apps/translation-agent/src/logger.ts` — 構造化ログ (JSON Lines)
- `apps/translation-agent/src/openai-ws-client.ts` — GPT-Realtime-Translate WebSocket クライアント
- `apps/translation-agent/src/internal-api-client.ts` — Server間 HMAC-SHA256 内部 API
- `apps/translation-agent/src/translation-session.ts` — 1 言語ペア = 1 セッション
- `apps/translation-agent/src/agent.ts` — `defineAgent({ entry })` メイン
- `apps/translation-agent/src/index.ts` — `cli.runApp(WorkerOptions)` エントリ
- `apps/translation-agent/__tests__/config.test.ts`
- `apps/translation-agent/__tests__/internal-api-client.test.ts`
- `packages/auth/src/schemas.ts` — Profile スキーマ
- `packages/auth/src/facade.ts` — `getProfile(userId)` ファサード
- `packages/auth/src/index.ts`
- `packages/auth/__tests__/facade.test.ts`
- `packages/media/src/schemas.ts` — ParticipantMetadata + AccessToken request/response
- `packages/media/src/facade.ts` — Media facade
- `packages/media/src/adapters/livekit.ts` — **C-005 中核実装**（Token metadata server-side 焼き込み）
- `packages/media/src/index.ts`
- `packages/media/__tests__/livekit-adapter.test.ts`

### 大幅更新

- `apps/translation-agent/CLAUDE.md` — Python fallback 削除 / agents-js 1.0 前提
- `apps/translation-agent/package.json` — `@livekit/agents` 1.0.47, `@livekit/rtc-node` 0.13.5, `livekit-server-sdk` 2.13.0
- `apps/translation-agent/tsconfig.json` — scripts/ も include
- `apps/translation-agent/scripts/gate-check.ts` — TODO スタブを **実動するスケルトン**に置換
- `packages/auth/package.json` — zod 依存追加
- `packages/media/package.json` — zod / livekit-server-sdk / auth 依存追加
- `README.md` — 差別化テーブルに Phone Live Translation の制約を明記
- `docs/deploy.md` — オンプレ Proxmox → クラウド前提に全面書き直し
- `docs/agent-flow.md` — 旧 0.x pipeline → 1.0 defineAgent に書き直し

## C-005 検証（Token metadata server-side 焼き込み）

### 攻撃ベクトル

旧設計では client→server に `nativeLanguage` を渡し、それを LiveKit Token の metadata にそのまま入れていた。
これだと **悪意あるクライアントが nativeLanguage を偽装** → 翻訳セッションが不正な言語ペアで開かれる可能性があった。

### 対策

1. クライアントは Token 発行 API に `userId` と `roomId` のみ渡す（`nativeLanguage` は受け取らない）
2. Server は Auth モジュールの `getProfile(userId)` で DB から Profile を取得
3. Profile の `nativeLanguage` を metadata に焼き込んで Token に署名
4. `grant.canUpdateOwnMetadata = false` を設定 → クライアントは Room に入った後も metadata を書き換えできない

### テスト

- `packages/media/__tests__/livekit-adapter.test.ts`:
  - DB から取得した nativeLanguage が metadata に焼き込まれる
  - JWT を decode して `metadata` JSON フィールドと `grant.canUpdateOwnMetadata=false` を検証
  - DB の値が ja でも en でも、それぞれ正しく焼き込まれる
  - Profile 取得失敗時は Token 発行されない

### Translation Agent 側の参照

`apps/translation-agent/src/agent.ts` の `handleParticipantConnected()` で
`participant.metadata` を読み取る際は **必ず `parseParticipantMetadata()` を経由**する。
これで Zod による型安全と schemaVersion チェックが入る。

## C-003 検証（Translation Agent PoC スケルトン）

### Phase 1a Sprint 0 のスコープ達成

- [x] `defineAgent({ entry })` で Room 参加（agents-js 1.0 公式パターン）
- [x] participantConnected / participantDisconnected の lifecycle
- [x] TranslationSession の start/end + 内部 API 通知
- [x] OpenAI WebSocket 接続（session.update まで）
- [x] HMAC-SHA256 + Idempotency-Key の内部 API クライアント
- [x] Zod ベースの環境変数バリデーション
- [x] 構造化ログ（JSON Lines）

### gate-check.ts スケルトン実装

`apps/translation-agent/scripts/gate-check.ts` を **TODO スタブから実動スクリプトに昇格**:

- LiveKit Room 作成（RoomServiceClient.createRoom）
- Publisher ロール: AccessToken 発行 → Room 接続 → AudioSource 生成 → 模擬音声 (合成サイン波 or WAV) を10ms周期で publish
- Subscriber ロール: AccessToken 発行 → Room 接続 → TrackSubscribed イベントを観察
- メモリサンプリング（5秒ごと `process.memoryUsage()`）
- 全イベントを **stdout に JSON Lines** で記録（後段の分析スクリプトで分位値計算する想定）

### Phase 1a Sprint 1 で残る作業

- LiveKit Track Subscribe → AudioFrame 取り出し → OpenAI に送信する pipeline 接続
- OpenAI からの `response.audio.delta` を LiveKit AudioSource に流して再 Publish
- レイテンシ計測ホップを Server に送信
- WebSocket 強制切断による再接続実測
- Crash recovery 実測

## 残作業（Sprint 1 以降）

1. **clean install + typecheck の通し検証** — 本ブランチをマージ前に CI で実行
2. **Server 側内部 API ハンドラ** — `POST /internal/agent/events` の HMAC 検証 + Supabase 永続化
3. **room モジュール** の facade 実装
4. **billing モジュール** の Stripe / IAP webhook + heartbeat 課金
5. **callkeep 代替の自前 Native Module** の見積もり
6. **Render dry-run デプロイ** + gate-check.ts 実走

## 次回（v12）レビュー観点

- Server 側内部 API の HMAC 検証実装が攻撃シナリオに耐えるか
- gate-check.ts の出力 JSON が分位値計算に十分な情報を含むか
- callkeep 代替 Native Module の設計
- LiveKit Cloud の Free tier が Phase 1a TestFlight 100名規模に十分か（実測）
