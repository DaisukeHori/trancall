# Translation Pipeline 設計 (D1)

| | |
|---|---|
| Status | Draft v1.3 (2026-05-12) |
| Owner | translation-agent / バックエンド |
| 上位文書 | `docs/architecture.md` (§ Translation Pipeline)、`docs/module-contracts.md` v1.1.0 (§2.7 TranslationFacade / §3.3 §3.4 / §7.4) |
| 補助 | `docs/requirements.md` (PERF-002, TRANS-001〜007), `apps/translation-agent/CLAUDE.md`, `apps/translation-agent/src/openai-ws-client.ts` |
| 改訂条件 | OpenAI Realtime API 仕様変更時 / LiveKit Agents SDK breaking change 時 / metrics 計測点追加時 |
| 関連 PR (確定後) | D3 (`translation.degraded/recovered` DomainEvent + module-contracts v1.1.0) |

本書は **translation-agent プロセスが LiveKit Room の参加者 AudioFrame を OpenAI Realtime Translation API に流し、翻訳音声と字幕を LiveKit に publish するまでの実装契約** を canonical 化する。Sprint 1 で骨格は実装済み、本書で **OpenAI API 仕様との不一致解消 / レイテンシ計測点の整備 / session.input_audio_buffer.commit タイミング** を確定して Sprint 2 で Gate Check 実走に持ち込む。

---

## 1. スコープ

### 1.1 本書が確定すること
- AudioFrame の取り回し (LiveKit `AudioStream` 24kHz mono Int16 → PCM16 base64)
- OpenAI Realtime Translation API のイベント名 (現コードと公式仕様の差異解消)
- `session.update` payload の正式形 (`audio.output.language` 中心)
- 入力フラッシュ手段 (Translation API には commit イベントが存在せず、`session.close` でサーバ側がフラッシュ)
- レイテンシ計測 5 点 (captureToAgent / agentToOpenAI / openAIFirstDelta / agentPublish / totalEndToEnd) と発火タイミング
- Track 命名 (`trans-{sourceIdentity}-to-{targetLang}`)
- session ライフサイクル (start / pause / resume / end) と理由コード
- エラーコード ↔ HTTP status の対応 (`module-contracts.md` §5 準拠)
- degraded/recovered 判定の閾値素案 (D3 で正式契約化)

### 1.2 本書の非スコープ
- LiveKit Room 作成・Token 発行 (`packages/media` 担当、C-005 で完了)
- 課金精算 (`packages/billing` 担当、`translation.ended` 受信側)
- 字幕の永続化 (`packages/transcript` 担当、`recordSegment`)
- 同言語 skip 判定 (`packages/translation/src/services/language-pair.ts` で確定済)
- LiveKit Cloud 側のリージョン選定 (D2 deployment.md 担当)

---

## 2. 上位前提

### 2.1 参加者と Track の構成 (`architecture.md:119-127`)

```
Room: "room-{roomId}"
├── Participant A (nativeLanguage=JA) → publish raw-{participantId-A}
├── Participant B (nativeLanguage=EN) → publish raw-{participantId-B}
└── Translation Agent (bot identity = "translation-agent-{jobId}")
    ├── Subscribe raw-A → GPT-RT-Translate(JA→EN) → publish trans-{A}-to-en
    └── Subscribe raw-B → GPT-RT-Translate(EN→JA) → publish trans-{B}-to-ja
```

- 言語ペア = 1 セッション (1 方向)、参加者 N で最大 N×(N-1) セッション
- 同言語ペアは `language-pair.shouldStartSession` で start しない (`module-contracts.md` §2.7)
- 参加者の `nativeLanguage` は LiveKit Token metadata から `parseParticipantMetadata` 経由で取得 (C-005、Token の `canUpdateOwnMetadata=false`)

### 2.2 PERF-002 (`requirements.md:254`)
発話終了 → 翻訳音声開始までの遅延:
- p50 ≤ 1.5s
- p95 ≤ 3.0s (英日など語順差大のペアは 4.0s 許容、`architecture.md:557` レビュー対応で合意)
- p99 ≤ 5.0s

