/**
 * 全 Repository の in-memory mock 実装
 *
 * テスト内で DI する唯一のファイル。
 * 型アサーション (as unknown) は最小限の変換にのみ使用。
 */

import { ok, err } from "@trancall/shared-kernel";
import type {
  Result,
  UserId,
  RoomId,
  ParticipantId,
  TranslationSessionId,
} from "@trancall/shared-kernel";

// ---- billing ----
import type { SubscriptionRepository } from "@trancall/billing";
import type { UsageRepository } from "@trancall/billing";
import type { ReservationRepository } from "@trancall/billing";
import type { WebhookEventRepository } from "@trancall/billing";
import type {
  SubscriptionRow,
  PlanTier,
  PurchaseChannel,
  UsageWindow,
  UsageReservation,
  WebhookEvent,
  RecordUsageCommand,
} from "@trancall/billing";
import { PLAN_CONFIGS } from "@trancall/billing";

// ---- auth ----
import type {
  ProfileRepository,
  ConsentRepository,
  LegalDocumentVersionRepository,
} from "@trancall/auth";
import type { Profile } from "@trancall/auth";
import type { ConsentRecord, ConsentScope, LegalDocumentVersion } from "@trancall/shared-kernel";

// ---- billing (extended) ----
import type { ExternalPurchaseTokenRepository } from "@trancall/billing";
import type { ExternalPurchaseTokenRow, PlanTier as BillingPlanTier } from "@trancall/billing";

// ---- contact ----
import type {
  ContactRepository,
  BlockRepository,
  InviteRepository,
  ProfileSearchRepository,
  ReportRepository,
  ContactEntry,
  PublicProfile,
} from "@trancall/contact";

// ---- notification ----
import type { DeviceTokenRepository, PushLogRepository } from "@trancall/notification";

