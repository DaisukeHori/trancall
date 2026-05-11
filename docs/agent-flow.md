# Translation Agent 接続フロー詳細設計

## シーケンス（1対1通話）

```
User A (JA)        Mobile App A     API Server      LiveKit SFU      Translation Agent    OpenAI RT-Translate
    │                   │               │               │                   │                    │
    │ 1. Call start     │               │               │                   │                    │
    │──────────────────>│               │               │                   │                    │
    │                   │ 2. POST /rooms│               │                   │                    │
    │                   │──────────────>│               │                   │                    │
    │                   │               │ 3. canStartCall│                  │                    │
    │                   │               │ 4. reserveMins │                  │                    │
    │                   │               │ 5. Create Room │                  │                    │
    │                   │               │──────────────>│                   │                    │
    │                   │               │ 6. Send Push   │                  │                    │
    │                   │               │───────────────────────────────────────────> User B     │
    │                   │ 7. token      │               │                   │                    │
    │                   │<─────────────│               │                   │                    │
    │                   │ 8. Join Room (WebRTC)         │                   │                    │
    │                   │─────────────────────────────>│                   │                    │
    │                   │               │               │ 9. Room event     │                    │
    │                   │               │               │ (participant_joined)                   │
    │                   │               │               │──────────────────>│                    │
    │                   │               │               │                   │ 10. Join Room (bot)│
    │                   │               │               │<─────────────────│                    │
    │                   │               │               │                   │ 11. Subscribe A mic│
    │                   │               │               │──AudioFrames────>│                    │
    │                   │               │               │                   │ 12. Open WS (JA→EN)│
    │                   │               │               │                   │───────────────────>│
    │                   │               │               │                   │ 13. Stream audio   │
    │                   │               │               │                   │───PCM 24kHz───────>│
    │                   │               │               │                   │ 14. Translated audio│
    │                   │               │               │                   │<──PCM 24kHz────────│
    │                   │               │               │                   │ 15. Publish Track  │
    │                   │               │               │                   │ "trans-A-to-en"    │
    │                   │               │               │<─────────────────│                    │
    │                   │               │               │                   │ 16. Subtitle delta │
    │                   │               │               │ (data channel)    │                    │
    │                   │               │               │──────────────────────> User B screen   │
    │                   │               │               │                   │                    │
    │                   │               │               │                   │ 17. Heartbeat (30s)│
    │                   │               │ <──────────────────────────────────│                    │
    │                   │               │ 18. POST /internal/heartbeat      │                    │
    │                   │               │ 19. usage_window insert           │                    │
    │                   │               │ 20. {shouldContinue: true}        │                    │
    │                   │               │──────────────────────────────────>│                    │
```

## Agent 擬似コード

