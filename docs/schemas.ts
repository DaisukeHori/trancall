// =============================================================================
// TranCall — Zodスキーマ定義 (v2 — コンパイル可能版)
// =============================================================================
// このファイルは packages/shared-kernel/src/schemas/ に物理配置予定。
// 全モジュール境界の契約をここで定義する。
// `as any`, `as unknown`, `@ts-ignore` は禁止。
// assertionは adapters/* と brand.ts のヘルパー関数内のみ許可。
// =============================================================================

import { z } from "zod";

// =============================================================================
// 1. Branded Types + ファクトリヘルパー
// =============================================================================

const UserIdSchema = z.string().uuid().brand("UserId");
const RoomIdSchema = z.string().uuid().brand("RoomId");
const TrackIdSchema = z.string().uuid().brand("TrackId");
const ParticipantIdSchema = z.string().uuid().brand("ParticipantId");
const TranslationSessionIdSchema = z.string().uuid().brand("TranslationSessionId");
const LiveKitTrackSidSchema = z.string().min(1).brand("LiveKitTrackSid");
const OpenAISessionIdSchema = z.string().min(1).brand("OpenAISessionId");

type UserId = z.infer<typeof UserIdSchema>;
type RoomId = z.infer<typeof RoomIdSchema>;
type TrackId = z.infer<typeof TrackIdSchema>;
type ParticipantId = z.infer<typeof ParticipantIdSchema>;
type TranslationSessionId = z.infer<typeof TranslationSessionIdSchema>;
type LiveKitTrackSid = z.infer<typeof LiveKitTrackSidSchema>;
type OpenAISessionId = z.infer<typeof OpenAISessionIdSchema>;

// --- Brand ファクトリヘルパー ---
// 外部入力からBranded Typeを生成する唯一の経路。
// これらの関数内でのみsafeParseを通じてブランドを付与する。

function brandUserId(raw: string) {
  return UserIdSchema.safeParse(raw);
}
function brandRoomId(raw: string) {
  return RoomIdSchema.safeParse(raw);
}
function brandParticipantId(raw: string) {
  return ParticipantIdSchema.safeParse(raw);
}
function brandTrackId(raw: string) {
  return TrackIdSchema.safeParse(raw);
}
function brandTranslationSessionId(raw: string) {
  return TranslationSessionIdSchema.safeParse(raw);
}
function brandLiveKitTrackSid(raw: string) {
  return LiveKitTrackSidSchema.safeParse(raw);
}
function brandOpenAISessionId(raw: string) {
  return OpenAISessionIdSchema.safeParse(raw);
}

// =============================================================================
// 2. 言語
// =============================================================================

const OutputLanguage = z.enum([
  "en", "es", "pt", "fr", "ja", "ru", "zh",
  "de", "ko", "hi", "id", "vi", "it",
]);
type OutputLanguage = z.infer<typeof OutputLanguage>;

// BCP-47準拠 or "auto"
const InputLanguage = z.union([
  z.literal("auto"),
  z.string().regex(/^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,7})?$/),
]);
type InputLanguage = z.infer<typeof InputLanguage>;

// =============================================================================
// 3. 共通型
// =============================================================================

const DomainEventBase = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  aggregateId: z.string().uuid(),
});

const AppError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
  httpStatus: z.number().int().optional(),
  provider: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
type AppError = z.infer<typeof AppError>;

// --- Result型 ---
type ResultOk<T> = { ok: true; data: T };
type ResultErr<E> = { ok: false; error: E };
type Result<T, E = AppError> = ResultOk<T> | ResultErr<E>;

// Zodスキーマから推論した型でResultを作る
type ResultOf<S extends z.ZodType> = Result<z.infer<S>, AppError>;

// --- バリデーションユーティリティ ---
function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
): Result<z.infer<T>, AppError> {
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
      retryable: false,
      details: { issues: result.error.issues },
    },
  };
}

// =============================================================================
// 4. auth モジュール
// =============================================================================

// SignUpCommand / SignInCommand は Sprint 1 で AuthFacade が getProfile のみに縮退後、
// Server 側 facade からは利用されない。Mobile / Web クライアント側で Supabase Auth client SDK
// を呼ぶ際の入力バリデーション用に残置 (REST API 経由ではなく client から直接 Supabase Auth)。
// 詳細は docs/module-contracts.md Section 2.1 と docs/api-spec.md の signup/signin セクション参照。
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
type SignInCommand = z.infer<typeof SignInCommand>;