Sprint 2 の Gate Check 実走で計測、Sprint 2 完了基準。

### 2.3 ambient passthrough (TRANS-007)
- 翻訳音声と並行して原音 30% を常時ミキシング (`apps/mobile/src/lib/livekit/audio-routing.ts`)
- 翻訳音声到着時に raw を 0.1 に ducking、終了で 0.3 に復帰
- 本書は **publish 側 (Agent)** の責務のみ規定、ducking は **mobile 受信側** の責務

---

## 3. PCM / 音声フォーマット契約

### 3.1 フォーマット
| 項目 | 値 | 根拠 |
|---|---|---|
| Sample rate | 24,000 Hz | OpenAI Realtime Translation 公式 (`developers.openai.com/api/docs/guides/realtime-translation`)、現コード `agent.ts:253` も同値 |
| Channels | 1 (mono) | 同上 |
| Bit depth | 16 (Int16 LE) | 同上 |
| OpenAI 側エンコード | base64 (バイナリを Buffer 経由で encode) | 同上、現コード `openai-ws-client.ts:225-230` も同形 |
| LiveKit 側 | `AudioFrame(Int16Array, 24000, 1, samplesPerChannel)` | `@livekit/rtc-node` 0.13.5 の API、現コード `agent.ts:222` |

### 3.2 リサンプル
- LiveKit Room の内部 sample rate は **48kHz** だが `new AudioStream(track, 24000, 1)` 指定で SDK が 48kHz → 24kHz リサンプルを行う (現コード `agent.ts:253`、SDK 内部仕様)
- Agent → LiveKit publish 側も 24kHz → 48kHz リサンプルを SDK が行う
- 自前のリサンプル実装は不要

### 3.3 フレーム粒度
- LiveKit 側: 10ms = 240 sample / frame (`gate-check.ts:128-134`)
- OpenAI 側: 200ms (Realtime API 仕様、サーバが内部で集約) — クライアントは任意フレーム長で `append` 可、commit までは累積される

---

## 4. OpenAI Realtime Translation API 契約 (重要)

### 4.1 イベント名の **公式仕様への移行** (現コードと差異)

Sprint 1 実装時に旧 Realtime API (汎用) の event 名を使ったが、Translation 専用 endpoint は `session.*` prefix が公式仕様。**Sprint 2 着手時に下表のとおり置換**:

| 用途 | 現コード (誤) | **公式仕様 (採用)** | コード位置 (関数 / 関連行) |
|---|---|---|---|
| 音声送信 (client→server) | `input_audio_buffer.append` | **`session.input_audio_buffer.append`** | `openai-ws-client.ts` 音声送信 `send` 呼び出し |
| ~~音声 commit~~ | ~~`input_audio_buffer.commit`~~ | **存在しない** (Translation API は commit イベント未提供、`session.close` でサーバが pending buffer 自動フラッシュ) | 該当コード削除予定 (T7) |
| 翻訳音声受信 (server→client) | `response.audio.delta` | **`session.output_audio.delta`** | `openai-ws-client.ts` の switch case |
| 翻訳字幕受信 (server→client) | `response.audio_transcript.delta` | **`session.output_transcript.delta`** | 同上 |
| 字幕完了 (server→client) | `response.audio_transcript.done` | **公式 server events に未記載** (gate-check で `.delta` のみで完結するか実測、§12-2 参照) | 同上 |
| セッション設定 | `session.update` | `session.update` (同名、payload 構造変更) | `openai-ws-client.ts` の session.update 送信ブロック |
| セッション終了 (client→server) | (なし、WS close で代替) | **`session.close`** (公式) — pending input audio をフラッシュして残りの翻訳出力を出してから close | T7 で追加実装 |

公式ソース:
- https://developers.openai.com/api/docs/guides/realtime-translation
- https://developers.openai.com/api/reference/resources/realtime/translation-server-events

