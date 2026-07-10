/**
 * Transcript Store — Zustand
 *
 * Manages transcript cache, search state, and filter for SCR-012.
 */

import { create } from "zustand";
import type { Result } from "@trancall/shared-kernel";
import {
  getTranscript,
  exportTranscript,
  deleteAccess,
  type FullTranscript,
  type TranscriptSegment,
  type ExportFormat,
  type ExportResult,
} from "../api/transcript-api";

export type TranscriptFilter = "all" | "self" | "other";

export interface TranscriptState {
  // Cache: roomId -> FullTranscript
  transcripts: Map<string, FullTranscript>;
  // Currently viewed room
  currentRoomId: string | null;
  // Search & filter
  searchQuery: string;
  filter: TranscriptFilter;
  // Loading/error state
  isLoading: boolean;
  error: string | null;
  // Access revoked rooms
  revokedRooms: Set<string>;

  // Actions
  load: (roomId: string, accessToken: string) => Promise<Result<FullTranscript>>;
  search: (query: string) => void;
  setFilter: (filter: TranscriptFilter) => void;
  setCurrentRoom: (roomId: string | null) => void;
  export: (roomId: string, format: ExportFormat, accessToken: string) => Promise<Result<ExportResult>>;
  clearAccess: (roomId: string, accessToken: string) => Promise<Result<true>>;
  getFilteredSegments: (roomId: string, selfParticipantId?: string) => TranscriptSegment[];
}

export const useTranscriptStore = create<TranscriptState>()((set, get) => ({
  transcripts: new Map(),
  currentRoomId: null,
  searchQuery: "",
  filter: "all",
  isLoading: false,
  error: null,
  revokedRooms: new Set(),

  load: async (roomId: string, accessToken: string): Promise<Result<FullTranscript>> => {
    set({ isLoading: true, error: null });

    const result = await getTranscript(roomId, accessToken);

    if (!result.ok) {
      set({ isLoading: false, error: result.error.message });
      return result;
    }

    set((state) => {
      const updated = new Map(state.transcripts);
      updated.set(roomId, result.data);
      return {
        transcripts: updated,
        currentRoomId: roomId,
        isLoading: false,
        error: null,
      };
    });

    return result;
  },

  search: (query: string) => {
    set({ searchQuery: query });
  },

  setFilter: (filter: TranscriptFilter) => {
    set({ filter });
  },

  setCurrentRoom: (roomId: string | null) => {
    set({ currentRoomId: roomId });
  },

  export: async (
    roomId: string,
    format: ExportFormat,
    accessToken: string,
  ): Promise<Result<ExportResult>> => {
    set({ isLoading: true, error: null });

    const result = await exportTranscript(roomId, format, accessToken);

    set({ isLoading: false });

    if (!result.ok) {
      set({ error: result.error.message });
    }

    return result;
  },

  clearAccess: async (
    roomId: string,
    accessToken: string,
  ): Promise<Result<true>> => {
    const result = await deleteAccess(roomId, accessToken);

    if (result.ok) {
      set((state) => {
        const revoked = new Set(state.revokedRooms);
        revoked.add(roomId);
        const updated = new Map(state.transcripts);
        updated.delete(roomId);
        return { revokedRooms: revoked, transcripts: updated };
      });
    }

    return result;
  },

  getFilteredSegments: (roomId: string, selfParticipantId?: string): TranscriptSegment[] => {
    const state = get();
    const transcript = state.transcripts.get(roomId);
    if (transcript == null) return [];

    let segments = transcript.segments;

    // Apply search filter
    const query = state.searchQuery.trim().toLowerCase();
    if (query.length > 0) {
      segments = segments.filter(
        (seg) =>
          seg.originalText.toLowerCase().includes(query) ||
          (seg.translatedText != null && seg.translatedText.toLowerCase().includes(query)),
      );
    }

    // Apply speaker filter
    if (state.filter !== "all" && selfParticipantId != null) {
      const isSelf = state.filter === "self";
      segments = segments.filter((seg) =>
        isSelf
          ? seg.participantId === selfParticipantId
          : seg.participantId !== selfParticipantId,
      );
    }

    return segments;
  },
}));

// Selectors
export const selectCurrentTranscript = (state: TranscriptState): FullTranscript | null => {
  if (state.currentRoomId == null) return null;
  return state.transcripts.get(state.currentRoomId) ?? null;
};

export const selectIsAccessRevoked = (roomId: string) =>
  (state: TranscriptState): boolean =>
    state.revokedRooms.has(roomId);