const UserProfile = z.object({
  userId: UserIdSchema,
  trancallId: z.string().min(3).max(30),
  email: z.string().email(),
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
  consentVersion: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
});
type UserProfile = z.infer<typeof UserProfile>;

// AuthSession は Supabase Auth クライアント SDK 戻り値の型表現用 (client 側で使用)。
// Server 側の AuthFacade は getProfile のみで AuthSession を返さない。
const AuthSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  user: UserProfile,
});
type AuthSession = z.infer<typeof AuthSession>;

const UserRegisteredEvent = DomainEventBase.extend({
  type: z.literal("auth.user_registered"),
  payload: z.object({
    userId: UserIdSchema,
    email: z.string().email(),
    nativeLanguage: OutputLanguage,
  }),
});

// AuthFacade は Sprint 0 で getProfile のみに縮退済み (C-005)。
// signUp / signIn / validateToken は Supabase Auth クライアントが直接担当し、
// Server 側 facade としては Profile lookup のみを公開する。
// 詳細は docs/module-contracts.md Section 2.1 参照。
interface AuthFacade {
  getProfile(userId: UserId): Promise<ResultOf<typeof UserProfile>>;
}

// =============================================================================
// 5. room モジュール
// =============================================================================

// Sprint 1 Layer 2 で確定。詳細は docs/module-contracts.md Section 2.8 / packages/room/src/schemas.ts
const RoomStatus = z.enum(["waiting", "active", "ended"]);

const ParticipantRole = z.enum(["host", "member"]);

const RoomParticipant = z.object({
  id: ParticipantIdSchema,
  userId: UserIdSchema,
  role: ParticipantRole,
  isMuted: z.boolean(),
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
});
type RoomParticipant = z.infer<typeof RoomParticipant>;

const RoomState = z.object({
  roomId: RoomIdSchema,
  status: RoomStatus,
  translationEnabled: z.boolean(),
  createdBy: UserIdSchema,
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  participants: z.array(RoomParticipant),
});
type RoomState = z.infer<typeof RoomState>;

// room_type ("audio"|"video") は DDL には存在するが Layer 2 範囲では使わない。
// Phase 2/3 で video 対応時に CreateCallOpts / RoomState に追加予定。

// DomainEvent は実装 (`packages/*/src/events/*.ts`) でフラット構造を採用。
// 旧 v0 設計の `payload: { ... }` ネストは廃止。canonical Section 0.2「コードが正」に従う。
const RoomCreatedEvent = DomainEventBase.extend({
  type: z.literal("room.created"),
  roomId: RoomIdSchema,
  creatorId: UserIdSchema,
  inviteeIds: z.array(UserIdSchema),
  translationEnabled: z.boolean(),
  createdAt: z.string().datetime(),
});

const ParticipantJoinedEvent = DomainEventBase.extend({
  type: z.literal("room.participant_joined"),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  role: ParticipantRole,
  joinedAt: z.string().datetime(),
});

const ParticipantLeftEvent = DomainEventBase.extend({
  type: z.literal("room.participant_left"),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  leftAt: z.string().datetime(),
});

interface RoomFacade {
  createCall(
    creatorId: UserId,
    inviteeIds: UserId[],
    opts: { translationEnabled: boolean },
  ): Promise<Result<RoomState, AppError>>;
  joinCall(roomId: RoomId, userId: UserId): Promise<Result<RoomState, AppError>>;
  endCall(roomId: RoomId): Promise<Result<RoomState, AppError>>;
  getState(roomId: RoomId): Promise<Result<RoomState, AppError>>;
}

// =============================================================================
// 6. media モジュール（signaling統合済み）
// =============================================================================

// AudioFrameはhot path用の内部型。Zodバリデーションは適用しない。
// セッション開始時のformat検証のみ。
interface AudioFrame {
  sampleRate: 24000 | 48000;
  channels: 1;
  format: "pcm16" | "opus";
  durationMs: number;
  data: Uint8Array;
  timestamp: number;
}

// AudioFrameのメタデータのみZod検証（セッション開始時）
const AudioFormatConfig = z.object({
  sampleRate: z.union([z.literal(24000), z.literal(48000)]),
  channels: z.literal(1),
  format: z.enum(["pcm16", "opus"]),
});

const MediaTrackInfo = z.object({
  trackId: TrackIdSchema,
  participantId: ParticipantIdSchema,
  kind: z.enum(["audio", "video"]),
  source: z.enum(["microphone", "camera", "screen", "translation"]),
  muted: z.boolean(),
});

