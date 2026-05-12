/**
 * React Native NativeModules 型定義拡張
 *
 * このファイルは react-native の NativeModules に対して
 * TranCall 独自ネイティブモジュールの型を宣言する。
 *
 * 実際の native 実装 (Swift / Kotlin) は Sprint 3 Phase 1a で完成予定。
 * ここではコンパイラが型を認識できるよう declare module を使用する。
 */

declare module "react-native" {
  interface NativeModulesStatic {
    /**
     * HmacValidator native module
     *
     * iOS: apps/mobile/ios/CallBridge/HmacValidator.swift
     * Android: apps/mobile/android/app/src/main/java/tech/hori/trancall/HmacValidator.kt
     *
     * React Native bridge として公開するために別途 Expo Module 登録が必要。
     * Sprint 3 Phase 1a で apps/mobile/modules/call-bridge/ に ExpoModule として統合予定。
     */
    HmacValidator?: {
      /**
       * incoming_call push payload の HMAC 署名を検証する。
       *
       * @param payload  trancall キー配下のペイロードオブジェクト
       * @param secret   共有鍵 TRANCALL_PUSH_HMAC_SECRET
       * @returns        検証成功なら true、失敗・未実装なら false
       */
      validateCallPayload: (
        payload: Record<string, unknown>,
        secret: string,
      ) => Promise<boolean>;
    };
  }
}
