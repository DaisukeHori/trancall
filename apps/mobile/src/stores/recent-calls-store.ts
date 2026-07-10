/**
 * recent-calls-store — Zustand store for call history
 *
 * Sprint 3 T-20: server history endpoint 結合
 * GET /api/rooms/history (cursor pagination) を使い RoomHistoryEntry[] を管理する。
 *
 * docs/api-spec.md §GET /api/rooms/history 準拠
 */
import { create } from "zustand";
import { getRoomHistory } from "../api/room-api";
import type { RoomHistoryEntry } from "../api/room-api";
import { useAuthStore } from "./auth-store";

// Re-export RoomHistoryEntry so consumers can import from this module
export type { RoomHistoryEntry };

// ---------------------------------------------------------------------------
// Legacy type kept for backward compat (call-summary-screen / call-store etc.)
// ---------------------------------------------------------------------------
export type CallDirection = "inbound" | "outbound";

export interface RecentCallEntry {
  id: string;
  contactUserId: string;
  contactDisplayName: string;
  contactTrancallId: string;
  contactAvatarUrl?: string;
  direction: CallDirection;
  durationSeconds: number;
  costYen: number;
  missed: boolean;
  translationEnabled: boolean;
  fromLanguage?: string;
  toLanguage?: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

export interface RecentCallsState {
  /** server から取得した通話履歴 (newest-first) */
  recentCalls: RecentCallEntry[];
  /** cursor pagination: 次ページの before パラメータ値 (null = 全取得済) */
  nextCursor: string | null;
  isLoading: boolean;
  /** loadMore 中フラグ (FlatList の onEndReached が重複起動しないように) */
  isLoadingMore: boolean;
  error: string | null;

  /** 初回ロード: 既存データを破棄してページ 1 を取得 */
  refresh: () => Promise<void>;
  /** 追加ロード: nextCursor を使って次ページを取得 */
  loadMore: () => Promise<void>;
  /** 後方互換: refresh の alias */
  load: () => Promise<void>;
  /** 通話終了直後にローカル先行挿入 */
  addCall: (entry: RecentCallEntry) => void;
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Helper: RoomHistoryEntry → RecentCallEntry
//
// server の RoomHistoryEntry は participants 配列で相手方を表現する。
// isHost=false の最初の参加者を "contact" として扱う。
// myRole が "host" の場合は outbound、"member" の場合は inbound と判断する。
// ---------------------------------------------------------------------------
function toRecentCallEntry(entry: RoomHistoryEntry): RecentCallEntry {
  const nonHostParticipant = entry.participants.find((p) => !p.isHost);
  const contact = nonHostParticipant ?? entry.participants[0];

  return {
    id: entry.roomId,
    contactUserId: contact?.userId ?? "",
    contactDisplayName: contact?.displayName ?? "",
    contactTrancallId: contact?.trancallId ?? "",
    contactAvatarUrl: contact?.avatarUrl ?? undefined,
    direction: entry.myRole === "host" ? "outbound" : "inbound",
    durationSeconds: entry.durationSeconds,
    costYen: entry.costYen,
    missed: entry.durationSeconds === 0,
    translationEnabled: entry.translationEnabled,
    startedAt: entry.startedAt,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 20;

export const useRecentCallsStore = create<RecentCallsState>()((set, get) => ({
  recentCalls: [],
  nextCursor: null,
  isLoading: false,
  isLoadingMore: false,
  error: null,

  refresh: async () => {
    const session = useAuthStore.getState().session;
    if (session == null) {
      set({ recentCalls: [], nextCursor: null, isLoading: false, error: null });
      return;
    }

    set({ isLoading: true, error: null });

    const result = await getRoomHistory({ limit: PAGE_LIMIT }, session.accessToken);

    if (!result.ok) {
      set({ isLoading: false, error: result.error.message });
      return;
    }

    const entries = result.data.rooms.map(toRecentCallEntry);
    set({
      recentCalls: entries,
      nextCursor: result.data.nextCursor,
      isLoading: false,
      error: null,
    });
  },

  loadMore: async () => {
    const { nextCursor, isLoadingMore, isLoading } = get();
    if (nextCursor == null || isLoadingMore || isLoading) return;

    const session = useAuthStore.getState().session;
    if (session == null) return;

    set({ isLoadingMore: true });

    const result = await getRoomHistory(
      { limit: PAGE_LIMIT, before: nextCursor },
      session.accessToken,
    );

    if (!result.ok) {
      set({ isLoadingMore: false, error: result.error.message });
      return;
    }

    const newEntries = result.data.rooms.map(toRecentCallEntry);
    set((state) => ({
      recentCalls: [...state.recentCalls, ...newEntries],
      nextCursor: result.data.nextCursor,
      isLoadingMore: false,
      error: null,
    }));
  },

  load: async () => {
    return get().refresh();
  },

  addCall: (entry: RecentCallEntry) => {
    set((state) => ({
      recentCalls: [entry, ...state.recentCalls].slice(0, 100),
    }));
  },

  clearAll: () => {
    set({ recentCalls: [], nextCursor: null, error: null });
  },
}));