// Track命名規約
// raw-{participantId}       : 原音トラック
// trans-{sourceId}-to-{lang}: 翻訳済みトラック

const TrackPermissions = z.object({
  canPublish: z.boolean(),
  canSubscribe: z.boolean(),
  canPublishData: z.boolean(),
});

// LiveKitAdapter は packages/media/src/adapters/livekit.ts に配置
// Phase 1では抽象インターフェースを作らず、LiveKit直接実装
// Phase 2でTRTC対応時に抽象を抽出する

// =============================================================================
// 7. translation モジュール
// =============================================================================

const TranslationConfig = z.object({
  sessionId: TranslationSessionIdSchema,
  inputLanguage: InputLanguage,     // OpenAIには送らない。内部の言語ペア判定専用。OpenAIは入力言語を自動検出
  outputLanguage: OutputLanguage,
  // voice選択は不可。GPT-RT-Translateはdynamic voice adaptation
  // safetyIdentifier: SHA-256ハッシュ化したユーザーID
  safetyIdentifier: z.string().regex(/^[a-f0-9]{64}$/),
});
type TranslationConfig = z.infer<typeof TranslationConfig>;

// 翻訳結果（音声 + テキスト）
// OpenAI出力は200msフレーム単位
interface TranslatedFrame {
  audio: AudioFrame;
  transcript: {
    original: string;
    translated: string;
    isFinal: boolean;
  } | null;
}

