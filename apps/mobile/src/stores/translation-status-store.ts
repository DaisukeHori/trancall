/**
 * translation-status-store — degraded / recovered 状態管理
 *
 * LiveKit Data Channel 経由で受信した translation.degraded / translation.recovered
 * ペイロードを Zustand で管理し、in-call-screen の UI バッジに反映する。
 *
 * module-contracts.md §3.4 / translation-pipeline-design.md §7 準拠
 */
import { create } from "zustand";

export type DegradedReason =
  | "openai_ws_reconnecting"
  | "high_latency"
  | "output_silence";

export interface TranslationStatusStoreState {
  /** degraded 中の理由。null = normal / recovered 状態 */
  degradedReason: DegradedReason | null;
  /** 最後に recovered した ISO8601 タイムスタンプ。null = まだ recovered なし */
  lastRecoveredAt: string | null;
  /** recovered 直後の一時フラグ。3 秒間 true になり、緑バッジを表示する */
  justRecovered: boolean;

  // Actions
  setDegraded: (reason: DegradedReason) => void;
  setRecovered: (durationMs: number, timestamp: string) => void;
  clearJustRecovered: () => void;
  reset: () => void;
}

export const useTranslationStatusStore = create<TranslationStatusStoreState>()((set) => ({
  degradedReason: null,
  lastRecoveredAt: null,
  justRecovered: false,

  setDegraded: (reason) => {
    set({ degradedReason: reason, justRecovered: false });
  },

  setRecovered: (_durationMs, timestamp) => {
    set({ degradedReason: null, lastRecoveredAt: timestamp, justRecovered: true });
  },

  clearJustRecovered: () => {
    set({ justRecovered: false });
  },

  reset: () => {
    set({ degradedReason: null, lastRecoveredAt: null, justRecovered: false });
  },
}));
