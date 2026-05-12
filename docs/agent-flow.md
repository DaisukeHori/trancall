# Translation Agent 接続フロー詳細設計

> 第11回レビューで `@livekit/agents` 1.0 (2025年8月安定リリース) を採用することが確定。
> 旧 0.x の `pipeline.VoicePipelineAgent` パターンは deprecated のため、本ドキュメントは
> **agents-js 1.0 の `defineAgent({ entry })` パターン**で書き直している。

## 1. シーケンス（1対1通話）

```
User A (JA)    Mobile App A    API Server    LiveKit Cloud    Agent Worker    OpenAI RT-Translate
    │              │              │              │                 │                  │
    │ 1. Call start│              │              │                 │                  │
    │─────────────>│              │              │                 │                  │
    │              │ 2. POST /rooms              │                 │                  │
    │              │─────────────>│              │                 │                  │
    │              │              │ 3. canStartCall (billing check) │                  │
    │              │              │ 4. reserveMins                  │                  │
    │              │              │ 5. createRoom + dispatch Agent  │                  │
    │              │              │────────────>│                 │                  │
    │              │              │              │ 6. push notify  │                  │
    │              │              │──────────────────────────────────────> User B    │
    │              │ 7. accessToken (metadata焼き込み済)             │                  │
    │              │<─────────────│              │                 │                  │
    │              │ 8. room.connect             │                 │                  │
    │              │────────────────────────────>│                 │                  │
    │              │              │              │ 9. participantConnected            │
    │              │              │              │ → Job dispatch │                  │
    │              │              │              │────────────────>│                  │
    │              │              │              │                 │ 10. ctx.connect()│
    │              │              │              │<────────────────│                  │
    │              │              │              │ 11. Subscribe A's raw-* track     │
    │              │              │              │ → AudioFrames  │                  │
    │              │              │              │────AudioFrame──>│                  │
    │              │              │              │                 │ 12. Open WS (JA→EN)│
    │              │              │              │                 │─────────────────>│
    │              │              │              │                 │ 13. session.update│
    │              │              │              │                 │ (output: en)     │
    │              │              │              │                 │─────────────────>│
    │              │              │              │                 │ 14. input_audio_buffer.append (PCM16) │
    │              │              │              │                 │─────────────────>│
    │              │              │              │                 │ 15. response.audio.delta (translated PCM16) │
    │              │              │              │                 │<─────────────────│
    │              │              │              │ 16. Publish "trans-A-to-en"        │
    │              │              │              │<────────────────│                  │
    │              │              │              │ 17. response.audio_transcript.delta│
    │              │              │              │                 │<─────────────────│
    │              │              │              │ 18. data publish (subtitle delta)  │
    │              │              │              │<────────────────│                  │
    │              │ 19. POST /internal/agent/events                                   │
    │              │              │ (session_started / metrics / session_ended)       │
    │              │              │<──────────────────────────────│                  │
    │              │              │ 20. Supabase insert + 課金イベント                │
    │              │              │              │                 │                  │
```

key points:

- **Agent は Job Dispatch で起動する**: クライアントが Room に joins すると LiveKit Server が `agentName` で named agent を dispatch、Worker が Job を accept したら `defineAgent({ entry })` の `entry` が呼ばれる
- **Agent → Server は HMAC HTTP**: `apps/translation-agent/src/internal-api-client.ts` の `postEvent()` 経由で `https://api.trancall.app/internal/agent/events` に投げる
- **音声本体は LiveKit Cloud を通る**: Agent → OpenAI 側だけ別 WebSocket、翻訳結果は再び LiveKit Track として Publish

## 2. Agent コード設計（agents-js 1.0）

### 2.1 エントリポイント（index.ts）

```typescript
// apps/translation-agent/src/index.ts
import { fileURLToPath } from "node:url";
import { WorkerOptions, cli } from "@livekit/agents";

import { loadConfig } from "./config.js";
import { InternalApiClient } from "./internal-api-client.js";
import { createLogger } from "./logger.js";
import { injectDependencies } from "./agent.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, { service: "trancall-translation-agent" });
const internalApiClient = new InternalApiClient({
  serverUrl: config.TRANCALL_SERVER_URL,
  hmacSecret: config.TRANCALL_AGENT_HMAC_SECRET,
  agentName: config.AGENT_NAME,
  maxRetries: 3,
  logger: logger.child({ component: "InternalApiClient" }),
});

injectDependencies({ config, logger, internalApiClient });

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(new URL("./agent.js", import.meta.url)),
    agentName: config.AGENT_NAME, // named agent として LiveKit Server に登録
  }),
);
```

### 2.2 defineAgent（agent.ts）