### 4.2 WS 接続
- **URL**: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- **ヘッダー**:
  - `Authorization: Bearer ${OPENAI_API_KEY}`
  - `OpenAI-Beta: realtime=v1` (現コード送信中、公式は明記なしだが互換性のため維持。gate-check で 401/426 が出れば削除)
- **再接続**: exponential backoff 最大 60s、30s heartbeat ping (Sprint 1 で実装済、変更なし)
- **fatal close code**: 4000-4999 レンジは `end("openai_fatal_error")`、それ以外は再接続試行 (現実装維持)

### 4.3 `session.update` payload 形 (採用形)

```json
{
  "type": "session.update",
  "session": {
    "audio": {
      "output": {
        "language": "en"
      }
    }
  }
}
```

- 公式ガイドが明示するのは `audio.output.language` のみ。
- `audio.input.format` / `audio.output.format` / `audio.output.sample_rate_hz` は現コードに含まれるが Translation endpoint で受け入れられるか未確認。**gate-check 実走の最初の試験で `audio.output.language` のみ送信して挙動確認 → 必要なら拡張**。
- 言語コード: ISO 639-1 2 文字 (`ja`, `en`, `zh`, `es`, `pt`, `fr`, `ru`, `de`, `ko`, `hi`, `id`, `vi`, `it` の 13 言語、`packages/shared-kernel` の `OutputLanguage` enum と同期)

### 4.4 入力 audio の送信パターン

```ts
ws.send(JSON.stringify({
  type: "session.input_audio_buffer.append",
  audio: pcm16Base64,  // Buffer.from(int16.buffer).toString("base64")
}));
```

### 4.5 セッション終了時のフラッシュ手段

OpenAI Realtime Translation API には汎用 Realtime API の `input_audio_buffer.commit` イベントは **存在しない** (公式 client events は `session.update` / `session.input_audio_buffer.append` / `session.close` の 3 種のみ)。Agent 側 VAD (Voice Activity Detection) も実装しない (サーバ側 VAD 任せ、多言語で安定)。

session 終了時の pending buffer フラッシュは:
- **`session.close` イベントを送信** (公式仕様: "The server flushes pending input audio and emits any remaining translated output before closing the session")
- 受信側は `session.output_audio.delta` の最終 chunk を受け取り次第 `audioSource.captureFrame` を完了

「明示的な発話区切り signal」を将来加える場合も `session.close → 新規 session.update` で session 再生成する形になる (Translation API スコープ外)。

### 4.6 受信イベントの処理

| event | フィールド | 用途 | Agent 側ハンドラ |
|---|---|---|---|
| `session.created` | session.id | session 確立確認 | log + metrics_started 発行 |
| `session.updated` | session の現状 | session.update の応答 | log のみ |
| `session.output_audio.delta` | `delta` (base64) / `sample_rate` / `channels` / `elapsed_ms` | 翻訳音声 chunk | LiveKit publish (AudioFrame に変換) |
| `session.output_transcript.delta` | `delta` (text) / `elapsed_ms` | 翻訳字幕 (Final segment は server で確定済) | LiveKit Data Channel publish + `transcript.recordSegment` 内部 API |
| `session.input_transcript.delta` | `delta` (text) / `elapsed_ms` | 原文字幕 (任意、TranCall では使わない or transcript モジュールに渡す) | 当面 log + 将来的に transcript 連携 |
| `error` | `error.type` / `message` / `code` | エラー | 後述 §10 |

### 4.7 翻訳音声 → LiveKit publish

```ts
// 受信
const int16 = new Int16Array(Buffer.from(delta, "base64").buffer);
const samplesPerChannel = int16.length / channels;
const frame = new AudioFrame(int16, sampleRate ?? 24000, channels ?? 1, samplesPerChannel);
await audioSource.captureFrame(frame);
```

- `AudioSource` / `LocalAudioTrack` は session start 時に 1 度だけ生成 (現コード `agent.ts:211-213` 維持)
- Track 名は **`trans-{sourceParticipantIdentity}-to-{targetLang}`** で固定 (`packages/media/CLAUDE.md` の命名規約)
- publish 失敗時は session を end (`"agent_publish_failed"` 理由を新規追加)

---