// DeviceTokenRow is internal to @trancall/notification, so we define a compatible local type
interface DeviceTokenRow {
  id: string;
  userId: UserId;
  platform: "ios" | "android";
  token: string;
  bundleId: string | null;
  isActive: boolean;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

// ---- transcript ----
import type { SegmentRepository, AccessRepository } from "@trancall/transcript";
import type { TranscriptSegment, TranscriptAccess } from "@trancall/transcript";

// ---- translation ----
import type {
  TranslationSessionRepository,
  AgentMetricsRepository,
} from "@trancall/translation";
import type { TranslationSessionRecord, AgentMetricsRecord } from "@trancall/translation";

// InviteLink is internal to @trancall/contact, define compatible local type
interface InviteLink {
  id: string;
  userId: UserId;
  token: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// =============================================================================
// Auth — ProfileRepository
// =============================================================================

export function makeProfileRepository(
  initialProfiles: Profile[] = [],
): ProfileRepository {
  const profiles = new Map<string, Profile>();
  for (const p of initialProfiles) {
    profiles.set(p.userId, p);
  }

  return {
    findByUserId: async (userId: UserId): Promise<Result<Profile>> => {
      const p = profiles.get(userId);
      if (p === undefined) {
        return err({ code: "auth.profile.not_found", message: "Profile not found", retryable: false });
      }
      return ok(p);
    },
  };
}

// =============================================================================
// Auth — ConsentRepository (mock)
// =============================================================================

export function makeConsentRepository(): ConsentRepository {
  const records = new Map<string, ConsentRecord>();

  return {
    async upsert(record: Omit<ConsentRecord, "id">): Promise<Result<ConsentRecord>> {
      const id = crypto.randomUUID();
      const full: ConsentRecord = { ...record, id };
      records.set(`${record.userId}:${record.scope}:${record.version}`, full);
      return ok(full);
    },
    async findActive(userId: UserId, scope: ConsentScope): Promise<Result<ConsentRecord | null>> {
      for (const rec of records.values()) {
        if (rec.userId === userId && rec.scope === scope && rec.revokedAt === null) {
          return ok(rec);
        }
      }
      return ok(null);
    },
    async listActive(userId: UserId): Promise<Result<ConsentRecord[]>> {
      const active = [...records.values()].filter(
        (rec) => rec.userId === userId && rec.revokedAt === null,
      );
      return ok(active);
    },
    async revoke(userId: UserId, scope: ConsentScope): Promise<Result<true>> {
      const revokedAt = new Date().toISOString();
      for (const [key, rec] of records.entries()) {
        if (rec.userId === userId && rec.scope === scope) {
          records.set(key, { ...rec, revokedAt });
        }
      }
      return ok(true);
    },
  };
}

// =============================================================================
// Auth — LegalDocumentVersionRepository (mock)
// =============================================================================

export function makeLegalDocVersionRepository(): LegalDocumentVersionRepository {
  return {
    async findLatest(_scope: ConsentScope): Promise<Result<LegalDocumentVersion>> {
      return err({ code: "AUTH_LEGAL_DOC_UNAVAILABLE", message: "mock: not implemented", retryable: false });
    },
    async findAllLatest(): Promise<Result<LegalDocumentVersion[]>> {
      return ok([]);
    },
  };
}

// =============================================================================
// Billing — ExternalPurchaseTokenRepository (mock)
// =============================================================================

export function makeExternalPurchaseTokenRepository(): ExternalPurchaseTokenRepository {
  const tokens = new Map<string, ExternalPurchaseTokenRow>();

  return {
    async createToken(
      userId: UserId,
      targetTier: BillingPlanTier,
      stripeSessionId: string,
      token: string,
      ttlMinutes: number,
    ): Promise<Result<ExternalPurchaseTokenRow>> {
      const row: ExternalPurchaseTokenRow = {
        id: crypto.randomUUID(),
        userId,
        token,
        targetTier,
        stripeSessionId,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      };
      tokens.set(token, row);
      return ok(row);
    },
    async findByToken(token: string): Promise<Result<ExternalPurchaseTokenRow>> {
      const row = tokens.get(token);
      if (row === undefined) {
        return err({
          code: "NOT_FOUND",
          message: `redirectToken が見つかりません: ${token.slice(0, 8)}...`,
          retryable: false,
        });
      }
      return ok(row);
    },
    async markUsed(token: string): Promise<Result<true>> {
      const row = tokens.get(token);
      // 二重消費防止: used=false の行のみ更新。存在しない or 使用済みはエラー。
      if (row === undefined || row.used) {
        return err({
          code: "BILLING_PAYMENT_FAILED",
          message:
            "redirectToken は既に使用済みか存在しません。二重消費を防止しました。",
          retryable: false,
        });
      }
      tokens.set(token, { ...row, used: true });
      return ok(true);
    },
    async cleanupExpired(): Promise<Result<number>> {
      const now = new Date();
      let count = 0;
      for (const [token, row] of tokens.entries()) {
        if (!row.used && new Date(row.expiresAt) < now) {
          tokens.delete(token);
          count++;
        }
      }
      return ok(count);
    },
  };
}

// =============================================================================
// Billing — SubscriptionRepository
// =============================================================================

function makeDefaultSubscriptionRow(userId: string, tier: PlanTier): SubscriptionRow {
  const plan = PLAN_CONFIGS[tier];
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + 30);
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    plan_tier: tier,
    included_minutes: plan.includedMinutes,
    overage_rate_yen: plan.overageRateYen,
    monthly_price_yen: plan.monthlyPriceYen,
    transcript_retention_days: plan.transcriptRetentionDays,
    cancel_at_period_end: false,
    purchase_channel: (tier === "free" ? "free" : "stripe_web") as PurchaseChannel,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    iap_original_transaction_id: null,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

export interface InMemorySubscriptionRepo extends SubscriptionRepository {
  _setRow(row: SubscriptionRow): void;
  _addUsedSeconds(userId: string, seconds: number): void;
}

export function makeSubscriptionRepository(
  initialRows: SubscriptionRow[] = [],
): InMemorySubscriptionRepo {
  const rows = new Map<string, SubscriptionRow>();
  const usedSecondsMap = new Map<string, number>();

  for (const row of initialRows) {
    rows.set(row.user_id, row);
  }

  return {
    _setRow(row: SubscriptionRow): void {
      rows.set(row.user_id, row);
    },
    _addUsedSeconds(userId: string, seconds: number): void {
      const prev = usedSecondsMap.get(userId) ?? 0;
      usedSecondsMap.set(userId, prev + seconds);
    },

    findByUserId: async (userId: UserId): Promise<Result<SubscriptionRow>> => {
      const row = rows.get(userId);
      if (row === undefined) {
        return err({ code: "NOT_FOUND", message: "Subscription not found", retryable: false });
      }
      return ok(row);
    },

    upsert: async (userId: UserId, data: Partial<Omit<SubscriptionRow, "id" | "user_id" | "created_at">>): Promise<Result<SubscriptionRow>> => {
      const existing = rows.get(userId);
      const now = new Date().toISOString();
      if (existing !== undefined) {
        const updated: SubscriptionRow = { ...existing, ...data, updated_at: now };
        rows.set(userId, updated);
        return ok(updated);
      }
      const newRow: SubscriptionRow = {
        id: crypto.randomUUID(),
        user_id: userId,
        plan_tier: "free",
        included_minutes: 5,
        overage_rate_yen: 0,
        monthly_price_yen: 0,
        transcript_retention_days: 7,
        cancel_at_period_end: false,
        purchase_channel: "free",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        iap_original_transaction_id: null,
        current_period_start: now,
        current_period_end: now,
        created_at: now,
        updated_at: now,
        ...data,
      };
      rows.set(userId, newRow);
      return ok(newRow);
    },

    updatePlan: async (userId: UserId, params): Promise<Result<SubscriptionRow>> => {
      const existing = rows.get(userId) ?? makeDefaultSubscriptionRow(userId, "free");
      const updated: SubscriptionRow = {
        ...existing,
        plan_tier: params.planTier,
        purchase_channel: params.purchaseChannel,
        stripe_subscription_id: params.stripeSubscriptionId ?? existing.stripe_subscription_id,
        stripe_customer_id: params.stripeCustomerId ?? existing.stripe_customer_id,
        iap_original_transaction_id: params.iapOriginalTransactionId ?? existing.iap_original_transaction_id,
        current_period_start: params.currentPeriodStart ?? existing.current_period_start,
        current_period_end: params.currentPeriodEnd ?? existing.current_period_end,
        cancel_at_period_end: params.cancelAtPeriodEnd ?? existing.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      };
      rows.set(userId, updated);
      return ok(updated);
    },

    getUsedSecondsInPeriod: async (userId: UserId, _periodStart: string, _periodEnd: string): Promise<Result<number>> => {
      const s = usedSecondsMap.get(userId) ?? 0;
      return ok(s);
    },
  };
}

// =============================================================================
// Billing — UsageRepository
// =============================================================================

export interface InMemoryUsageRepo extends UsageRepository {
  _getWindows(): UsageWindow[];
}

export function makeUsageRepository(): InMemoryUsageRepo {
  const windows: UsageWindow[] = [];
  const idempotencyKeys = new Set<string>();

  return {
    _getWindows(): UsageWindow[] {
      return windows;
    },

    insertWindowIdempotent: async (cmd: RecordUsageCommand, amountYen: number): Promise<Result<UsageWindow>> => {
      if (idempotencyKeys.has(cmd.idempotencyKey)) {
        // 冪等: 既存 window を返す
        const existing = windows.find((w) => w.idempotencyKey === cmd.idempotencyKey);
        if (existing !== undefined) {
          return ok(existing);
        }
      }
      idempotencyKeys.add(cmd.idempotencyKey);
      const window: UsageWindow = {
        id: crypto.randomUUID(),
        userId: cmd.userId,
        sessionId: cmd.sessionId,
        roomId: cmd.roomId,
        windowStart: cmd.windowStart,
        windowEnd: cmd.windowEnd,
        durationSeconds: cmd.durationSeconds,
        languagePair: cmd.languagePair,
        amountYen,
        idempotencyKey: cmd.idempotencyKey,
        recordedAt: new Date().toISOString(),
      };
      windows.push(window);
      return ok(window);
    },

    findBySessionId: async (sessionId: TranslationSessionId): Promise<Result<UsageWindow[]>> => {
      const found = windows.filter((w) => w.sessionId === sessionId);
      return ok(found);
    },

    sumDurationSecondsInPeriod: async (userId: UserId, _periodStart: string, _periodEnd: string): Promise<Result<number>> => {
      const sum = windows
        .filter((w) => w.userId === userId)
        .reduce((acc, w) => acc + w.durationSeconds, 0);
      return ok(sum);
    },
  };
}

// =============================================================================
// Billing — ReservationRepository
// =============================================================================

export function makeReservationRepository(): ReservationRepository {
  const reservations: UsageReservation[] = [];

  return {
    create: async (userId: UserId, sessionId: TranslationSessionId, reservedMinutes: number): Promise<Result<UsageReservation>> => {
      const now = new Date().toISOString();
      const reservation: UsageReservation = {
        id: crypto.randomUUID(),
        userId,
        sessionId,
        reservedMinutes,
        consumedMinutes: 0,
        status: "active",
        createdAt: now,
        reconciledAt: null,
      };
      reservations.push(reservation);
      return ok(reservation);
    },

    findActiveBySessionId: async (sessionId: TranslationSessionId): Promise<Result<UsageReservation | null>> => {
      const found = reservations.find((r) => r.sessionId === sessionId && r.status === "active");
      return ok(found ?? null);
    },

    reconcile: async (sessionId: TranslationSessionId, consumedMinutes: number): Promise<Result<UsageReservation>> => {
      const idx = reservations.findIndex((r) => r.sessionId === sessionId && r.status === "active");
      if (idx === -1) {
        return err({ code: "NOT_FOUND", message: "Reservation not found", retryable: false });
      }
      const existing = reservations[idx];
      if (existing === undefined) {
        return err({ code: "NOT_FOUND", message: "Reservation not found", retryable: false });
      }
      const updated: UsageReservation = {
        ...existing,
        status: "reconciled",
        consumedMinutes,
        reconciledAt: new Date().toISOString(),
      };
      reservations[idx] = updated;
      return ok(updated);
    },

    expire: async (sessionId: TranslationSessionId): Promise<Result<UsageReservation | null>> => {
      const idx = reservations.findIndex((r) => r.sessionId === sessionId && r.status === "active");
      if (idx === -1) {
        return ok(null);
      }
      const existing = reservations[idx];
      if (existing === undefined) {
        return ok(null);
      }
      const updated: UsageReservation = { ...existing, status: "expired" };
      reservations[idx] = updated;
      return ok(updated);
    },
  };
}

// =============================================================================
// Billing — WebhookEventRepository
// =============================================================================

export function makeWebhookEventRepository(): WebhookEventRepository {
  const events: WebhookEvent[] = [];

  return {
    insertIdempotent: async (params): Promise<Result<{ event: WebhookEvent; isNew: boolean }>> => {
      const existing = events.find(
        (e) => e.provider === params.provider && e.externalEventId === params.externalEventId,
      );
      if (existing !== undefined) {
        return ok({ event: existing, isNew: false });
      }
      const now = new Date().toISOString();
      const event: WebhookEvent = {
        id: crypto.randomUUID(),
        provider: params.provider,
        externalEventId: params.externalEventId,
        eventType: params.eventType,
        payload: params.payload,
        processedAt: null,
        processingError: null,
        receivedAt: now,
      };
      events.push(event);
      return ok({ event, isNew: true });
    },

    markProcessed: async (id: string): Promise<Result<void>> => {
      const idx = events.findIndex((e) => e.id === id);
      if (idx !== -1) {
        const existing = events[idx];
        if (existing !== undefined) {
          events[idx] = { ...existing, processedAt: new Date().toISOString() };
        }
      }
      return ok(undefined);
    },

    markFailed: async (id: string, error: string): Promise<Result<void>> => {
      const idx = events.findIndex((e) => e.id === id);
      if (idx !== -1) {
        const existing = events[idx];
        if (existing !== undefined) {
          events[idx] = { ...existing, processingError: error };
        }
      }
      return ok(undefined);
    },
  };
}

// =============================================================================
// Contact — ContactRepository
// =============================================================================

export function makeContactRepository(): ContactRepository {
  const entries: ContactEntry[] = [];

  return {
    add: async (userId: UserId, contactUserId: UserId): Promise<Result<ContactEntry>> => {
      const now = new Date().toISOString();
      const entry: ContactEntry = {
        contactId: crypto.randomUUID(),
        userId,
        contactUserId,
        displayName: `User-${contactUserId.slice(0, 8)}`,
        nativeLanguage: "en",
        avatarUrl: null,
        addedAt: now,
        isFavorite: false,
        trancallId: `user_${contactUserId.slice(0, 8)}`,
      };
      entries.push(entry);
      return ok(entry);
    },

    remove: async (_userId: UserId, contactId: string): Promise<Result<true>> => {
      const idx = entries.findIndex((e) => e.contactId === contactId);
      if (idx !== -1) {
        entries.splice(idx, 1);
      }
      return ok(true);
    },

    list: async (userId: UserId): Promise<ContactEntry[]> => {
      return entries.filter((e) => e.userId === userId);
    },

    exists: async (userId: UserId, contactUserId: UserId): Promise<boolean> => {
      return entries.some((e) => e.userId === userId && e.contactUserId === contactUserId);
    },

    toggleFavorite: async (_userId: UserId, contactId: string): Promise<Result<true>> => {
      const idx = entries.findIndex((e) => e.contactId === contactId);
      if (idx === -1) {
        return err({ code: "CONTACT_NOT_FOUND", message: "Contact not found", retryable: false });
      }
      const existing = entries[idx];
      if (existing !== undefined) {
        entries[idx] = { ...existing, isFavorite: !existing.isFavorite };
      }
      return ok(true);
    },
  };
}

// =============================================================================
// Contact — BlockRepository
// =============================================================================

export interface InMemoryBlockRepo extends BlockRepository {
  _isBlockedBy(userId: string, targetId: string): boolean;
}

export function makeBlockRepository(): InMemoryBlockRepo {
  // Set of "blockerId|blockedId"
  const blocks = new Set<string>();

  const key = (a: string, b: string) => `${a}|${b}`;

  return {
    _isBlockedBy(userId: string, targetId: string): boolean {
      return blocks.has(key(userId, targetId));
    },

    block: async (userId: UserId, blockedUserId: UserId, _reason?: string): Promise<Result<true>> => {
      blocks.add(key(userId, blockedUserId));
      return ok(true);
    },

    unblock: async (userId: UserId, blockedUserId: UserId): Promise<Result<true>> => {
      blocks.delete(key(userId, blockedUserId));
      return ok(true);
    },

    isBlocked: async (userId: UserId, targetUserId: UserId): Promise<boolean> => {
      return blocks.has(key(userId, targetUserId)) || blocks.has(key(targetUserId, userId));
    },

    getBlockedUserIds: async (userId: UserId): Promise<Set<string>> => {
      const result = new Set<string>();
      for (const k of blocks) {
        const [blockerId, blockedId] = k.split("|");
        if (blockerId === userId && blockedId !== undefined) {
          result.add(blockedId);
        }
        // 双方向: 相手がブロックしている場合も除外
        if (blockedId === userId && blockerId !== undefined) {
          result.add(blockerId);
        }
      }
      return result;
    },
  };
}

// =============================================================================
// Contact — ProfileSearchRepository
// =============================================================================

export function makeProfileSearchRepository(
  profiles: PublicProfile[] = [],
): ProfileSearchRepository {
  return {
    findByTrancallId: async (trancallId: string): Promise<PublicProfile | null> => {
      return profiles.find((p) => p.trancallId === trancallId) ?? null;
    },

    searchByDisplayName: async (query: string, _limit?: number): Promise<PublicProfile[]> => {
      const q = query.toLowerCase();
      return profiles.filter((p) => p.displayName.toLowerCase().includes(q));
    },
  };
}

// =============================================================================
// Contact — InviteRepository
// =============================================================================

export function makeInviteRepository(): InviteRepository {
  const invites: InviteLink[] = [];

  return {
    create: async (userId: UserId, token: string, expiresAt: Date): Promise<Result<InviteLink>> => {
      const invite: InviteLink = {
        id: crypto.randomUUID(),
        userId,
        token,
        expiresAt: expiresAt.toISOString(),
        usedBy: null,
        usedAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      invites.push(invite);
      return ok(invite);
    },

    findByToken: async (token: string): Promise<InviteLink | null> => {
      return invites.find((i) => i.token === token) ?? null;
    },

    markUsed: async (token: string, usedBy: UserId): Promise<Result<true>> => {
      const idx = invites.findIndex((i) => i.token === token);
      if (idx !== -1) {
        const existing = invites[idx];
        if (existing !== undefined) {
          invites[idx] = { ...existing, usedBy, usedAt: new Date().toISOString() };
        }
      }
      return ok(true);
    },
  };
}

// =============================================================================
// Contact — ReportRepository (stub)
// =============================================================================

export function makeReportRepository(): ReportRepository {
  return {
    create: async (_cmd): Promise<Result<true>> => {
      return ok(true);
    },
    exists: async (_reporterId: UserId, _reportedId: UserId): Promise<boolean> => {
      return false;
    },
  };
}

// =============================================================================
// Notification — DeviceTokenRepository
// =============================================================================

export function makeDeviceTokenRepository(): DeviceTokenRepository {
  const tokens: DeviceTokenRow[] = [];

  return {
    upsert: async (userId: UserId, target): Promise<Result<DeviceTokenRow>> => {
      const platform = target.platform;
      const token = platform === "ios" ? target.voipToken : target.fcmToken;
      const existing = tokens.find((t) => t.platform === platform && t.token === token);
      if (existing !== undefined) {
        return ok(existing);
      }
      const now = new Date().toISOString();
      const row: DeviceTokenRow = {
        id: crypto.randomUUID(),
        userId,
        platform,
        token,
        bundleId: platform === "ios" ? target.bundleId : null,
        isActive: true,
        lastSeenAt: now,
        revokedAt: null,
        createdAt: now,
      };
      tokens.push(row);
      return ok(row);
    },

    findActiveByUserId: async (userId: UserId, platform?: "ios" | "android"): Promise<Result<DeviceTokenRow[]>> => {
      const found = tokens.filter(
        (t) => t.userId === userId && t.isActive && (platform === undefined || t.platform === platform),
      );
      return ok(found);
    },

    revoke: async (platform: "ios" | "android", token: string): Promise<Result<true>> => {
      const idx = tokens.findIndex((t) => t.platform === platform && t.token === token);
      if (idx !== -1) {
        const existing = tokens[idx];
        if (existing !== undefined) {
          tokens[idx] = { ...existing, isActive: false, revokedAt: new Date().toISOString() };
        }
      }
      return ok(true);
    },

    delete: async (userId: UserId, platform: "ios" | "android", token: string): Promise<Result<true>> => {
      const idx = tokens.findIndex((t) => t.userId === userId && t.platform === platform && t.token === token);
      if (idx !== -1) {
        tokens.splice(idx, 1);
      }
      return ok(true);
    },
  };
}

// =============================================================================
// Notification — PushLogRepository (stub)
// =============================================================================

export function makePushLogRepository(): PushLogRepository {
  return {
    write: async (_log): Promise<Result<true>> => {
      return ok(true);
    },
  };
}

// =============================================================================
// Transcript — SegmentRepository
// =============================================================================

export interface InMemorySegmentRepo extends SegmentRepository {
  _getAll(): TranscriptSegment[];
}

export function makeSegmentRepository(): InMemorySegmentRepo {
  const segments: TranscriptSegment[] = [];

  return {
    _getAll(): TranscriptSegment[] {
      return segments;
    },

    upsert: async (segment: TranscriptSegment): Promise<Result<true>> => {
      // UNIQUE(room_id, participant_id, sequence_no) 冪等
      const exists = segments.some(
        (s) =>
          s.roomId === segment.roomId &&
          s.participantId === segment.participantId &&
          s.sequenceNo === segment.sequenceNo,
      );
      if (!exists) {
        segments.push(segment);
      }
      return ok(true);
    },

    findByRoomId: async (roomId: RoomId): Promise<Result<TranscriptSegment[]>> => {
      const found = segments
        .filter((s) => s.roomId === roomId)
        .sort((a, b) => a.startTimeMs - b.startTimeMs);
      return ok(found);
    },

    getNextSequenceNo: async (roomId: RoomId, participantId: ParticipantId): Promise<Result<number>> => {
      const matching = segments.filter(
        (s) => s.roomId === roomId && s.participantId === participantId,
      );
      if (matching.length === 0) return ok(0);
      const maxSeq = Math.max(...matching.map((s) => s.sequenceNo));
      return ok(maxSeq + 1);
    },

    searchByFts: async (roomId: RoomId, query: string): Promise<Result<TranscriptSegment[]>> => {
      const q = query.toLowerCase();
      const found = segments.filter(
        (s) => s.roomId === roomId && s.originalText.toLowerCase().includes(q),
      );
      return ok(found);
    },
  };
}

// =============================================================================
// Transcript — AccessRepository
// =============================================================================

export interface InMemoryAccessRepo extends AccessRepository {
  _grantAccess(roomId: string, userId: string): void;
}

export function makeAccessRepository(): InMemoryAccessRepo {
  const accesses: TranscriptAccess[] = [];

  return {
    _grantAccess(roomId: string, userId: string): void {
      const now = new Date().toISOString();
      accesses.push({
        id: crypto.randomUUID(),
        roomId: roomId as RoomId,
        userId: userId as UserId,
        canView: true,
        canExport: true,
        deletedAt: null,
        consentVersion: "v1",
        createdAt: now,
      });
    },

    canView: async (roomId: RoomId, userId: UserId): Promise<Result<boolean>> => {
      const access = accesses.find(
        (a) => a.roomId === roomId && a.userId === userId && a.deletedAt === null && a.canView,
      );
      return ok(access !== undefined);
    },

    softDelete: async (roomId: RoomId, userId: UserId): Promise<Result<true>> => {
      const idx = accesses.findIndex(
        (a) => a.roomId === roomId && a.userId === userId && a.deletedAt === null,
      );
      if (idx !== -1) {
        const existing = accesses[idx];
        if (existing !== undefined) {
          accesses[idx] = { ...existing, deletedAt: new Date().toISOString() };
        }
      }
      return ok(true);
    },

    findOne: async (roomId: RoomId, userId: UserId): Promise<Result<TranscriptAccess>> => {
      const found = accesses.find((a) => a.roomId === roomId && a.userId === userId);
      if (found === undefined) {
        return err({ code: "NOT_FOUND", message: "Access not found", retryable: false });
      }
      return ok(found);
    },
  };
}

// =============================================================================
// Translation — TranslationSessionRepository
// =============================================================================

export interface InMemoryTranslationSessionRepo extends TranslationSessionRepository {
  _getAll(): TranslationSessionRecord[];
}

export function makeTranslationSessionRepository(): InMemoryTranslationSessionRepo {
  const sessions: TranslationSessionRecord[] = [];

  return {
    _getAll(): TranslationSessionRecord[] {
      return sessions;
    },

    insert: async (record): Promise<Result<TranslationSessionRecord>> => {
      // agentJobId で冪等化
      const existing = sessions.find((s) => s.agentJobId === record.agentJobId);
      if (existing !== undefined) {
        return ok(existing);
      }
      const full: TranslationSessionRecord = {
        ...record,
        createdAt: new Date().toISOString(),
      };
      sessions.push(full);
      return ok(full);
    },

    updateEnded: async (agentJobId, update): Promise<Result<TranslationSessionRecord>> => {
      const idx = sessions.findIndex((s) => s.agentJobId === agentJobId);
      if (idx === -1) {
        return err({ code: "NOT_FOUND", message: "Session not found", retryable: false });
      }
      const existing = sessions[idx];
      if (existing === undefined) {
        return err({ code: "NOT_FOUND", message: "Session not found", retryable: false });
      }
      const updated: TranslationSessionRecord = { ...existing, ...update };
      sessions[idx] = updated;
      return ok(updated);
    },

    findByAgentJobId: async (agentJobId): Promise<Result<TranslationSessionRecord | null>> => {
      const found = sessions.find((s) => s.agentJobId === agentJobId);
      return ok(found ?? null);
    },
  };
}

// =============================================================================
// Translation — AgentMetricsRepository (stub)
// =============================================================================

export function makeAgentMetricsRepository(): AgentMetricsRepository {
  return {
    insert: async (record): Promise<Result<AgentMetricsRecord>> => {
      const full: AgentMetricsRecord = {
        ...record,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      return ok(full);
    },
  };
}