const TranslationUsage = z.object({
  sessionId: TranslationSessionIdSchema,
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  inputLanguage: InputLanguage,     // OpenAIには送らない。内部の言語ペア判定専用。OpenAIは入力言語を自動検出
  outputLanguage: OutputLanguage,
  durationSeconds: z.number().nonnegative(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
type TranslationUsage = z.infer<typeof TranslationUsage>;

const TranslationStartedEvent = DomainEventBase.extend({
  type: z.literal("translation.started"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    roomId: RoomIdSchema,
    sourceParticipantId: ParticipantIdSchema,
    targetParticipantId: ParticipantIdSchema,
    inputLanguage: InputLanguage,     // OpenAIには送らない。内部の言語ペア判定専用。OpenAIは入力言語を自動検出
    outputLanguage: OutputLanguage,
  }),
});

const TranslationEndedEvent = DomainEventBase.extend({
  type: z.literal("translation.ended"),
  payload: TranslationUsage,
});

// 障害時イベント
const TranslationDegradedEvent = DomainEventBase.extend({
  type: z.literal("translation.degraded"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    reason: z.enum(["rate_limited", "ws_disconnect", "safety_stop", "provider_error"]),
  }),
});

const TranslationRecoveredEvent = DomainEventBase.extend({
  type: z.literal("translation.recovered"),
  payload: z.object({
    sessionId: TranslationSessionIdSchema,
    downtimeSeconds: z.number().nonnegative(),
  }),
});

// Translation Facade
// server-side Agent方式（公式推奨）で実装
// client-side sidecarは公式非推奨のため採用しない
//
// 重要: Sprint 1 で大幅再設計済み。重い処理 (OpenAI WS 接続、AudioFrame 送受信、
// Track Publish) は apps/translation-agent 側 (別プロセス)。
// 本 facade は Server 側で Agent event 受信・永続化・同言語判定・delta バリデーションを担う。
// 詳細は docs/module-contracts.md Section 2.7 参照。
interface TranslationFacade {
  // Agent からの event (session_started/ended/transcript.delta/agent.metrics) を Server 側で処理
  handleAgentEvent(event: unknown): Promise<Result<true, AppError>>;
  // 当該 agent job の利用量取得 (billing 連携用)
  getUsage(agentJobId: string): Promise<Result<TranslationUsage, AppError>>;
  // 同言語判定 utility (ja===ja なら false = 翻訳セッション不要)
  shouldStartSession(
    sourceNativeLanguage: OutputLanguage,
    targetNativeLanguage: OutputLanguage,
  ): boolean;
  // LiveKit Data Channel 受信時の delta バリデーション
  validateLiveDelta(rawDelta: unknown): Result<LiveSubtitleDelta, AppError>;
}

// =============================================================================
// 8. billing モジュール
// =============================================================================

const PlanTier = z.enum(["free", "light", "standard", "business"]);

const PlanConfig = z.object({
  tier: PlanTier,
  includedMinutes: z.number().int().nonnegative(),
  overageRateYen: z.number().int().nonnegative(),
  monthlyPriceYen: z.number().int().nonnegative(),
  transcriptRetentionDays: z.number().int().positive(),
});

const SubscriptionState = z.object({
  userId: UserIdSchema,
  plan: PlanConfig,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  usedMinutes: z.number().nonnegative(),
  remainingMinutes: z.number().nonnegative(),
  cancelAtPeriodEnd: z.boolean(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  iapOriginalTransactionId: z.string().nullable(),
  iapPlatform: z.enum(["apple", "google"]).nullable(),
});
type SubscriptionState = z.infer<typeof SubscriptionState>;

// 利用量記録（heartbeat方式）
const UsageWindow = z.object({
  id: z.string().uuid(),
  userId: UserIdSchema,
  sessionId: TranslationSessionIdSchema,
  roomId: RoomIdSchema,
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative(),
  languagePair: z.string(),
  amountYen: z.number().int().nonnegative(),
  idempotencyKey: z.string(),
  recordedAt: z.string().datetime(),
});

const RecordUsageCommand = z.object({
  userId: UserIdSchema,
  sessionId: TranslationSessionIdSchema,
  windowStart: z.string().datetime(),
  durationSeconds: z.number().nonnegative(),
  idempotencyKey: z.string(),
});

// Sprint 1 で 3 チャネル設計 + Webhook ハンドラ + refundMinutes 追加。
// 詳細は docs/module-contracts.md Section 2.3 参照。
interface BillingFacade {
  getSubscription(userId: UserId): Promise<ResultOf<typeof SubscriptionState>>;
  recordUsage(cmd: z.infer<typeof RecordUsageCommand>): Promise<ResultOf<typeof SubscriptionState>>;
  canStartCall(userId: UserId): Promise<Result<true, AppError>>;
  // sessionId は呼び出し側 (room/server) が事前生成。同一 sessionId で 2 回 reserve しても冪等。
  reserveMinutes(
    userId: UserId,
    sessionId: TranslationSessionId,
    minutes: number,
  ): Promise<Result<true, AppError>>;
  reconcile(userId: UserId, sessionId: TranslationSessionId): Promise<ResultOf<typeof SubscriptionState>>;
  refundMinutes(sessionId: TranslationSessionId): Promise<Result<true, AppError>>;
  // 3 チャネル設計: stripe_web (アプリ外 Web) / storekit_external (日本 MSCA アプリ内)
  createCheckoutSession(
    userId: UserId,
    tier: z.infer<typeof PlanTier>,
    channel: "stripe_web" | "storekit_external",
  ): Promise<Result<{ url: string }, AppError>>;
  // Webhook ハンドラ (server から呼ぶ、冪等性は webhook_events で保証)
  handleStripeWebhook(rawBody: string, signature: string): Promise<Result<true, AppError>>;
  handleAppleIapWebhook(payload: unknown): Promise<Result<true, AppError>>;
  handleGoogleIapWebhook(payload: unknown): Promise<Result<true, AppError>>;
}

// =============================================================================
// 9. notification モジュール
// =============================================================================

const NotificationTarget = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("ios"),
    voipToken: z.string().min(1),
    bundleId: z.string().min(1),
  }),
  z.object({
    platform: z.literal("android"),
    fcmToken: z.string().min(1),
  }),
]);
type NotificationTarget = z.infer<typeof NotificationTarget>;

// Sprint 1 で notification 実装に合わせ callerTrancallId / callerLanguage / timestamp を追加。
// バリデーション強度も実装に合わせて .min(1) を必須箇所に付与。
const IncomingCallNotification = z.object({
  roomId: RoomIdSchema,
  callerName: z.string().min(1),
  callerAvatarUrl: z.string().url().nullable(),
  callerTrancallId: z.string().min(1),
  roomType: z.enum(["audio", "video"]),
  translationEnabled: z.boolean(),
  languagePair: z.string().min(1),
  callerLanguage: z.string().min(1),
  timestamp: z.string().datetime(),
});

// 不在着信通知の body フォーマット: "{callerName} ({callerTrancallId})" (docs/notification-detail.md 厳守)
const MissedCallPayload = z.object({
  callerName: z.string().min(1),
  callerTrancallId: z.string().min(1),
  callerAvatarUrl: z.string().url().nullable(),
  roomId: RoomIdSchema,
  timestamp: z.string().datetime(),
});
type MissedCallPayload = z.infer<typeof MissedCallPayload>;