## 5. レイテンシ計測点 5 種

`module-contracts.md` §7.4.4 `agent.metrics` event の `latencyMs` 5 配列と完全に同期する。

### 5.1 計測点定義

| 計測点 | 始点 | 終点 | 単位 | 用途 |
|---|---|---|---|---|
| `captureToAgent` | LiveKit raw track の audio frame 生成 (発話) | Agent の `AudioStream.read()` で受領 | ms | LiveKit ↔ Agent 間の RTT |
| `agentToOpenAI` | `AudioStream.read()` から取得した時刻 | `session.input_audio_buffer.append` WS 送信完了 | ms | Agent 内部 + OpenAI WS 送信経路 |
| `openAIFirstDelta` | `session.input_audio_buffer.append` 送信時刻 | 最初の `session.output_audio.delta` 受信時刻 | ms | OpenAI 側翻訳遅延 (主要 KPI) |
| `agentPublish` | `audioSource.captureFrame` 呼び出し時刻 | LiveKit 内部の publish 完了 (heuristic) | ms | publish 経路の遅延 |
| `totalEndToEnd` | raw audio frame 生成時刻 | 翻訳音声の最初の frame が publish 完了 | ms | **PERF-002 主指標** |

### 5.2 PERF-002 との対応
- p50/p95/p99 計測対象 = **`totalEndToEnd`**
- `openAIFirstDelta` の p95 が突出する場合、OpenAI 側起因と切り分け

### 5.3 計測の実装上の修正項目 (Sprint 1 残課題)

| 項目 | 現状 | 修正方針 |
|---|---|---|
| `captureToAgent` | 未計測 (`recordCaptureToAgent` メソッドは存在、呼び出しなし) | `pipeAudioTrack` 内で `reader.read()` 直後にタイムスタンプ採取し前フレーム差分を `recordCaptureToAgent` に渡す |
| `openAIRequestSentAt` 毎フレーム上書き | 既知バグ (`translation-session.ts:205`) | **発話開始 = 最初の append** とみなし、`session.output_audio.delta` 受信で計測完了したら `openAIRequestSentAt = null` にリセット。次の発話 (deltas 途絶 200ms 以上後の append) で再採取 |
| `agentPublish` | 未計測 | `translated-audio` ハンドラ内で `captureFrame` 前後の wallclock 差分を `recordAgentPublish` に渡す |
| `totalEndToEnd` | 未計測 | 上記 3 つの合算 (captureToAgent + openAIFirstDelta + agentPublish) を `recordTotalEndToEnd` に渡す |

### 5.4 metrics 送信
- 30 秒ごとに集計値を `agent.metrics` イベントで `/internal/agent/events` に POST (現実装維持)
- payload schema は `module-contracts.md` §7.4.4 `agent.metrics` event 既存
- JSONB の `latencyMs` フィールドに 5 配列 `{captureToAgent: number[], agentToOpenAI: number[], openAIFirstDelta: number[], agentPublish: number[], totalEndToEnd: number[]}` で送信

---

## 6. Session ライフサイクル

### 6.1 状態遷移
```
[idle]
  ├─ start(sourceLang, targetLang, sourceIdentity, sourceParticipantId, targetIdentity, targetParticipantId)
  │     ├─ shouldStartSession=false → 何もしない (idle のまま)
  │     ├─ shouldStartSession=true →
  │     │     ├─ OpenAIWsClient.connect()
  │     │     ├─ session.update 送信
  │     │     ├─ AudioSource / LocalAudioTrack 生成
  │     │     ├─ ctx.agent.publishTrack(...)
  │     │     └─ [active]
[active]
  ├─ pushAudioFrame(pcm16Base64) → OpenAI に append
  ├─ on "translated-audio" → LiveKit publish
  ├─ on "translated-text" → DataChannel publish + transcript.recordSegment
  ├─ on "openai_fatal_error" → end("openai_fatal_error")
  ├─ on participantLeft → end("participant_left")
  ├─ degraded condition (§7) → DataChannel に `translation.degraded` 送信、session は active のまま
  ├─ recovered condition (§7) → DataChannel に `translation.recovered` 送信
  └─ end(reason) → [ending]
[ending]
  ├─ isEnding=true (二重防止)
  ├─ session.close 送信 (server が pending input audio をフラッシュし残り翻訳出力を emit、§4.5)
  ├─ metrics_final 送信
  ├─ OpenAI WS close
  ├─ LiveKit Track unpublish
  ├─ session_ended 内部 API 送信 (`/internal/agent/events`)
  └─ emit("ended") → [terminated]
```

