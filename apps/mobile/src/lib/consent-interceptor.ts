/**
 * consent-interceptor.ts — AUTH_CONSENT_* エラー検出ユーティリティ
 *
 * canonical: docs/legal-and-consent.md v1.2 §14 (エラーハンドリング)
 *
 * API レスポンスが AUTH_CONSENT_REQUIRED または AUTH_CONSENT_VERSION_MISMATCH を
 * 返した場合に useConsentStore.requestConsentRedirect() を呼び、
 * RootNavigator が Consent Screen へ強制遷移するトリガーを設定する。
 *
 * 使用方法:
 *   import { handleConsentError } from "../lib/consent-interceptor";
 *
 *   const result = await apiFetch(...);
 *   if (!result.ok && handleConsentError(result.error)) {
 *     return; // Consent Screen に遷移済み
 *   }
 */

import type { RequiredConsentView } from "@trancall/shared-kernel";
import { useConsentStore } from "../stores/consent-store";

/** AUTH_CONSENT_* に該当するエラーコード */
const CONSENT_ERROR_CODES = [
  "AUTH_CONSENT_REQUIRED",
  "AUTH_CONSENT_VERSION_MISMATCH",
] as const;

export type ConsentErrorCode = (typeof CONSENT_ERROR_CODES)[number];

/**
 * エラーコードが AUTH_CONSENT_* かどうかを判定する。
 */
export function isConsentError(code: string): code is ConsentErrorCode {
  return CONSENT_ERROR_CODES.some((consentCode) => consentCode === code);
}

/**
 * エラーが AUTH_CONSENT_REQUIRED または AUTH_CONSENT_VERSION_MISMATCH の場合、
 * consentStore に強制遷移リクエストをセットして true を返す。
 *
 * @param error           - ResultErr.error オブジェクト
 * @param requiredConsents - 事前フェッチ済みの consents (なければ [] を渡す)
 * @param source          - 同意取得文脈
 * @param onComplete      - 同意完了後のコールバック
 * @returns               - Consent Screen へ誘導した場合 true
 */
export function handleConsentError(
  error: { code: string },
  requiredConsents: RequiredConsentView[],
  source:
    | "onboarding"
    | "incoming_call_first_time"
    | "settings_screen"
    | "terms_revision_prompt",
  onComplete: () => void,
): boolean {
  if (!isConsentError(error.code)) return false;

  const { requestConsentRedirect } = useConsentStore.getState();
  requestConsentRedirect({
    errorCode: error.code,
    requiredConsents,
    source,
    onComplete,
  });

  return true;
}
