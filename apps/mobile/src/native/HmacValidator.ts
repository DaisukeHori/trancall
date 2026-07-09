/**
 * HmacValidator — TypeScript ラッパー
 *
 * #H-3: modules/call-bridge (CallBridge Expo Module, "TranCallBridge" native module) 経由で
 * validateCallPayload を呼ぶ薄い層。Expo Go など native module が未インストールの環境では
 * false を返す fallback。
 *
 * 設計参照: docs/notification-detail.md §3 (HMAC 仕様 canonical)
 *           docs/native-call-bridge.md §12.1 (Mobile 検証フロー)
 *
 * native 実装 (CallBridgeProviding.validateCallPayload 経由):
 *   iOS:     apps/mobile/ios/CallBridge/HmacValidator.swift
 *            (modules/call-bridge/ios/CallBridgeModule.swift の AsyncFunction から呼ばれる)
 *   Android: modules/call-bridge/android/.../HmacValidator.kt
 *            (modules/call-bridge/android/.../CallBridgeModule.kt の AsyncFunction から呼ばれる)
 *
 * ⚠️ device-verification-required: Stage 2 で apps/mobile/modules/call-bridge/ の
 * ExpoModule ("TranCallBridge") に統合済み。実機ビルド未検証。
 */
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * HmacValidator native module の型定義 (TranCallBridge native module の validateCallPayload と同形)。
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

  // 本番: CallBridge Expo Module ("TranCallBridge") から取得。
  // requireOptionalNativeModule は native module 未リンク時に例外を投げず null を返す。
  return requireOptionalNativeModule<HmacValidatorNativeModule>("TranCallBridge");
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
      "[HmacValidator] TranCallBridge native module is not available. " +
        "Returning false (Expo Go or native build not performed).",
    );
    return false;
  }

  return nativeModule.validateCallPayload(payload, secret);
}