```typescript
// apps/translation-agent/src/agent.ts
import type { JobContext, JobProcess } from "@livekit/agents";
import { defineAgent } from "@livekit/agents";

import { TranslationSession } from "./translation-session.js";
import { getDependencies } from "./di.js"; // injectDependencies で注入された依存

export default defineAgent({
  prewarm: async (_proc: JobProcess) => {
    // 重いリソース（VAD モデル等）の事前ロード。
    // TranCall は LLM/STT/TTS を使わないため特に処理なし。
  },

  entry: async (ctx: JobContext) => {
    const deps = getDependencies();
    const logger = deps.logger.child({ jobId: ctx.job.id, roomName: ctx.room.name });

    // 1. Room に参加
    await ctx.connect();

    // 2. アクティブセッションの管理（Key: `${sourceParticipantId}-${outputLanguage}`）
    const sessions = new Map<string, TranslationSession>();

    function handleParticipantConnected(identity: string, metadata: string | undefined) {
      // ★ ここで participant.metadata から nativeLanguage を読み取り、
      //   他の Participant 向けに TranslationSession を開始する
      //
      //   metadata は Server-side で Token 発行時に焼き込まれる（C-005 対応）
      //   → クライアントは書き換え不可なので信頼できる
    }

    function handleParticipantDisconnected(identity: string) {
      // 該当 Participant が source/target になっているセッションを全て終了
      // 残り 1 名以下になったら ctx.shutdown() で Agent も退出
    }

    ctx.room.on("participantConnected", (p) => {
      handleParticipantConnected(p.identity, p.metadata);
    });
    ctx.room.on("participantDisconnected", (p) => {
      handleParticipantDisconnected(p.identity);
    });

    // 既参加の Participant も処理
    for (const p of ctx.room.remoteParticipants.values()) {
      handleParticipantConnected(p.identity, p.metadata);
    }

    // 3. Shutdown フック
    ctx.addShutdownCallback(async () => {
      logger.info("Agent: Shutdown 開始");
      await Promise.all(
        Array.from(sessions.values()).map((s) => s.end("agent_shutdown")),
      );
      sessions.clear();
    });
  },
});
```

### 2.3 TranslationSession（translation-session.ts）

1 言語ペア = 1 OpenAI WebSocket セッション。1対1双方向通話なら 2 セッション（A→B、B→A）。

```typescript
// apps/translation-agent/src/translation-session.ts
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { OpenAIWsClient } from "./openai-ws-client.js";
import {
  buildSessionStartedEvent,
  buildSessionEndedEvent,
  type InternalApiClient,
} from "./internal-api-client.js";

export class TranslationSession extends EventEmitter {
  private readonly agentJobId = randomUUID();
  private readonly startedAt = new Date();
  private openaiClient: OpenAIWsClient | null = null;
  private isEnding = false;

  constructor(private readonly config: TranslationSessionConfig) {
    super();
  }

  async start(): Promise<void> {
    // Server に開始通知（HMAC 署名 + Idempotency-Key）
    await this.config.internalApiClient.postEvent(buildSessionStartedEvent({ ... }));

    // OpenAI WebSocket 接続
    this.openaiClient = new OpenAIWsClient({ ... });
    this.openaiClient.on("audio.delta", (e) => this.emit("translated-audio", e.audioBase64));
    this.openaiClient.on("transcript.done", (e) => this.emit("transcript", e.text, true));
    await this.openaiClient.connect();
  }

  pushAudioFrame(pcm16Base64: string): void {
    this.openaiClient?.sendAudioFrame(pcm16Base64);
  }

  async end(reason: SessionEndReason): Promise<void> {
    if (this.isEnding) return;
    this.isEnding = true;

    await this.openaiClient?.close();

    // Server に終了通知（billableSeconds を含む課金イベント）
    await this.config.internalApiClient.postEvent(buildSessionEndedEvent({
      agentJobId: this.agentJobId,
      startedAt: this.startedAt,
      endedAt: new Date(),
      reason,
      ...
    }));

    this.emit("ended", reason);
  }
}
```

### 2.4 OpenAI WebSocket クライアント（openai-ws-client.ts）

OpenAI Realtime Translation API への接続管理。

公式仕様:
- エンドポイント: `wss://api.openai.com/v1/realtime/translations`
- ヘッダ: `Authorization: Bearer <OPENAI_API_KEY>`、`OpenAI-Beta: realtime=v1`
- 入力: `input_audio_buffer.append` で PCM16 を Base64
- 出力: `response.audio.delta`（PCM16 Base64）、`response.audio_transcript.delta`（テキスト）
- session.update では **出力言語のみ指定**（入力は自動検出）
- 同一言語発話時の挙動は Phase 1a Sprint 1 で gate-check により確認

```typescript
// apps/translation-agent/src/openai-ws-client.ts
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      audio: {
        input:  { format: "pcm16", sample_rate_hz: 24000 },
        output: { format: "pcm16", sample_rate_hz: 24000, language: "en" },
      },
    },
  }));
});
```