### 6.2 End 理由 (`module-contracts.md` §7.4.2 の `translation.session_ended.reason` enum、v1.1.0 で 5 値に拡張済み)
| 値 | 説明 |
|---|---|
| `participant_left` | 参加者離脱 |
| `agent_shutdown` | Agent プロセス停止 (SIGTERM) |
| `openai_fatal_error` | OpenAI WS が 4000-4999 で close |
| `client_requested` | クライアント側から終了要求 (将来用) |
| `agent_publish_failed` | v1.1.0 で追加。Agent → LiveKit publish が連続失敗 (§10.3 参照) |

### 6.3 同言語 skip
- `language-pair.shouldStartSession(sourceLang, targetLang)` が false のとき `start()` は no-op
- session 生成しない、metrics 出力なし、課金対象外

---

## 7. degraded / recovered 判定 (本書 = 判定条件、契約 = module-contracts §3.3 §3.4)

判定条件と発火タイミングは本書 (D1) が canonical。**DomainEvent payload schema と Data Channel payload schema** は `docs/module-contracts.md` v1.1.0 §3.3 §3.4 (D3) が canonical。Agent 実装は両者を参照する。

### 7.1 degraded 判定 (素案)
以下のいずれかが連続 5 秒以上発生:
- OpenAI WS 接続が再接続中 (state = `reconnecting`)
- `openAIFirstDelta` の直近 5 サンプル中央値が 5,000ms 超
- `session.output_audio.delta` の受信が **2 秒間ゼロ** かつ raw audio は input されている

### 7.2 recovered 判定 (素案)
以下を **同時に 3 秒以上**:
- OpenAI WS 接続が `connected` (再接続完了)
- `session.output_audio.delta` が 1 秒以内に 1 つ以上受信されている

### 7.3 Data Channel payload
正式 schema は `docs/module-contracts.md` §3.4 `TranslationStatusChannelPayloadSchema` を参照 (v1.1.0)。mobile 側 (`apps/mobile/src/lib/livekit/subtitles.ts`) は同 schema を Zod safeParse して受信、Zustand `subtitle-store` の `degradationState` に反映 (Phase 1b で mobile 側結合)。

### 7.4 並列発行 (EventBus + Data Channel)
degraded/recovered の判定が成立した瞬間、Agent は **2 系統並列** で発行:
1. `/internal/agent/events` (HTTP) → server → EventBus に DomainEvent publish (billing 課金除外 / metrics 集計用)
2. LiveKit Data Channel publish (mobile UI 即時表示用)

同じ `sessionId` / `timestamp` を両系統に含めることで突き合わせ可能。詳細は `module-contracts.md` §3.4 末尾。

---

## 8. Track 命名と publish

### 8.1 命名規約 (`packages/media/CLAUDE.md` 既定、本書で再確認)
- 原音: `raw-{participantId}` (例: `raw-1f3c...uuid`)
- 翻訳音声: `trans-{sourceParticipantIdentity}-to-{targetLang}` (例: `trans-1f3c...-to-en`)
- `sourceParticipantIdentity` は LiveKit identity (TranCall ID 由来)、`targetLang` は ISO 639-1 2 文字

### 8.2 Publish オプション
- `TrackPublishOptions` でクライアント側ミキシング優先度を指定する想定だが Sprint 2 では使わない (default で十分)
- track が既に存在する場合 (再接続後) は unpublish → publish の順で更新

### 8.3 Track lifecycle
- session start で publish、session end で unpublish
- 再接続中 (`reconnecting`) は track を保持、`degraded` 状態として継続

