/**
 * call-store — Zustand store for call lifecycle state machine
 *
 * States: idle → calling → ringing → active → ended
 */
import { create } from "zustand";
import type { Result } from "@trancall/shared-kernel";

// --- Types ---

export type CallState = "idle" | "calling" | "ringing" | "active" | "ended";
export type TranslationStatus = "idle" | "translating" | "reconnecting" | "stopped";

export interface ParticipantInfo {
  userId: string;
  displayName?: string;
  nativeLanguage?: string;
}

export interface SubtitleSegment {
  id: string;
  side: "me" | "peer";
  original: string;
  translated?: string;
  isFinal: boolean;
}

export interface Subtitles {
  partial: string | null;
  final: SubtitleSegment[];
}

export interface CallStoreState {
  // State machine
  state: CallState;
  roomId: string | null;
  sessionId: string | null;
  participants: ParticipantInfo[];
  calleeName: string;
  calleeLanguage: string;

  // Translation
  translationEnabled: boolean;
  translationStatus: TranslationStatus;
  subtitles: Subtitles;

  // Audio controls
  isMuted: boolean;
  isSpeakerOn: boolean;
  isSubtitlesEnabled: boolean;

  // Timing
  callDurationMs: number;
  callStartedAt: number | null;

  // Error
  lastError: string | null;

  // Actions
  startCall: (calleeId: string, calleeName: string, calleeLanguage: string) => void;
  setRoomId: (roomId: string) => void;
  setSessionId: (sessionId: string) => void;
  acceptIncoming: (roomId: string) => void;
  declineIncoming: () => void;
  setActive: () => void;
  endCall: () => void;
  resetToIdle: () => void;

  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleTranslation: () => void;
  toggleSubtitles: () => void;

  setTranslationStatus: (status: TranslationStatus) => void;
  setPartialSubtitle: (text: string | null) => void;
  appendFinalSubtitle: (segment: SubtitleSegment) => void;

  addParticipant: (participant: ParticipantInfo) => void;
  tickDuration: (nowMs: number) => void;

  setError: (error: string | null) => void;
}

// --- Selectors ---

export const selectCallState = (s: CallStoreState): CallState => s.state;
export const selectIsActive = (s: CallStoreState): boolean => s.state === "active";
export const selectTranslationEnabled = (s: CallStoreState): boolean => s.translationEnabled;
export const selectTranslationStatus = (s: CallStoreState): TranslationStatus => s.translationStatus;
export const selectSubtitles = (s: CallStoreState): Subtitles => s.subtitles;
export const selectCallDurationMs = (s: CallStoreState): number => s.callDurationMs;

// --- Initial state factory ---

interface InitialState {
  state: CallState;
  roomId: null;
  sessionId: null;
  participants: ParticipantInfo[];
  calleeName: string;
  calleeLanguage: string;
  translationEnabled: boolean;
  translationStatus: TranslationStatus;
  subtitles: Subtitles;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isSubtitlesEnabled: boolean;
  callDurationMs: number;
  callStartedAt: null;
  lastError: null;
}

function makeInitial(): InitialState {
  return {
    state: "idle",
    roomId: null,
    sessionId: null,
    participants: [],
    calleeName: "",
    calleeLanguage: "",

    translationEnabled: true,
    translationStatus: "idle",
    subtitles: { partial: null, final: [] },

    isMuted: false,
    isSpeakerOn: true,
    isSubtitlesEnabled: true,

    callDurationMs: 0,
    callStartedAt: null,

    lastError: null,
  };
}

// --- Store ---

export const useCallStore = create<CallStoreState>()((set, get) => ({
  ...makeInitial(),

  startCall: (calleeId, calleeName, calleeLanguage) => {
    set({
      ...makeInitial(),
      state: "calling",
      calleeName,
      calleeLanguage,
    });
    // calleeId stored via setRoomId after API responds
    void calleeId; // referenced later via startCall caller
  },

  setRoomId: (roomId) => {
    set({ roomId });
  },

  setSessionId: (sessionId) => {
    set({ sessionId });
  },

  acceptIncoming: (roomId) => {
    set({ state: "ringing", roomId });
  },

  declineIncoming: () => {
    set({ state: "ended" });
    setTimeout(() => {
      if (get().state === "ended") {
        set(makeInitial());
      }
    }, 2000);
  },

  setActive: () => {
    set({ state: "active", callStartedAt: Date.now(), translationStatus: "translating" });
  },

  endCall: () => {
    set({ state: "ended" });
  },

  resetToIdle: () => {
    set(makeInitial());
  },

  toggleMute: () => {
    set((s) => ({ isMuted: !s.isMuted }));
  },

  toggleSpeaker: () => {
    set((s) => ({ isSpeakerOn: !s.isSpeakerOn }));
  },

  toggleTranslation: () => {
    set((s) => ({ translationEnabled: !s.translationEnabled }));
  },

  toggleSubtitles: () => {
    set((s) => ({ isSubtitlesEnabled: !s.isSubtitlesEnabled }));
  },

  setTranslationStatus: (status) => {
    set({ translationStatus: status });
  },

  setPartialSubtitle: (text) => {
    set((s) => ({ subtitles: { ...s.subtitles, partial: text } }));
  },

  appendFinalSubtitle: (segment) => {
    set((s) => ({
      subtitles: {
        partial: null,
        final: [...s.subtitles.final, segment],
      },
    }));
  },

  addParticipant: (participant) => {
    set((s) => ({
      participants: [...s.participants.filter((p) => p.userId !== participant.userId), participant],
    }));
  },

  tickDuration: (nowMs) => {
    const { callStartedAt } = get();
    if (callStartedAt != null) {
      set({ callDurationMs: nowMs - callStartedAt });
    }
  },

  setError: (error) => {
    set({ lastError: error });
  },
}));

// Satisfy Result import (used in callers)
export type { Result };