再接続戦略:
- close code 1000（正常終了）→ 再接続しない
- close code 4000-4999（認証/権限エラー）→ 再接続しない
- それ以外 → exponential backoff (1s → 2s → 4s ... 最大60s)

## 3. Server 側内部 API (Vercel)

Agent → Server コールバック先。

```
POST https://api.trancall.app/internal/agent/events
Headers:
  content-type: application/json
  x-trancall-agent: trancall-translation-agent
  x-trancall-signature: <hex HMAC-SHA256 of body|idempotencyKey>
  x-trancall-idempotency-key: <UUID>

Body:
  - { type: "translation.session_started", ... }
  - { type: "translation.session_ended", durationMs, billableSeconds, reason, ... }
  - { type: "transcript.delta", sequenceNo, text, isFinal, ... }
  - { type: "agent.metrics", latencyMs: { ... }, memoryRssBytes, ... }
  - { type: "translation.degraded", agentJobId, roomId, sessionId, sourceLang, targetLang, reason, occurredAt }
  - { type: "translation.recovered", agentJobId, roomId, sessionId, sourceLang, targetLang, degradedDurationMs, occurredAt }
```

Server 側処理:
1. HMAC 署名を検証（同じ HMAC_SECRET で `body|idempotencyKey` を再計算）
2. Idempotency-Key を見て重複チェック（同じキーで既に処理済みなら 200 で早期 return）
3. イベント type に応じて Supabase に永続化:
   - `session_started` → `translation_sessions` insert
   - `session_ended` → `translation_sessions` update（duration / billable_seconds / ended_at / reason）+ `billing_events` insert
   - `transcript.delta` → `transcript_segments` upsert (sequenceNo unique)
   - `agent.metrics` → `agent_metrics` insert
   - `translation.degraded` → EventBus.publish(TranslationDegradedEvent)（metrics / 課金除外候補の非同期処理用）
   - `translation.recovered` → EventBus.publish(TranslationRecoveredEvent)
4. 200 OK with `{ "ok": true }`

## 4. WebSocket 再接続フロー

```
1. OpenAI WS onclose / onerror 検出
2. 再接続中の音声フレームは破棄（バッファしない、レイテンシ膨張を避ける）
3. exponential backoff: 1s → 2s → 4s → 8s → 16s → 60s（最大60秒）
4. 再接続成功: 即 session.update を再送（クリーンスタート）
5. 認証エラー (4xxx) なら fatal、再接続せず session ended ("openai_fatal_error")
6. Transcript の欠落: "[翻訳中断: Xs]" を transcript_segments に挿入
```

## 5. Crash Recovery

```
Agent Worker crash（SIGKILL / OOM）
  ↓
LiveKit Cloud: bot participant disconnected
  ↓
Client: trans-* track が消える
  ↓
Client: ambient passthrough 30% → 100% に自動切替（原音再生）
  ↓
Client: UI に「翻訳が一時停止しました」表示
  ↓
Render: Background Worker が exit → 自動再起動（Render の責任）
  ↓
Agent: cli.runApp() が再度 Worker を起動 → Job を受け取り直す
  ↓
Agent: ctx.connect() で Room に再参加
  ↓
Agent: 既参加 Participant 全員に対して TranslationSession を再開
  ↓
Client: trans-* track 復活 → ambient passthrough を 30% に戻す
```

## 6. Job 重複 attach の防止

```
複数の Worker pod が dispatch を取りに行く場合:
  - LiveKit Server が「片方の Worker にのみ Job を assign」する仕組みを提供
  - Worker は accept/reject を選べる
  - 一度 accept された Job は他の Worker に再 assign されない

念のための追加防御（Phase 1b 以降）:
  - Room metadata に agentJobId を書き込み
  - 別の Agent が同じ Room に attach されたら、後発が graceful shutdown
```

## 7. Phase 1a Sprint 0 の到達点

- [x] `defineAgent({ entry })` で Room 参加
- [x] participantConnected / participantDisconnected ハンドラ
- [x] TranslationSession の lifecycle 管理（start/end）
- [x] OpenAI WS 接続 + session.update 送信
- [x] 内部 API への session_started / session_ended 通知（HMAC 検証 + Idempotency）
- [x] 構造化ログ（stdout JSON Lines）
- [x] gate-check.ts の Publisher / Subscriber 雛形

## 8. Phase 1a Sprint 1 以降の到達点

- [ ] Participant の raw-* track Subscribe → PCM 抽出 → OpenAI に送信
- [ ] 翻訳済み audio を Track として Publish（命名規約: `trans-{sourceId}-to-{lang}`）
- [ ] 字幕 delta を LiveKit Data Channel で配信
- [ ] レイテンシ計測ホップの記録と `agent.metrics` 送信
- [ ] WebSocket 再接続の実測
- [ ] Crash recovery の実測
- [ ] Server 側内部 API ハンドラ実装
- [ ] gate-check.ts の各 Gate 判定ロジック完成
