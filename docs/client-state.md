# TranCall クライアント状態管理設計

## 技術: Zustand + TanStack Query

- Zustand: リアルタイム通話状態、認証状態、設定（頻繁に変わるもの）
- TanStack Query: APIデータフェッチ（連絡先一覧、通話履歴、プラン情報）

## ストア定義

### AuthStore

```typescript
interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  consentGiven: boolean;

  signIn: (email: string, password: string) => Promise<Result<AuthSession, AppError>>;
  signUp: (cmd: SignUpCommand) => Promise<Result<AuthSession, AppError>>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<Result<UserProfile, AppError>>;
  giveConsent: (version: string) => Promise<Result<true, AppError>>;
  refreshToken: () => Promise<void>;
}
```

### CallStore

```typescript
type CallPhase =
  | "idle"
  | "pre_call_setup"     // SCR-009
  | "ringing_outgoing"   // SCR-010
  | "ringing_incoming"   // SCR-004
  | "connecting"
  | "active"             // SCR-003
  | "reconnecting"
  | "ended";             // SCR-011

interface TranslationState {
  enabled: boolean;
  inputLanguage: string;
  outputLanguage: string;
  status: "inactive" | "connecting" | "active" | "degraded" | "stopped";
  degradedReason?: "rate_limited" | "ws_disconnect" | "safety_stop" | "provider_error";
}

interface SubtitleEntry {
  id: string;
  speakerName: string;
  originalDelta: string;
  translatedDelta: string;
  isFinal: boolean;
  timestamp: number;
}

interface CallState {
  phase: CallPhase;
  roomId: RoomId | null;
  roomState: RoomState | null;
  livekitToken: string | null;

  // 翻訳状態
  translation: TranslationState;

  // 字幕
  subtitles: SubtitleEntry[];
  showSubtitles: boolean;

  // 原音制御
  ambientPassthroughVolume: number;  // 通常0.3、fallback時1.0
  translatedTrackVolume: number;     // 通常0.9、ducking時

  // 通話中UI状態
  isMuted: boolean;
  isSpeakerOn: boolean;
  callDuration: number; // 秒

  // アクション
  startCall: (contactUserId: UserId, config: TranslationConfig) => Promise<Result<RoomState, AppError>>;
  acceptIncomingCall: (roomId: RoomId) => Promise<Result<RoomState, AppError>>;
  declineIncomingCall: (roomId: RoomId) => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleTranslation: () => void;
  switchToRawAudio: () => void;       // 原音100%に切替
  switchToTranslated: () => void;     // 翻訳モードに戻す
  appendSubtitle: (entry: SubtitleEntry) => void;
}
```

### SettingsStore

```typescript
interface SettingsState {
  // 翻訳設定
  nativeLanguage: OutputLanguage;
  showSubtitles: boolean;

  // 通知設定
  notificationsEnabled: boolean;
  voipPushToken: string | null;

  // アクション
  setNativeLanguage: (lang: OutputLanguage) => void;
  setShowSubtitles: (show: boolean) => void;
  registerPushToken: (token: string, platform: "ios" | "android") => Promise<void>;
}
```

## TanStack Query キー設計

```typescript
const queryKeys = {
  contacts: {
    all: ["contacts"] as const,
    search: (q: string) => ["contacts", "search", q] as const,
  },
  rooms: {
    history: (before?: string) => ["rooms", "history", before] as const,
    detail: (roomId: string) => ["rooms", roomId] as const,
  },
  billing: {
    subscription: ["billing", "subscription"] as const,
    usage: (periodStart: string) => ["billing", "usage", periodStart] as const,
  },
  transcripts: {
    detail: (roomId: string) => ["transcripts", roomId] as const,
  },
} as const;
```

## 状態遷移図（CallStore.phase）

```
idle ──startCall──> pre_call_setup ──confirm──> ringing_outgoing ──accepted──> connecting ──connected──> active
  │                                                                                                       │
  │ <──incomingCall── ringing_incoming ──accept──> connecting ──connected──> active                        │
  │                       │                                                    │                          │
  │                    decline                                            reconnecting ──success──> active │
  │                       │                                                    │                          │
  │                       v                                                 failure                       │
  │                     idle                                                   │                          │
  │                                                                            v                          │
  │<────────────────────────────────────────────────────── ended <──endCall────┘
```