---

## 9. metrics 送信契約

### 9.1 送信タイミング
- **30 秒周期** (Sprint 1 実装維持) で `agent_metrics.recorded` イベント
- session 終了時に **最終バッチ** を `session_ended` 直前に送信

### 9.2 payload (`module-contracts.md` §7.4.4 既存契約と完全同期)
```ts
{
  type: "agent.metrics",
  agentJobId: UUID,           // v1.1.0 では z.uuid()、将来 AgentJobId brand
  roomId: UUID,
  latencyMs: {
    captureToAgent: number[],     // 30 秒間に観測した全サンプル
    agentToOpenAI: number[],
    openAIFirstDelta: number[],
    agentPublish: number[],
    totalEndToEnd: number[],
  },
  memoryRssBytes: number,
  collectedAt: ISO8601,
}
```

### 9.3 集計は Server 側
- Server は受信して `agent_metrics` テーブルに JSONB として保存 (migration `00003_add_agent_metrics_table.sql`)
- p50/p95/p99 計算は Sprint 2 の Gate Check スクリプトが SQL 集計で実施

---

## 10. エラーハンドリング

### 10.1 OpenAI error event → AppError マッピング (`module-contracts.md` §5 準拠)

| OpenAI `error.type` / `error.code` | AppError code | HTTP | retryable | 動作 |
|---|---|---|---|---|
| `invalid_request_error` (一般) | `TRANSLATION_PROVIDER_ERROR` | 502 | true | log + session 継続、5 回連続で degraded |
| `server_error` | `TRANSLATION_PROVIDER_ERROR` | 502 | true | 同上 |
| `rate_limit_exceeded` | `TRANSLATION_RATE_LIMITED` | 429 | true | backoff + degraded、recovered で復帰 |
| `content_filter` / `safety` | `TRANSLATION_SAFETY_STOP` | 451 | false | session を end("openai_fatal_error") |
| `session_limit_exceeded` | `TRANSLATION_SESSION_LIMIT` | 503 | true | 別 session に振替、当該 session は end |
| WS close 4000-4999 | `TRANSLATION_PROVIDER_ERROR` | 502 | false | end("openai_fatal_error") |

### 10.2 再接続戦略
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (上限)
- 60s に達したら 60s 間隔で永続的に再試行
- 5 分以上接続できない場合は session を end (`agent_shutdown` 理由)

### 10.3 LiveKit publish 失敗
- 1 回目: log + 即時 retry
- 連続 3 回失敗: session を end("agent_publish_failed")

---

## 11. 実装タスク (Sprint 2 着手順)

| # | タスク | 修正ファイル | 完了条件 |
|---|---|---|---|
| T1 | OpenAI event 名を公式仕様に置換 | `openai-ws-client.ts` (L226, L236, L321, L327, L329, L262-281) | unit test 更新 + 自動テスト緑 |
| T2 | `session.update` payload を `audio.output.language` のみに簡略化、不要フィールド削除 | 同上 | OpenAI に接続して 401/400 が出ないこと (Gate Check の最初の試験) |
| T3 | `captureToAgent` 計測点を `pipeAudioTrack` に追加 | `agent.ts:249-276`, `translation-session.ts` | unit test (mock AudioStream) |
| T4 | `openAIRequestSentAt` リセットロジック修正 (delta 受信で null 化、200ms 途絶後の append で再採取) | `translation-session.ts:205, 216-218` | unit test 追加 |
| T5 | `agentPublish` 計測点を `translated-audio` ハンドラに追加 | `agent.ts:218-224` | unit test |
| T6 | `totalEndToEnd` を 3 計測点の合算で算出 | `translation-session.ts` 新規メソッド | unit test |
| T7 | `session.close` を `end()` 内で送信 (commit は使わない、Translation API には存在しない)。既存の `commitInputBuffer()` 実装は削除 | `translation-session.ts`, `openai-ws-client.ts` 該当ブロック | integration test |
| T8 | `agent_publish_failed` 理由は v1.1.0 で `module-contracts.md` §7.4.2 に追加済み。Agent 側 `internal-api-client.ts` の Zod schema (session_ended の reason enum) に同値を追加 | `packages/translation/src/schemas.ts`, `apps/translation-agent/src/internal-api-client.ts` | スキーマ test |
| T9 | error event → AppError mapping を `openai-ws-client.ts` 内に実装 (§10.1 表) | `openai-ws-client.ts` | unit test |
| T10 | degraded/recovered 判定ロジック (§7) を `translation-session.ts` に追加。Data Channel publish 未実装で良い (D3 で確定後に publish 実装) | `translation-session.ts` | unit test |
| T11 | gate-check.ts で 30 分連続実行モードと WS 強制切断/再接続シナリオを実装 | `apps/translation-agent/scripts/gate-check.ts` | Gate Check 緑 |

