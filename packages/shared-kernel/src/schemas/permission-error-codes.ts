/**
 * permission-error-codes.ts — Mobile-only 権限拒否エラーコード
 *
 * canonical 定義: docs/legal-and-consent.md v1.2 §6.5.4
 * 関連契約: docs/module-contracts.md v1.3 §5 (Error Code Ownership)
 *
 * これらのエラーコードは **Mobile-only** です。
 * OS レベルの権限拒否を表すコードであり、server には伝播しません。
 * AUTH_CONSENT_* とは別系統で管理します。
 *
 * 参考: docs/legal-and-consent.md §6.5.1〜§6.5.3 の各権限拒否シナリオ
 */

// ============================================================
// §6.5.4 PERMISSION_* error code — Mobile-only
// ============================================================

/**
 * Mobile-only PERMISSION エラーコード の const オブジェクト。
 *
 * - PERMISSION_MICROPHONE_DENIED:
 *     マイク (RECORD_AUDIO) 権限が拒否された。
 *     通話開始に必須。Linking.openSettings() で設定アプリへ誘導する。
 *     (§6.5.1 参照)
 *
 * - PERMISSION_NOTIFICATION_DENIED:
 *     通知 (POST_NOTIFICATIONS) 権限が拒否された。
 *     iOS / Android 13+ で着信 Push を受け取れなくなる。
 *     Home 上部に Soft Banner を表示する。
 *     (§6.5.2 参照)
 *
 * - PERMISSION_TELECOM_REVOKED:
 *     MANAGE_OWN_CALLS 権限が強制取消された (Android 11+)。
 *     SecurityException を catch して報告し、次回起動時に Home Soft Banner を表示する。
 *     (§6.5.3 参照)
 *
 * @mobile-only server へは伝播しない
 */
export const PERMISSION_ERROR_CODES = {
  /**
   * マイク (RECORD_AUDIO) 権限が拒否された。
   * @mobile-only server へは伝播しない
   * @platform iOS, Android
   */
  PERMISSION_MICROPHONE_DENIED: "PERMISSION_MICROPHONE_DENIED",

  /**
   * 通知 (POST_NOTIFICATIONS) 権限が拒否された。
   * @mobile-only server へは伝播しない
   * @platform iOS, Android 13+
   */
  PERMISSION_NOTIFICATION_DENIED: "PERMISSION_NOTIFICATION_DENIED",

  /**
   * MANAGE_OWN_CALLS 権限が強制取消された。
   * @mobile-only server へは伝播しない
   * @platform Android 11+
   */
  PERMISSION_TELECOM_REVOKED: "PERMISSION_TELECOM_REVOKED",
} as const;

/**
 * PERMISSION_* エラーコードのユニオン型。
 * @mobile-only server へは伝播しない
 */
export type PermissionErrorCode =
  (typeof PERMISSION_ERROR_CODES)[keyof typeof PERMISSION_ERROR_CODES];

/**
 * PERMISSION_* エラーコード値の配列 (網羅性チェック用)。
 * @mobile-only server へは伝播しない
 */
export const PERMISSION_ERROR_CODE_VALUES: readonly PermissionErrorCode[] =
  Object.values(PERMISSION_ERROR_CODES);

/**
 * 与えられた code が PERMISSION_* Mobile-only エラーコードかどうかを判定する型ガード。
 *
 * @mobile-only server 側でこの関数を呼び出す必要はない (server には伝播しない)
 */
export function isPermissionErrorCode(code: string): code is PermissionErrorCode {
  return PERMISSION_ERROR_CODE_VALUES.some((value) => value === code);
}
