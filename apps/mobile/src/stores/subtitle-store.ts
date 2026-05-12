/**
 * subtitle-store — LiveKit Data Channel 経由 partial delta + final segments
 *
 * partial: Data Channel から受信した未確定テキスト (画面上に dashed underline で表示)
 * final: サーバーに永続化済みの確定セグメント (API から取得 or Data Channel の final イベント)
 */
import { create } from "zustand";

export interface SubtitleDelta {
  segmentId: string;
  side: "me" | "peer";
  text: string;
  isFinal: boolean;
  original?: string;
}

export interface FinalSegment {
  id: string;
  side: "me" | "peer";
  original: string;
  translated: string;
  isFinal: true;
  timestampMs: number;
}

export interface SubtitleStoreState {
  // Partial (from Data Channel, replaced on each delta)
  partial: SubtitleDelta | null;
  // Final segments (accumulate during call)
  finals: FinalSegment[];

  // Actions
  receivePartialDelta: (delta: SubtitleDelta) => void;
  commitFinal: (segment: FinalSegment) => void;
  clearPartial: () => void;
  reset: () => void;
}

export const useSubtitleStore = create<SubtitleStoreState>()((set) => ({
  partial: null,
  finals: [],

  receivePartialDelta: (delta) => {
    if (delta.isFinal) {
      // If delta is already final, commit it directly
      set((s) => ({
        partial: null,
        finals: [
          ...s.finals,
          {
            id: delta.segmentId,
            side: delta.side,
            original: delta.original ?? "",
            translated: delta.text,
            isFinal: true,
            timestampMs: Date.now(),
          },
        ],
      }));
    } else {
      set({ partial: delta });
    }
  },

  commitFinal: (segment) => {
    set((s) => {
      // Avoid duplicate finals by id
      const exists = s.finals.some((f) => f.id === segment.id);
      if (exists) return {};
      return {
        partial: null,
        finals: [...s.finals, segment],
      };
    });
  },

  clearPartial: () => {
    set({ partial: null });
  },

  reset: () => {
    set({ partial: null, finals: [] });
  },
}));
