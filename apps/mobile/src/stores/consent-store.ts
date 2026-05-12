/**
 * consent-store.ts — 同意管理 Zustand ストア
 *
 * canonical: docs/legal-and-consent.md v1.2 §14 (エラーハンドリング)
 *
 * AUTH_CONSENT_REQUIRED / AUTH_CONSENT_VERSION_MISMATCH を API クライアントから
 * 受信した際に pendingConsentRedirect フラグを立て、RootNavigator が
 * Consent Screen へ強制遷移するために使用する。
 */

import { create } from "zustand";
import type { RequiredConsentView } from "@trancall/shared-kernel";

export interface ConsentRedirectPayload {
  /** 強制遷移の起因エラーコード */
  errorCode: "AUTH_CONSENT_REQUIRED" | "AUTH_CONSENT_VERSION_MISMATCH";
  /** 取得済みの consents (事前フェッチ済みの場合のみ) */
  requiredConsents: RequiredConsentView[];
  /**
   * 同意完了後に呼ぶコールバック。
   * 通話中断からの復帰など、呼び出し元で用意する。
   */
  onComplete: () => void;
  /** 取得文脈 */
  source:
    | "onboarding"
    | "incoming_call_first_time"
    | "settings_screen"
    | "terms_revision_prompt";
}

export interface ConsentState {
  /** null = 遷移不要, non-null = Consent Screen への強制遷移が必要 */
  pendingConsentRedirect: ConsentRedirectPayload | null;

  /**
   * AUTH_CONSENT_REQUIRED / AUTH_CONSENT_VERSION_MISMATCH 受信時に呼ぶ。
   * RootNavigator が useEffect で監視し、Consent Screen に遷移させる。
   */
  requestConsentRedirect: (payload: ConsentRedirectPayload) => void;

  /** Consent Screen が表示されたら呼ぶ (二重遷移防止) */
  clearConsentRedirect: () => void;
}

export const useConsentStore = create<ConsentState>()((set) => ({
  pendingConsentRedirect: null,

  requestConsentRedirect: (payload: ConsentRedirectPayload) => {
    set({ pendingConsentRedirect: payload });
  },

  clearConsentRedirect: () => {
    set({ pendingConsentRedirect: null });
  },
}));

// Selector helpers
export const selectPendingConsentRedirect = (state: ConsentState): ConsentRedirectPayload | null =>
  state.pendingConsentRedirect;