```typescript
// apps/translation-agent/src/agent.ts

import { RoomServiceClient, Room, RemoteTrackPublication } from "@livekit/rtc-node";

interface AgentConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  openaiApiKey: string;
  internalApiUrl: string;
  agentSecret: string;
}

class TranslationAgent {
  private activeSessions = new Map<string, TranslationSession>();

  async connectToRoom(roomId: string, config: AgentConfig): Promise<void> {
    // 1. LiveKit Room に bot として参加
    const room = new Room();
    const token = await this.generateAgentToken(roomId, config);
    await room.connect(config.livekitUrl, token);

    // 2. 参加者の Audio Track を監視
    room.on("trackSubscribed", (track, publication, participant) => {
      if (track.kind === "audio" && publication.source === "microphone") {
        this.handleNewAudioTrack(room, track, participant, config);
      }
    });

    // 3. 参加者退出を監視
    room.on("participantDisconnected", (participant) => {
      this.stopSessionsForParticipant(participant.identity);
    });
  }

  private async handleNewAudioTrack(
    room: Room,
    track: RemoteAudioTrack,
    participant: RemoteParticipant,
    config: AgentConfig,
  ): Promise<void> {
    // 参加者の言語を取得（participant.metadata にnativeLanguageが入っている前提）
    const metadata = JSON.parse(participant.metadata ?? "{}");
    const sourceLanguage = metadata.nativeLanguage; // "ja"

    // 他の参加者の言語を確認
    for (const [, otherParticipant] of room.remoteParticipants) {
      if (otherParticipant.identity === participant.identity) continue;
      const otherMeta = JSON.parse(otherParticipant.metadata ?? "{}");
      const targetLanguage = otherMeta.nativeLanguage; // "en"

      // 同一言語ならスキップ
      if (sourceLanguage === targetLanguage) continue;

      // 翻訳セッション開始
      const session = new TranslationSession({
        roomId: room.name,
        sourceParticipantId: participant.identity,
        targetParticipantId: otherParticipant.identity,
        inputLanguage: sourceLanguage,
        outputLanguage: targetLanguage,
        openaiApiKey: config.openaiApiKey,
        agentSecret: config.agentSecret,
        internalApiUrl: config.internalApiUrl,
      });

      await session.start(room, track);
      this.activeSessions.set(session.id, session);
    }
  }
}

class TranslationSession {
  id: string;
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startedAt: Date;

  constructor(private config: TranslationSessionConfig) {
    this.id = crypto.randomUUID();
    this.startedAt = new Date();
  }

  async start(room: Room, sourceTrack: RemoteAudioTrack): Promise<void> {
    // 1. OpenAI WebSocket接続
    const wsUrl = "wss://api.openai.com/v1/realtime/translations"
      + "?model=gpt-realtime-translate";
    this.ws = new WebSocket(wsUrl, {
      headers: {
        "Authorization": `Bearer ${this.config.openaiApiKey}`,
        "OpenAI-Safety-Identifier": this.hashUserId(this.config.sourceParticipantId),
      },
    });

    // 2. セッション設定送信
    this.ws.on("open", () => {
      this.ws.send(JSON.stringify({
        type: "session.update",
        session: {
          input_language: this.config.inputLanguage,
          output_language: this.config.outputLanguage,
          modalities: ["audio", "text"],
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_sample_rate: 24000,
          output_audio_sample_rate: 24000,
        },
      }));
    });

    // 3. ソース音声の取り込み → OpenAIへ転送
    const audioStream = sourceTrack.createAudioStream({ sampleRate: 24000 });
    this.pipeAudioToOpenAI(audioStream);

    // 4. OpenAIからの翻訳音声 → LiveKit Track として Publish
    this.handleOpenAIResponses(room);

    // 5. Heartbeat開始（30秒ごと）
    this.startHeartbeat();

    // 6. 内部APIにセッション開始通知
    await this.notifyEvent("translation.started");
  }

  private pipeAudioToOpenAI(stream: AsyncIterable<AudioFrame>): void {
    (async () => {
      for await (const frame of stream) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) break;
        // PCM 24kHz mono → base64
        const b64 = Buffer.from(frame.data).toString("base64");
        this.ws.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: b64,
        }));
      }
    })();
  }

  private handleOpenAIResponses(room: Room): void {
    const translatedTrack = new LocalAudioTrack();

    this.ws.on("message", (raw: Buffer) => {
      const event = JSON.parse(raw.toString());

      switch (event.type) {
        case "output_audio_buffer.audio_chunk": {
          // 翻訳済み音声フレーム（200ms PCM16）
          const pcm = Buffer.from(event.audio, "base64");
          translatedTrack.publishFrame({
            data: new Uint8Array(pcm),
            sampleRate: 24000,
            channels: 1,
            format: "pcm16",
          });
          break;
        }
        case "output_audio_buffer.transcript_delta": {
          // 字幕デルタ → LiveKit data channel で配信
          room.localParticipant.publishData(JSON.stringify({
            type: "subtitle.delta",
            sessionId: this.id,
            speakerName: this.config.sourceParticipantId,
            translatedDelta: event.delta,
            isFinal: false,
          }));
          break;
        }
        case "output_audio_buffer.transcript_done": {
          // 最終確定 → 内部APIでDB保存
          this.persistFinalSegment(event);
          break;
        }
      }
    });

    // Track Publish（命名規約: trans-{sourceId}-to-{lang}）
    room.localParticipant.publishTrack(translatedTrack, {
      name: `trans-${this.config.sourceParticipantId}-to-${this.config.outputLanguage}`,
      source: "translation",
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
      const response = await fetch(`${this.config.internalApiUrl}/internal/translation/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Token": this.signRequest(this.config.agentSecret),
          "X-Idempotency-Key": `${this.id}:heartbeat:${Math.floor(elapsed / 30)}`,
        },
        body: JSON.stringify({
          sessionId: this.id,
          userId: this.config.sourceParticipantId,
          windowStart: new Date(this.startedAt.getTime() + (elapsed - 30) * 1000).toISOString(),
          durationSeconds: 30,
          languagePair: `${this.config.inputLanguage}-${this.config.outputLanguage}`,
        }),
      });

      const result = await response.json();
      if (!result.data?.shouldContinue) {
        // 残高不足 → 翻訳停止、原音fallback
        await this.stopWithFallback("insufficient_balance");
      }
    }, 30_000);
  }

  async stop(reason: string): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) this.ws.close();
    await this.notifyEvent("translation.ended");
  }
}
```

## WebSocket再接続フロー

```
1. WebSocket onclose / onerror 検出
2. 再接続中: 音声破棄（バッファしない）
3. 指数バックオフ: 1s → 2s → 4s → 8s → 16s（最大5回）
4. 再接続成功: クリーンスタート（音声ストリーム新規開始）
5. 再接続失敗（5回超）: 翻訳停止 → 原音fallback → ユーザー通知
6. Transcript欠落: "[翻訳中断: Xs]" としてセグメント記録
```

## Crash Recovery

```
Agent crash (SIGKILL等)
  ↓
LiveKit: bot participant disconnected
  ↓
Client: translated track が消える
  ↓
Client: ambient passthrough 30% → 100% に自動切替
  ↓
Client: UI に「翻訳が一時停止しました」表示
  ↓
Agent supervisor (pm2/systemd): 自動再起動
  ↓
Agent: Room に再参加 → 翻訳再開
  ↓
Client: translated track 復活 → ambient passthrough に戻る
```