// Sprint 1 で unregisterDevice / sendMissedCall を追加。
// 詳細は docs/module-contracts.md Section 2.5 参照。
interface NotificationFacade {
  registerDevice(userId: UserId, target: NotificationTarget): Promise<Result<true, AppError>>;
  unregisterDevice(
    userId: UserId,
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true, AppError>>;
  sendIncomingCall(
    targetUserId: UserId,
    notification: z.infer<typeof IncomingCallNotification>,
  ): Promise<Result<true, AppError>>;
  sendMissedCall(
    targetUserId: UserId,
    payload: MissedCallPayload,
  ): Promise<Result<true, AppError>>;
}

// =============================================================================
// 10. transcript モジュール
// =============================================================================

// DBに保存するのはfinal segmentのみ。
// partial deltaはLiveKit data channelで配信し、DBには書かない。

// リアルタイム字幕用（メモリ/data channel のみ、DB保存しない）
const LiveSubtitleDelta = z.object({
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  translationSessionId: TranslationSessionIdSchema.nullable(), // グループ通話時のセッション識別用
  speakerName: z.string(),
  originalDelta: z.string(),
  translatedDelta: z.string(),
  language: z.string(),
  isFinal: z.boolean(),
  timestamp: z.number(),
});

// DB保存用（final segmentのみ）
const TranscriptSegment = z.object({
  segmentId: z.string().uuid(),
  roomId: RoomIdSchema,
  participantId: ParticipantIdSchema,
  speakerName: z.string(),
  originalText: z.string(),
  translatedText: z.string().nullable(),
  languagePair: z.string(),
  startTimeMs: z.number().int(),
  endTimeMs: z.number().int(),
  sequenceNo: z.number().int().nonnegative(),
  sourceEventId: z.string().uuid(),
  agentSessionId: z.string().uuid().nullable(),
  retentionUntil: z.string().datetime(),
  createdAt: z.string().datetime(),
});
type TranscriptSegment = z.infer<typeof TranscriptSegment>;

// ユーザーごとのアクセス制御
const TranscriptAccess = z.object({
  id: z.string().uuid(),
  roomId: RoomIdSchema,
  userId: UserIdSchema,
  canView: z.boolean(),
  canExport: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  consentVersion: z.string(),
  createdAt: z.string().datetime(),
});

const FullTranscript = z.object({
  roomId: RoomIdSchema,
  segments: z.array(TranscriptSegment),
  duration: z.number(),
  participantCount: z.number().int(),
  generatedAt: z.string().datetime(),
});

// Sprint 1 再設計: getLiveSubtitles AsyncIterable は廃止 (LiveKit Data Channel 経由で
// client が直接受信、facade 側に AsyncIterable は不要)。代わりに validateLiveDelta を提供。
// searchSegments / exportTranscript (Sprint 2 stub) を追加。
// 詳細は docs/module-contracts.md Section 2.6 参照。
interface TranscriptFacade {
  appendFinalSegment(segment: TranscriptSegment): Promise<Result<true, AppError>>;
  getTranscript(roomId: RoomId, userId: UserId): Promise<ResultOf<typeof FullTranscript>>;
  searchSegments(
    roomId: RoomId,
    userId: UserId,
    query: string,
  ): Promise<Result<TranscriptSegment[], AppError>>;
  deleteAccess(roomId: RoomId, userId: UserId): Promise<Result<true, AppError>>;
  exportTranscript(
    roomId: RoomId,
    userId: UserId,
    format: "pdf" | "txt",
  ): Promise<Result<{ contentBase64: string; mime: string }, AppError>>;
  // LiveKit Data Channel 受信時のバリデーション (mobile 側で使用)
  validateLiveDelta(rawDelta: unknown): Result<z.infer<typeof LiveSubtitleDelta>, AppError>;
}

// =============================================================================
// 11. contact モジュール
// =============================================================================

const ContactEntry = z.object({
  contactId: z.string().uuid(),
  userId: UserIdSchema,
  contactUserId: UserIdSchema,
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().url().nullable(),
  addedAt: z.string().datetime(),
  isFavorite: z.boolean(),
  lastUsedTranslationConfig: TranslationConfig.nullable(),
});

const AddContactCommand = z.object({
  userId: UserIdSchema,
  contactUserId: UserIdSchema,
});

const BlockUserCommand = z.object({
  userId: UserIdSchema,
  blockedUserId: UserIdSchema,
  reason: z.string().optional(),
});

const ReportUserCommand = z.object({
  userId: UserIdSchema,
  reportedUserId: UserIdSchema,
  reason: z.enum(["spam", "harassment", "impersonation", "other"]),
  details: z.string().optional(),
});

// Sprint 1 で unblockUser / toggleFavorite / createInviteLink / consumeInviteLink を追加。
// searchUsers は callerId を受け取り、ブロック相手を結果から除外。
// PublicProfile は contact モジュール内で独自定義 (email を含まない、情報露出最小化)。
// 詳細は docs/module-contracts.md Section 2.4 参照。
interface ContactFacade {
  addContact(cmd: z.infer<typeof AddContactCommand>): Promise<ResultOf<typeof ContactEntry>>;
  removeContact(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  listContacts(userId: UserId): Promise<z.infer<typeof ContactEntry>[]>;
  // PublicProfile は packages/contact/src/schemas.ts で独自 Zod 定義 (UserProfile.email を含めない)
  // 戻り値型は実装側で z.infer<typeof PublicProfileSchema>[] になる
  searchUsers(query: string, callerId: UserId): Promise<unknown[]>; // PublicProfile[] 相当
  blockUser(cmd: z.infer<typeof BlockUserCommand>): Promise<Result<true, AppError>>;
  unblockUser(userId: UserId, blockedUserId: UserId): Promise<Result<true, AppError>>;
  reportUser(cmd: z.infer<typeof ReportUserCommand>): Promise<Result<true, AppError>>;
  toggleFavorite(userId: UserId, contactId: string): Promise<Result<true, AppError>>;
  createInviteLink(
    userId: UserId,
  ): Promise<Result<{ url: string; token: string; expiresAt: string }, AppError>>;
  consumeInviteLink(
    token: string,
    newUserId: UserId,
  ): Promise<Result<z.infer<typeof ContactEntry>, AppError>>;
}

// =============================================================================
// 12. ドメインイベント統合
// =============================================================================

const DomainEvent = z.discriminatedUnion("type", [
  UserRegisteredEvent,
  RoomCreatedEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  TranslationStartedEvent,
  TranslationEndedEvent,
  TranslationDegradedEvent,
  TranslationRecoveredEvent,
]);
type DomainEvent = z.infer<typeof DomainEvent>;

interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent["type"]>(
    eventType: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>,
  ): () => void;
}

// =============================================================================
// 13. Exports
// =============================================================================

export {
  // Brand schemas + helpers
  UserIdSchema, RoomIdSchema, TrackIdSchema, ParticipantIdSchema,
  TranslationSessionIdSchema, LiveKitTrackSidSchema, OpenAISessionIdSchema,
  brandUserId, brandRoomId, brandParticipantId, brandTrackId,
  brandTranslationSessionId, brandLiveKitTrackSid, brandOpenAISessionId,
  // Language
  OutputLanguage, InputLanguage,
  // Common
  DomainEventBase, AppError, validate,
  // Auth
  SignUpCommand, SignInCommand, UserProfile, AuthSession, UserRegisteredEvent,
  // Room
  RoomStatus, ParticipantRole, RoomParticipant, RoomState,
  RoomCreatedEvent, ParticipantJoinedEvent, ParticipantLeftEvent,
  // Media
  AudioFormatConfig, MediaTrackInfo, TrackPermissions,
  // Translation
  TranslationConfig, TranslationUsage,
  TranslationStartedEvent, TranslationEndedEvent,
  TranslationDegradedEvent, TranslationRecoveredEvent,
  // Billing
  PlanTier, PlanConfig, SubscriptionState, UsageWindow, RecordUsageCommand,
  // Notification
  NotificationTarget, IncomingCallNotification, MissedCallPayload,
  // Transcript
  LiveSubtitleDelta, TranscriptSegment, TranscriptAccess, FullTranscript,
  // Contact
  ContactEntry, AddContactCommand, BlockUserCommand, ReportUserCommand,
  // Events
  DomainEvent,
};

export type {
  UserId, RoomId, TrackId, ParticipantId, TranslationSessionId,
  LiveKitTrackSid, OpenAISessionId,
  AudioFrame, TranslatedFrame,
  Result, ResultOk, ResultErr, ResultOf,
  AuthFacade, RoomFacade, TranslationFacade, BillingFacade,
  NotificationFacade, TranscriptFacade, ContactFacade,
  EventBus,
};
