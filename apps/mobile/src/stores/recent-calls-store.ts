import { create } from "zustand";

// TODO Phase 2: server history endpoint 実装後に置換
// GET /api/rooms/history は未実装 (api-spec.md Phase 2 予定)
// 現在は空状態表示 + in-memory のみ対応

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

export interface RecentCallsState {
  recentCalls: RecentCallEntry[];
  isLoading: boolean;

  // Phase 2: load from server. Returns Promise<void> for consistent async interface.
  load: () => Promise<void>;
  // Add a call entry (called after a call ends, locally)
  addCall: (entry: RecentCallEntry) => void;
  clearAll: () => void;
}

export const useRecentCallsStore = create<RecentCallsState>()((set) => ({
  recentCalls: [],
  isLoading: false,

  load: () => {
    // TODO Phase 2: fetch from GET /api/rooms/history
    // For now, keep in-memory state only
    set({ isLoading: false });
    return Promise.resolve();
  },

  addCall: (entry: RecentCallEntry) => {
    set((state) => ({
      recentCalls: [entry, ...state.recentCalls].slice(0, 100),
    }));
  },

  clearAll: () => {
    set({ recentCalls: [] });
  },
}));
