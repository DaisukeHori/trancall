// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// docs/native-call-bridge.md §5.4 のコード片を元にしたスキャフォールド。
package tech.hori.trancall.callbridge

import android.content.Context
import android.media.AudioManager
import android.telecom.CallAudioState
import android.telecom.Connection
import android.telecom.DisconnectCause

/**
 * Self-Managed Telecom Connection 実装。
 *
 * 設計参照: docs/native-call-bridge.md §5.4
 *
 * @param context アプリ Context (AudioManager 取得用)
 * @param callUuid CallBridgeModule 側で発行した call UUID (CallKit との対称性のため
 *                  Android にも uuid 概念を導入している。native-call-bridge.md §7.1 CallEvent 参照)
 * @param roomId LiveKit room 識別子
 * @param isOutgoing true なら発信側、false なら着信側
 */
class TranCallConnection(
  private val context: Context,
  val callUuid: String,
  val roomId: String,
  private val isOutgoing: Boolean,
) : Connection() {

  init {
    setConnectionCapabilities(CAPABILITY_MUTE)
    setAudioModeIsVoip(true)
    connectionProperties = PROPERTY_SELF_MANAGED
  }

  override fun onAnswer() {
    setActive()
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
    CallBridgeModule.emitCallAnswered(callUuid)
  }

  override fun onDisconnect() {
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    destroy()
    CallForegroundService.stop(context)
    CallBridgeModule.emitCallEnded(callUuid, "user")
  }

  override fun onAbort() {
    setDisconnected(DisconnectCause(DisconnectCause.OTHER))
    destroy()
    CallForegroundService.stop(context)
    CallBridgeModule.emitCallEnded(callUuid, "force_terminated")
  }

  override fun onReject() {
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    destroy()
    CallForegroundService.stop(context)
    CallBridgeModule.emitCallEnded(callUuid, "user")
  }

  /** 発信側: システムが outgoing connection を受理したタイミング (§5 outgoing フロー) */
  override fun onCallAudioStateChanged(state: CallAudioState) {
    val route = when (state.route) {
      CallAudioState.ROUTE_SPEAKER -> "speaker"
      CallAudioState.ROUTE_BLUETOOTH -> "bluetooth"
      CallAudioState.ROUTE_WIRED_HEADSET -> "wired_headset"
      else -> "earpiece"
    }
    CallBridgeModule.emitAudioRouteChanged(callUuid, route)
  }
}
