// =============================================================================
// VoiceTranslate — Zodスキーマ設計リファレンス
// =============================================================================
// モジュール境界は全てZodスキーマで定義。
// `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error` は全面禁止。
// TSConfig: strict: true, noUncheckedIndexedAccess: true
// ESLint: @typescript-eslint/no-explicit-any: "error"
// =============================================================================

import { z } from "zod";

// =============================================================================
// 1. shared-kernel — 全モジュール共通の基本型
// =============================================================================

// --- Branded Types (プリミティブを意味で区別) ---
const UserId = z.string().uuid().brand<"UserId">();
const RoomId = z.string().uuid().brand<"RoomId">();
const TrackId = z.string().uuid().brand<"TrackId">();
const ParticipantId = z.string().uuid().brand<"ParticipantId">();
const TranslationSessionId = z.string().uuid().brand<"TranslationSessionId">();

type UserId = z.infer<typeof UserId>;
type RoomId = z.infer<typeof RoomId>;
type TrackId = z.infer<typeof TrackId>;
type ParticipantId = z.infer<typeof ParticipantId>;
type TranslationSessionId = z.infer<typeof TranslationSessionId>;

// --- 言語コード (GPT-Realtime-Translate 出力対応13言語) ---
const OutputLanguage = z.enum([
  "en", "es", "pt", "fr", "ja", "ru", "zh",
  "de", "ko", "hi", "id", "vi", "it",
]);
type OutputLanguage = z.infer<typeof OutputLanguage>;

// 入力言語は70+あるが、主要なもののみ列挙（残りはstringで受け入れ）
const InputLanguage = z.string().min(2).max(10);
type InputLanguage = z.infer<typeof InputLanguage>;

// --- ドメインイベント基底 ---
const DomainEventBase = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  aggregateId: z.string().uuid(),
});

// --- Result型（Either パターン、例外を投げない） ---
function createResult<T extends z.ZodType, E extends z.ZodType>(
  dataSchema: T,
  errorSchema: E
) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({ ok: z.literal(false), error: errorSchema }),
  ]);
}

// --- 共通エラー型 ---
const AppError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
type AppError = z.infer<typeof AppError>;

// =============================================================================
// 2. auth モジュール — Public API スキーマ
// =============================================================================

// --- コマンド (外部→モジュールへの入力) ---
const SignUpCommand = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50),
  nativeLanguage: OutputLanguage,
});
type SignUpCommand = z.infer<typeof SignUpCommand>;

const SignInCommand = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

// --- クエリ結果 (モジュール→外部への出力) ---
const UserProfile = z.object({
  userId: UserId,
  email: z.string().email(),
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
});
type UserProfile = z.infer<typeof UserProfile>;

const AuthSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  user: UserProfile,
});
type AuthSession = z.infer<typeof AuthSession>;

const AuthResult = createResult(AuthSession, AppError);
type AuthResult = z.infer<typeof AuthResult>;

// --- イベント ---
const UserRegisteredEvent = DomainEventBase.extend({
  type: z.literal("auth.user_registered"),
  payload: z.object({
    userId: UserId,
    email: z.string().email(),
    nativeLanguage: OutputLanguage,
  }),
});

// --- モジュール公開Facade型 ---
interface AuthFacade {
  signUp(cmd: SignUpCommand): Promise<AuthResult>;
  signIn(cmd: z.infer<typeof SignInCommand>): Promise<AuthResult>;
  getProfile(userId: UserId): Promise<z.infer<typeof createResult<typeof UserProfile, typeof AppError>>>;
  validateToken(token: string): Promise<z.infer<typeof createResult<typeof UserProfile, typeof AppError>>>;
}

// =============================================================================
// 3. room モジュール — 通話セッション管理
// =============================================================================

const RoomStatus = z.enum(["waiting", "active", "ended"]);

const CreateRoomCommand = z.object({
  creatorId: UserId,
  inviteeIds: z.array(UserId).min(1).max(49), // 1対1〜50人
  roomType: z.enum(["audio", "video"]),         // Phase1はaudioのみ
  translationEnabled: z.boolean(),
});
type CreateRoomCommand = z.infer<typeof CreateRoomCommand>;

const RoomParticipant = z.object({
  participantId: ParticipantId,
  userId: UserId,
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  joinedAt: z.string().datetime(),
  role: z.enum(["host", "member"]),
  isMuted: z.boolean(),
});

