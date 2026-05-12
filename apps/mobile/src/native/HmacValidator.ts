/**
 * HmacValidator — TypeScript ラッパー
 *
 * NativeModules.HmacValidator.validateCallPayload を呼ぶ薄い層。
 * Expo Go など native module が未インストールの環境では false を返す fallback。
 *
 * 設計参照: docs/notification-detail.md §3 (HMAC 仕様 canonical)
 *           docs/native-call-bridge.md §12.1 (Mobile 検証フロー)
 *
 * native 実装:
 *   iOS:     apps/mobile/ios/CallBridge/HmacValidator.swift
 *   Android: apps/mobile/android/app/src/main/java/tech/hori/trancall/HmacValidator.kt
 *
 * Sprint 3 Phase 1a で apps/mobile/modules/call-bridge/ の ExpoModule に統合後、
 * このラッパーは requireNativeModule('HmacValidator') を使うよう更新予定。
 */

/**
 * HmacValidator native module の型定義。
 * 型宣言は src/types/native-modules.d.ts でも公開している。
 */
export type HmacValidatorNativeModule = {
  validateCallPayload: (
    payload: Record<string, unknown>,
    secret: string,
  ) => Promise<boolean>;
};

// テスト注入用オーバーライド (callkit wrapper と同パターン)
let _nativeModuleOverride: HmacValidatorNativeModule | null = null;

/**
 * テスト時にモジュールを注入する。
 * Usage: setHmacValidatorNativeModule(mockModule) / setHmacValidatorNativeModule(null)
 */
export function setHmacValidatorNativeModule(
  mod: HmacValidatorNativeModule | null,
): void {
  _nativeModuleOverride = mod;
}

function resolveNativeModule(): HmacValidatorNativeModule | null {
  // テスト注入が最優先
  if (_nativeModuleOverride != null) {
    return _nativeModuleOverride;
  }

  // 本番: react-native NativeModules から取得
  // require を使うことで環境によっては undefined になるケースを安全に扱う
  try {
    const rn = require("react-native") as { NativeModules?: Record<string, unknown> }; // eslint-disable-line @typescript-eslint/no-require-imports
    const mod = rn.NativeModules?.["HmacValidator"];
    if (mod == null) return null;
    return mod as HmacValidatorNativeModule;
  } catch {
    return null;
  }
}

/**
 * incoming_call push payload の HMAC 署名を検証する。
 *
 * @param payload  trancall キー配下のペイロードオブジェクト
 * @param secret   共有鍵 TRANCALL_PUSH_HMAC_SECRET
 * @returns        検証成功なら true、native module 未実装環境では false
 */
export async function validateCallPayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<boolean> {
  const nativeModule = resolveNativeModule();

  if (nativeModule == null) {
    // Expo Go / native module 未インストール環境では false を返す (fallback)
    console.warn(
      "[HmacValidator] NativeModules.HmacValidator is not available. " +
        "Returning false (Expo Go or native module not installed).",
    );
    return false;
  }

  return nativeModule.validateCallPayload(payload, secret);
}
