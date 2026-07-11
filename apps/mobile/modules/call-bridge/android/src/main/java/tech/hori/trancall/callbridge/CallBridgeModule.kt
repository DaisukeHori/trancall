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

class CallBridgeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TranCallBridge")

    Events(EVENT_NAME)

    OnCreate {
      instance = WeakReference(this@CallBridgeModule)
      PhoneAccounts.register(context)
      // M-6: channel 作成ロジック本体は CallNotificationChannels (CallForegroundService と共有)
      // に一元化済み。headless (FCM 経由) 起動時にこの OnCreate が先に走らないケースに備え、
      // CallForegroundService.onStartCommand 側でも同じ ensure を呼ぶ (二重呼び出しは安全)。
      CallNotificationChannels.ensureCallChannel(context)
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

    // answerCall (§7.1 note、M-7 対応): 通常は Telecom UI / heads-up 通知の応答ボタン経由で
    // Connection.onAnswer() が自動発火するため、JS 側は fallback 用途。
    // Android の Connection インスタンスは ConnectionService (この library module) が
    // 生成した瞬間から同一プロセス内の通常の Kotlin オブジェクトであるため、
    // CallConnectionStore (M-7 で新設、G-7 解消) 経由で参照を保持しておけば
    // `TranCallConnection.answerFromJs()` (= `Connection.onAnswer()` を直接呼ぶ、
    // 公式 API が public であるため合法) で uuid 指定の応答が可能になる。
    AsyncFunction("answerCall") { uuid: String, promise: Promise ->
      val connection = CallConnectionStore.currentConnection()
      if (connection == null || connection.callUuid != uuid) {
        promise.reject(
          CallBridgeException("CALL_BRIDGE_CALL_NOT_FOUND", "No tracked TranCallConnection for uuid=$uuid"),
        )
        return@AsyncFunction
      }
      connection.answerFromJs()
      promise.resolve(null)
    }

    AsyncFunction("endCall") { uuid: String, promise: Promise ->
      // M-7: uuid が一致する追跡中の Connection があれば、それを直接切断する
      // (`TranCallConnection.endFromJs()` = `Connection.onDisconnect()` を直接呼ぶ、
      // setDisconnected + destroy() で当該 Connection のみを正確に終話できる)。
      val connection = CallConnectionStore.currentConnection()
      if (connection != null && connection.callUuid == uuid) {
        connection.endFromJs()
        promise.resolve(null)
        return@AsyncFunction
      }

      // フォールバック: 追跡中の Connection が見つからない場合のみ、
      // Telecom の CallKit CXCallController 相当の「uuid 指定で外部から終話」公開 API が
      // 無いための近似 (TelecomManager.endCall()、「現在アクティブな通話」粒度、deprecated)。
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
      // M-7 (G-7 解消): CallConnectionStore が TranCallConnection と CallBridgeModule の
      // 両方から参照できる共有 state store として機能する。
      val state = CallConnectionStore.currentCallState()
      if (state == null) {
        promise.resolve(null)
      } else {
        promise.resolve(mapOf("uuid" to state.first, "state" to state.second))
      }
    }

    // #H-3: HmacValidator.ts の JS 側 defense-in-depth 検証 (native-call-bridge.md §12.1)
    AsyncFunction("validateCallPayload") { payload: Map<String, Any?>, secret: String, promise: Promise ->
      promise.resolve(HmacValidator.validateCallPayload(payload, secret))
    }
  }

  companion object {
    private var instance: WeakReference<CallBridgeModule>? = null

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
