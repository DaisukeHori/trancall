// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// docs/native-call-bridge.md §5.3/§5.4 のコード片を元にしたスキャフォールド。
package tech.hori.trancall.callbridge

import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import java.util.UUID

/**
 * Self-Managed ConnectionService 実装。
 *
 * 設計参照: docs/native-call-bridge.md §5.3/§5.4
 *
 * FcmService.kt (app-level, apps/mobile/android/app/src/main/.../FcmService.kt) が
 * TelecomManager.addNewIncomingCall(...) を呼ぶと onCreateIncomingConnection が起動する。
 * CallBridgeModule.startOutgoingCall (JS 発信) は TelecomManager.placeCall(...) を呼び、
 * onCreateOutgoingConnection が起動する。
 */
class CallConnectionService : ConnectionService() {

  companion object {
    const val EXTRA_UUID = "trancall_uuid"
    const val EXTRA_CALLER_NAME = "trancall_caller_name"
    const val EXTRA_CALLER_TRANCALL_ID = "trancall_caller_trancall_id"
    const val EXTRA_ROOM_ID = "trancall_room_id"
  }

  override fun onCreateIncomingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ): Connection {
    val extras = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
    val uuid = extras?.getString(EXTRA_UUID) ?: UUID.randomUUID().toString()
    val callerName = extras?.getString(EXTRA_CALLER_NAME) ?: "Unknown"
    val roomId = extras?.getString(EXTRA_ROOM_ID) ?: ""

    val connection = TranCallConnection(applicationContext, uuid, roomId, isOutgoing = false).apply {
      setRinging()
      setCallerDisplayName(callerName, TelecomManager.PRESENTATION_ALLOWED)
      setAddress(request?.address, TelecomManager.PRESENTATION_ALLOWED)
    }

    // ★ Android 12+/14+: ForegroundService を 5 秒以内に startForeground する (§3.2.2/§5.5) ★
    CallForegroundService.start(applicationContext, uuid)

    return connection
  }

  override fun onCreateIncomingConnectionFailed(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ) {
    // 他アプリの通話と競合した場合等 (§9.3)。best-effort で log のみ。
    android.util.Log.w("CallConnectionService", "onCreateIncomingConnectionFailed: $request")
  }

  override fun onCreateOutgoingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ): Connection {
    val extras = request?.extras
    val uuid = extras?.getString(EXTRA_UUID) ?: UUID.randomUUID().toString()
    val roomId = extras?.getString(EXTRA_ROOM_ID) ?: ""
    val calleeName = extras?.getString(EXTRA_CALLER_NAME) ?: "Unknown"

    return TranCallConnection(applicationContext, uuid, roomId, isOutgoing = true).apply {
      setDialing()
      setCallerDisplayName(calleeName, TelecomManager.PRESENTATION_ALLOWED)
      setAddress(request?.address, TelecomManager.PRESENTATION_ALLOWED)
    }
  }

  override fun onCreateOutgoingConnectionFailed(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ) {
    android.util.Log.w("CallConnectionService", "onCreateOutgoingConnectionFailed: $request")
  }
}