const RoomState = z.object({
  roomId: RoomId,
  status: RoomStatus,
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
  participants: z.array(RoomParticipant),
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
type RoomState = z.infer<typeof RoomState>;

// --- イベント ---
const RoomCreatedEvent = DomainEventBase.extend({
  type: z.literal("room.created"),
  payload: z.object({
    roomId: RoomId,
    creatorId: UserId,
    roomType: z.enum(["audio", "video"]),
    translationEnabled: z.boolean(),
  }),
});

const ParticipantJoinedEvent = DomainEventBase.extend({
  type: z.literal("room.participant_joined"),
  payload: RoomParticipant,
});

const ParticipantLeftEvent = DomainEventBase.extend({
  type: z.literal("room.participant_left"),
  payload: z.object({
    roomId: RoomId,
    participantId: ParticipantId,
    reason: z.enum(["left", "disconnected", "kicked"]),
  }),
});

const RoomResult = createResult(RoomState, AppError);

interface RoomFacade {
  create(cmd: CreateRoomCommand): Promise<z.infer<typeof RoomResult>>;
  join(roomId: RoomId, userId: UserId): Promise<z.infer<typeof RoomResult>>;
  leave(roomId: RoomId, participantId: ParticipantId): Promise<z.infer<typeof RoomResult>>;
  getState(roomId: RoomId): Promise<z.infer<typeof RoomResult>>;
}

// =============================================================================
// 4. media モジュール — 音声トラック抽象化 + Transport Port
// =============================================================================

// --- AudioFrame: 翻訳パイプラインの入出力単位 ---
const AudioFrameSchema = z.object({
  sampleRate: z.literal(16000),               // GPT-RT-Translate要件
  channels: z.literal(1),                      // モノラル
  format: z.enum(["pcm16", "opus"]),
  durationMs: z.number().int().positive(),
  data: z.instanceof(ArrayBuffer),             // PCMバイナリ
  timestamp: z.number(),                       // ミリ秒
});
type AudioFrame = z.infer<typeof AudioFrameSchema>;

const MediaTrackInfo = z.object({
  trackId: TrackId,
  participantId: ParticipantId,
  kind: z.enum(["audio", "video"]),            // Phase1はaudioのみ
  source: z.enum(["microphone", "camera", "screen", "translation"]),
  muted: z.boolean(),
});
type MediaTrackInfo = z.infer<typeof MediaTrackInfo>;

// --- Transport Port (Adapter インターフェース) ---
// これがPhase2での差し替え境界

const CreateRoomOpts = z.object({
  roomId: RoomId,
  maxParticipants: z.number().int().min(2).max(50),
  emptyTimeout: z.number().int().default(300),  // 秒
});

const JoinRoomOpts = z.object({
  roomId: RoomId,
  participantId: ParticipantId,
  token: z.string(),
});

// Port定義（interfaceでなくZod-drivenの型）
interface TransportPort {
  createRoom(opts: z.infer<typeof CreateRoomOpts>): Promise<void>;
  deleteRoom(roomId: RoomId): Promise<void>;
  generateToken(
    roomId: RoomId,
    participantId: ParticipantId,
    permissions: z.infer<typeof TrackPermissions>
  ): Promise<string>;
  getAudioStream(
    roomId: RoomId,
    participantId: ParticipantId
  ): AsyncIterable<AudioFrame>;
  publishTranslatedTrack(
    roomId: RoomId,
    targetParticipantId: ParticipantId,
    source: AsyncIterable<AudioFrame>
  ): Promise<TrackId>;
}

const TrackPermissions = z.object({
  canPublish: z.boolean(),
  canSubscribe: z.boolean(),
  canPublishData: z.boolean(),
});

// =============================================================================
// 5. translation モジュール — GPT-RT-Translate接続
// =============================================================================

const TranslationConfig = z.object({
  sessionId: TranslationSessionId,
  inputLanguage: InputLanguage,     // 自動検出も可 (auto)
  outputLanguage: OutputLanguage,   // 13言語限定
  voice: z.enum([
    "alloy", "ash", "ballad", "coral", "echo",
    "fable", "onyx", "nova", "sage", "shimmer",
    "cedar", "marin",
  ]).default("alloy"),
});
type TranslationConfig = z.infer<typeof TranslationConfig>;

const TranslatedFrame = z.object({
  audio: AudioFrameSchema,
  transcript: z.object({
    original: z.string(),
    translated: z.string(),
    isFinal: z.boolean(),
  }).nullable(),
});
type TranslatedFrame = z.infer<typeof TranslatedFrame>;

// 翻訳セッションの利用量（課金に使う）
const TranslationUsage = z.object({
  sessionId: TranslationSessionId,
  roomId: RoomId,
  participantId: ParticipantId,
  inputLanguage: InputLanguage,
  outputLanguage: OutputLanguage,
  durationSeconds: z.number().nonnegative(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
type TranslationUsage = z.infer<typeof TranslationUsage>;

// --- イベント ---
const TranslationStartedEvent = DomainEventBase.extend({
  type: z.literal("translation.started"),
  payload: z.object({
    sessionId: TranslationSessionId,
    roomId: RoomId,
    sourceParticipantId: ParticipantId,
    targetParticipantId: ParticipantId,
    inputLanguage: InputLanguage,
    outputLanguage: OutputLanguage,
  }),
});

const TranslationEndedEvent = DomainEventBase.extend({
  type: z.literal("translation.ended"),
  payload: TranslationUsage,
});

// --- Facade ---
interface TranslationFacade {
  startSession(config: TranslationConfig): Promise<z.infer<typeof createResult<typeof TranslationConfig, typeof AppError>>>;
  translate(
    sessionId: TranslationSessionId,
    input: AsyncIterable<AudioFrame>
  ): AsyncIterable<TranslatedFrame>;
  endSession(sessionId: TranslationSessionId): Promise<TranslationUsage>;
  getUsage(sessionId: TranslationSessionId): Promise<TranslationUsage>;
}

// =============================================================================
// 6. billing モジュール — 従量課金
// =============================================================================

const PlanTier = z.enum(["free", "light", "standard", "business"]);

const PlanConfig = z.object({
  tier: PlanTier,
  includedMinutes: z.number().int().nonnegative(),
  overageRatePerMinute: z.number().nonnegative(), // 円
  monthlyPrice: z.number().int().nonnegative(),   // 円
});

const SubscriptionState = z.object({
  userId: UserId,
  plan: PlanConfig,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  usedMinutes: z.number().nonnegative(),
  remainingMinutes: z.number().nonnegative(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
});
type SubscriptionState = z.infer<typeof SubscriptionState>;

// 通話終了時にTranslationEndedEventをリッスンして利用量を加算
const RecordUsageCommand = z.object({
  userId: UserId,
  sessionId: TranslationSessionId,
  durationSeconds: z.number().nonnegative(),
});

const BillingResult = createResult(SubscriptionState, AppError);

interface BillingFacade {
  getSubscription(userId: UserId): Promise<z.infer<typeof BillingResult>>;
  recordUsage(cmd: z.infer<typeof RecordUsageCommand>): Promise<z.infer<typeof BillingResult>>;
  canStartCall(userId: UserId): Promise<z.infer<typeof createResult<z.ZodLiteral<true>, typeof AppError>>>;
  createCheckoutSession(
    userId: UserId,
    tier: z.infer<typeof PlanTier>
  ): Promise<z.infer<typeof createResult<z.ZodObject<{ url: z.ZodString }>, typeof AppError>>>;
}

// =============================================================================
// 7. notification モジュール — Push通知
// =============================================================================

const NotificationTarget = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("ios"),
    voipToken: z.string(),
    bundleId: z.string(),
  }),
  z.object({
    platform: z.literal("android"),
    fcmToken: z.string(),
  }),
  // Phase 2 で追加
  // z.object({
  //   platform: z.literal("wechat"),
  //   openId: z.string(),
  //   templateId: z.string(),
  // }),
]);
type NotificationTarget = z.infer<typeof NotificationTarget>;

const IncomingCallNotification = z.object({
  roomId: RoomId,
  callerName: z.string(),
  callerAvatarUrl: z.string().url().nullable(),
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
});

interface NotificationFacade {
  registerDevice(userId: UserId, target: NotificationTarget): Promise<void>;
  sendIncomingCall(
    targetUserId: UserId,
    notification: z.infer<typeof IncomingCallNotification>
  ): Promise<z.infer<typeof createResult<z.ZodLiteral<true>, typeof AppError>>>;
}

// =============================================================================
// 8. transcript モジュール — 字幕 / 文字起こし
// =============================================================================

const TranscriptSegment = z.object({
  segmentId: z.string().uuid(),
  roomId: RoomId,
  participantId: ParticipantId,
  speakerName: z.string(),
  originalText: z.string(),
  translatedText: z.string().nullable(),
  language: z.string(),
  startTime: z.number(),    // 通話開始からのミリ秒
  endTime: z.number(),
  isFinal: z.boolean(),
});
type TranscriptSegment = z.infer<typeof TranscriptSegment>;

const FullTranscript = z.object({
  roomId: RoomId,
  segments: z.array(TranscriptSegment),
  duration: z.number(),
  participantCount: z.number().int(),
  generatedAt: z.string().datetime(),
});

interface TranscriptFacade {
  appendSegment(segment: TranscriptSegment): Promise<void>;
  getTranscript(
    roomId: RoomId
  ): Promise<z.infer<typeof createResult<typeof FullTranscript, typeof AppError>>>;
  getLiveSegments(roomId: RoomId): AsyncIterable<TranscriptSegment>;
}

// =============================================================================
// 9. contact モジュール
// =============================================================================

const ContactEntry = z.object({
  contactId: z.string().uuid(),
  userId: UserId,
  contactUserId: UserId,
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
  addedAt: z.string().datetime(),
  isFavorite: z.boolean(),
});

const AddContactCommand = z.object({
  userId: UserId,
  contactUserId: UserId,
});

interface ContactFacade {
  addContact(
    cmd: z.infer<typeof AddContactCommand>
  ): Promise<z.infer<typeof createResult<typeof ContactEntry, typeof AppError>>>;
  removeContact(userId: UserId, contactId: string): Promise<void>;
  listContacts(userId: UserId): Promise<z.infer<typeof ContactEntry>[]>;
  searchUsers(query: string): Promise<z.infer<typeof UserProfile>[]>;
}

// =============================================================================
// 10. ドメインイベントの統合型（Event Bus用）
// =============================================================================

const DomainEvent = z.discriminatedUnion("type", [
  UserRegisteredEvent,
  RoomCreatedEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  TranslationStartedEvent,
  TranslationEndedEvent,
]);
type DomainEvent = z.infer<typeof DomainEvent>;

// Event Busインターフェース
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent["type"]>(
    eventType: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>
  ): () => void; // unsubscribe関数を返す
}

// =============================================================================
// 11. バリデーションユーティリティ（safeParse統一ラッパー）
// =============================================================================

/**
 * 全モジュールのFacadeメソッド入口で使う。
 * parse()は例外を投げるがsafeParse()は投げない。
 * この関数でResult型に統一し、try-catchを不要にする。
 */
function validate<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<typeof createResult<T, typeof AppError>> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    error: {
      code: "VALIDATION_ERROR",
      message: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      details: { issues: result.error.issues },
    },
  };
}

