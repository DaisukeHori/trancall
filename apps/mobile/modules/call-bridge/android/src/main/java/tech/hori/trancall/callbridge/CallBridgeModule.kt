// ⚠️ device-verification-required: このファイルは Android Studio / Gradle ビルド・
// 実機/エミュレータ検証を一度も行っていない。docs/native-call-bridge.md §5/§7.1 と
// 既存 Expo Module (expo-audio/expo-notifications) の実装パターンを参考にしたスキャフォールドであり、
// 実際のコンパイル可否は未検証。
//
// modules/call-bridge/android/.../CallBridgeModule.kt
//
// CallBridge Expo Module — JS ⇄ Native の薄いブリッジ層 (§3.4)。
// Android は iOS の CocoaPods と異なり、library module (この Gradle module) が
// app module に依存されるだけで app 側の型を直接知る必要はない
// (TelecomManager/PhoneAccountHandle はすべて Android SDK のシステム API であり、
// CallConnectionService/TranCallConnection も同じ library module 内に同居させているため)。
// そのため iOS 版のような protocol/dependency-inversion は不要で、このクラスが
// TelecomManager を直接操作する。
//
// canonical: docs/native-call-bridge.md §7.1 (CallBridge JS API), §5 (Android Telecom)
package tech.hori.trancall.callbridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.TelecomManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

private const val EVENT_NAME = "onCallBridgeEvent"
private const val CALL_CHANNEL_ID = "trancall_call_channel"

class CallBridgeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TranCallBridge")

    Events(EVENT_NAME)

    OnCreate {
      instance = WeakReference(this@CallBridgeModule)
      PhoneAccounts.register(context)
      ensureNotificationChannel(context)
    }

    OnDestroy {
      if (instance?.get() === this@CallBridgeModule) {
        instance = null
      }
    }

    AsyncFunction("registerForVoipPush") { promise: Promise ->
      // Android は FCM data message + high priority で PushKit 相当を実現するため
      // (§6.2)、明示的な "登録" API 呼び出しは不要 (トークンは onNewToken で自動取得、
      // apps/mobile/android/app/.../FcmService.kt#onNewToken → emitDeviceToken)。
      promise.resolve(mapOf("token" to "", "platform" to "android"))
    }

    AsyncFunction("startOutgoingCall") { args: StartOutgoingCallArgs, promise: Promise ->
      val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      if (telecomManager == null) {
        promise.reject(CallBridgeException("CALL_BRIDGE_NATIVE_MODULE_UNAVAILABLE", "TelecomManager unavailable"))
        return@AsyncFunction
      }

      val extras = Bundle().apply {
        putString(CallConnectionService.EXTRA_UUID, args.uuid)
        putString(CallConnectionService.EXTRA_CALLER_NAME, args.calleeName)
        putString(CallConnectionService.EXTRA_ROOM_ID, args.roomId)
      }
      val callExtras = Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, PhoneAccounts.handle(context))
        putAll(extras)
      }

      telecomManager.placeCall(Uri.fromParts("trancall", args.calleeName, null), callExtras)
      promise.resolve(null)
    }

    AsyncFunction("reportIncomingCall") { payload: IncomingCallPushPayloadArgs, promise: Promise ->
      // Phase 1a note (§7.1): FcmService.onMessageReceived が自動的に処理するため、
      // JS からの明示呼び出しは通常不要。テスト/デバッグ用の経路として残す。
      val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      if (telecomManager == null) {
        promise.reject(CallBridgeException("CALL_BRIDGE_NATIVE_MODULE_UNAVAILABLE", "TelecomManager unavailable"))
        return@AsyncFunction
      }

      val extras = Bundle().apply {
        putString(CallConnectionService.EXTRA_UUID, payload.uuid)
        putString(CallConnectionService.EXTRA_CALLER_NAME, payload.callerName)
        putString(CallConnectionService.EXTRA_CALLER_TRANCALL_ID, payload.callerTrancallId)
        putString(CallConnectionService.EXTRA_ROOM_ID, payload.roomId)
      }
      val callExtras = Bundle().apply {
        putParcelable(
          TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
          Uri.fromParts("trancall", payload.callerTrancallId, null),
        )
        putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, extras)
      }
      telecomManager.addNewIncomingCall(PhoneAccounts.handle(context), callExtras)
      promise.resolve(null)
    }

    // answerCall (§7.1 note): 通常は Telecom UI / heads-up 通知の応答ボタン経由で
    // Connection.onAnswer() が自動発火するため、JS 側 fallback としてのみ用意。
    // Android の Connection インスタンスへは ConnectionService からのみアクセス可能なため、
    // JS から任意の Connection を直接 answer させる公開 API は Telecom framework に存在しない。
    // ⚠️ device-verification-required: 実質未実装 (Telecom 制約)。
    AsyncFunction("answerCall") { _: String, promise: Promise ->
      promise.reject(CallBridgeException("CALL_BRIDGE_CALL_NOT_FOUND", "answerCall from JS is not supported on Android Telecom (use system UI)"))
    }

    AsyncFunction("endCall") { uuid: String, promise: Promise ->
      // Telecom には CallKit の CXCallController 相当の「uuid 指定で外部から終話」公開 API が無い。
      // TelecomManager.endCall() は「現在アクティブな通話」を終わらせる粒度の API のため、
      // 単一通話前提の Phase 1a では妥当な近似として使う。
      val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      if (telecomManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        @Suppress("DEPRECATION")
        telecomManager.endCall()
      }
      promise.resolve(null)
    }

    AsyncFunction("setMuted") { uuid: String, muted: Boolean, promise: Promise ->
      // Telecom の mute はシステム全体の CallAudioState 経由のため、Connection 個別には
      // 設定できない。AudioManager 経由で近似する (§5.6)。
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audioManager?.isMicrophoneMute = muted
      emitCallMuted(uuid, muted)
      promise.resolve(null)
    }

    AsyncFunction("setSpeakerphone") { enabled: Boolean, promise: Promise ->
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audioManager?.isSpeakerphoneOn = enabled
      promise.resolve(null)
    }

    AsyncFunction("getCurrentCallState") { promise: Promise ->
      // ⚠️ device-verification-required: 現状 call state の追跡は TranCallConnection 側に閉じており、
      // Module から横断的に参照する仕組みが未実装 (Sprint 4 で共有 state store を追加予定)。
      promise.resolve(null)
    }

    // #H-3: HmacValidator.ts の JS 側 defense-in-depth 検証 (native-call-bridge.md §12.1)
    AsyncFunction("validateCallPayload") { payload: Map<String, Any?>, secret: String, promise: Promise ->
      promise.resolve(HmacValidator.validateCallPayload(payload, secret))
    }
  }

  companion object {
    private var instance: WeakReference<CallBridgeModule>? = null

    private fun ensureNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      val channel = NotificationChannel(
        CALL_CHANNEL_ID,
        "通話",
        NotificationManager.IMPORTANCE_HIGH,
      )
      manager.createNotificationChannel(channel)
    }

    fun emitDeviceToken(token: String, platform: String) {
      instance?.get()?.sendEvent(
        EVENT_NAME,
        mapOf("type" to "deviceTokenUpdated", "token" to token, "platform" to platform),
      )
    }

    fun emitIncomingCall(
      uuid: String,
      callerId: String,
      callerName: String,
      callerTrancallId: String,
      roomId: String,
      sourceLang: String,
      targetLang: String,
    ) {
      instance?.get()?.sendEvent(
        EVENT_NAME,
        mapOf(
          "type" to "incomingCall",
          "uuid" to uuid,
          "callerId" to callerId,
          "callerName" to callerName,
          "callerTrancallId" to callerTrancallId,
          "roomId" to roomId,
          "sourceLang" to sourceLang,
          "targetLang" to targetLang,
        ),
      )
    }

    fun emitCallAnswered(uuid: String) {
      instance?.get()?.sendEvent(EVENT_NAME, mapOf("type" to "callAnswered", "uuid" to uuid))
    }

    fun emitCallEnded(uuid: String, reason: String) {
      instance?.get()?.sendEvent(EVENT_NAME, mapOf("type" to "callEnded", "uuid" to uuid, "reason" to reason))
    }

    fun emitCallMuted(uuid: String, muted: Boolean) {
      instance?.get()?.sendEvent(EVENT_NAME, mapOf("type" to "callMuted", "uuid" to uuid, "muted" to muted))
    }

    fun emitAudioRouteChanged(uuid: String, route: String) {
      instance?.get()?.sendEvent(EVENT_NAME, mapOf("type" to "audioRouteChanged", "uuid" to uuid, "route" to route))
    }
  }
}

class CallBridgeException(code: String, message: String) : CodedException(code, message, null)