---

## 12. 既知のリスク

1. **OpenAI Translation endpoint の `audio.input.format` 受理可否**: §4.3 で「`audio.output.language` のみ送信して挙動確認」と書いたが、もし `format` 未指定で 400 が返るなら gate-check の最初の試験で判明。判明次第、本書の次バージョン (gate-check 後) で更新。
2. **`session.output_transcript.done` の存在**: 公式リファレンスに `.done` バリアントの記載を取得できず (researcher 調査結果 §3)。**gate-check 実走で `.done` が来るか観測**、来ない場合は `.delta` の `elapsed_ms` 終端で判定する代替実装。
3. **LiveKit Cloud のリージョン**: 翻訳音声の往復遅延に影響する。D2 deployment.md で region を明示確定する (Sprint 2)。
4. **VAD なしの pending buffer フラッシュ漏れ**: Translation API には commit イベントが存在せず (§4.1 §4.5)、`end()` で `session.close` を送ったとき pending input audio が server 側で確実にフラッシュされるかは公式未確認。長時間無音→突然 close の場合に最終翻訳が出ない可能性がある。OpenAI サーバ VAD が自動処理する想定だが gate-check で要確認。
5. **AudioStream 接続後の最初の 100ms**: SDK のリサンプル初期化で最初の数フレームが歪む既知の挙動 (LiveKit GitHub Issue 多数)。`captureToAgent` 計測の最初の値はノイズとして除外する。

---

## 13. 改訂履歴
- v1 (2026-05-12) 初版。Sprint 1 残課題 (event 名 / 計測点 / commit タイミング) を canonical 化し、Sprint 2 Gate Check 着手の入口を整備。OpenAI 公式 spec との差異 6 項目を明示。
- v1.1 (2026-05-12) PR #28 Round 1 レビュー反映 (Critical 4 + Warning 5): commit イベントは Translation API に未存在 → `session.close` フラッシュに変更、レイテンシ計測 4→5 点 (`agentToOpenAI` 追加、`module-contracts.md` §7.4.4 と同期)、`module-contracts.md` 参照を §2.7 → §7.4.2 / §7.4.4 に修正、ヘッダーの上位文書バージョン v1.0.0 → v1.1.0、T11 のファイルパスを `apps/translation-agent/scripts/gate-check.ts` に修正、`architecture.md` 行番号 558→557。
- v1.2 (2026-05-12) PR #28 Round 2 レビュー反映 (Critical 1 + Warning 2): §6.1 状態遷移図の `[ending]` ブロックを `session.close` 送信に修正 (§4.5 と同期)、`module-contracts.md` §7.4.2 に「実装側 Zod 同期は T8 で実施」「`architecture.md` Track 名修正は別 PR」を明示、§7.4.4 `openAIFirstDelta` コメントを公式名 (`session.input_audio_buffer.append` → `session.output_audio.delta`) に修正。
- v1.3 (2026-05-12) PR #28 Round 3 レビュー反映 (Warning 1 + Suggestion 1): §12 リスク 1 の「v1.1 に更新」陳腐化表記を「次バージョンで更新」に修正、§12 リスク 4 の「commit 漏れ」表現を §4.5 と整合する「pending buffer フラッシュ漏れ (session.close 経由)」に書き換え。
