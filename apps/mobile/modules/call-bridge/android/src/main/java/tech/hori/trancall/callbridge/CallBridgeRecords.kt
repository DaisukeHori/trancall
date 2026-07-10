// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// JS ⇄ Kotlin の構造化引数を expo-modules-kotlin の Record パターンで受け渡す (§7.1)。
package tech.hori.trancall.callbridge

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartOutgoingCallArgs : Record {
  @Field
  val uuid: String = ""

  @Field
  val calleeName: String = ""

  @Field
  val roomId: String = ""
}

/**
 * IncomingCallPushPayload (native-call-bridge.md §6.1/§6.3, modules/call-bridge/src/CallBridge.types.ts
 * の IncomingCallPushPayloadSchema と対応)。
 */
class IncomingCallPushPayloadArgs : Record {
  @Field
  val uuid: String = ""

  @Field
  val roomId: String = ""

  @Field
  val callerId: String = ""

  @Field
  val callerName: String = ""

  @Field
  val callerAvatarUrl: String? = null

  @Field
  val callerTrancallId: String = ""

  @Field
  val roomType: String = "audio"

  @Field
  val translationEnabled: Boolean = true

  @Field
  val languagePair: String = ""

  @Field
  val callerLanguage: String = ""

  @Field
  val issuedAt: String = ""

  @Field
  val expiresAt: String = ""

  @Field
  val signature: String = ""
}