// 使用例:
// const validated = validate(CreateRoomCommand, untrustedInput);
// if (!validated.ok) return validated; // そのままResult型で返せる
// const room = await roomService.create(validated.data); // 型安全

// =============================================================================
// 12. ESLint + TSConfig ルール（プロジェクトルート）
// =============================================================================

/*
// eslint.config.ts
export default [
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // as unknown as T のパターンも禁止
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],
    },
  },
];

// tsconfig.json (抜粋)
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
*/

// =============================================================================
// 13. Export Map — 各モジュールのpackage.json exports設定
// =============================================================================

/*
// packages/translation/package.json
{
  "name": "@voicetranslate/translation",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schemas": {
      "types": "./dist/schemas.d.ts",
      "import": "./dist/schemas.js"
    }
  },
  // ↑ これにより外部モジュールは
  //   import { TranslationConfig } from "@voicetranslate/translation/schemas";
  //   のみアクセス可能。内部実装には手が届かない。
  "files": ["dist"]
}
*/

export {
  // shared-kernel
  UserId, RoomId, TrackId, ParticipantId, TranslationSessionId,
  OutputLanguage, InputLanguage,
  DomainEventBase, AppError,
  createResult, validate,
  // auth
  SignUpCommand, SignInCommand, UserProfile, AuthSession, AuthResult,
  UserRegisteredEvent,
  // room
  RoomStatus, CreateRoomCommand, RoomParticipant, RoomState,
  RoomCreatedEvent, ParticipantJoinedEvent, ParticipantLeftEvent,
  // media
  AudioFrameSchema, MediaTrackInfo, CreateRoomOpts, JoinRoomOpts, TrackPermissions,
  // translation
  TranslationConfig, TranslatedFrame, TranslationUsage,
  TranslationStartedEvent, TranslationEndedEvent,
  // billing
  PlanTier, PlanConfig, SubscriptionState, RecordUsageCommand,
  // notification
  NotificationTarget, IncomingCallNotification,
  // transcript
  TranscriptSegment, FullTranscript,
  // contact
  ContactEntry, AddContactCommand,
  // events
  DomainEvent,
};

// Facade型（実装側でimplementsする）
export type {
  AuthFacade,
  RoomFacade,
  TransportPort,
  TranslationFacade,
  BillingFacade,
  NotificationFacade,
  TranscriptFacade,
  ContactFacade,
  EventBus,
  // 推論型
  AudioFrame,
  TranslatedFrame as TranslatedFrameType,
  TranslationConfig as TranslationConfigType,
  TranslationUsage as TranslationUsageType,
  RoomState as RoomStateType,
  UserProfile as UserProfileType,
  SubscriptionState as SubscriptionStateType,
  DomainEvent as DomainEventType,
};
