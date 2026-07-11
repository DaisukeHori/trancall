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

  /**
   * M-7 (G-7 解消): `CallBridgeModule.getCurrentCallState()` から `CallConnectionStore` 経由で
   * 横断参照される state。値は CallStateSchema (§7.1/§8.1、canonical は
   * `packages/shared-kernel` 移設後の native-call.ts、L-9 参照) のサブセット
   * ("ringing" | "answering" | "active" | "ended") を用い、iOS 版
   * `CallBridgeProvider.TrackedCall.state` と対称にする。
   */
  var callState: String = if (isOutgoing) "answering" else "ringing"
    private set

  init {
    setConnectionCapabilities(CAPABILITY_MUTE)
    setAudioModeIsVoip(true)
    connectionProperties = PROPERTY_SELF_MANAGED
    // M-7 (G-7/G-8 解消): 生成直後に共有 state store へ登録し、CallBridgeModule から
    // getCurrentCallState()/answerCall()/endCall() で横断参照できるようにする。
    CallConnectionStore.register(this)
  }

  override fun onAnswer() {
    callState = "active"
    setActive()
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
    CallBridgeModule.emitCallAnswered(callUuid)
  }

  /**
   * M-7 (G-8 解消): JS 側 `callBridge.answerCall(uuid)` fallback から
   * `CallConnectionStore.currentConnection()` 経由で呼ばれる。
   * `Connection.onAnswer()` は公式 API として public であり、システム UI 経由の応答
   * (Telecom framework からのコールバック) と全く同じコードパスを直接起動できるため、
   * 別途ロジックを複製せずそのまま委譲する。
   */
  fun answerFromJs() {
    onAnswer()
  }

  override fun onDisconnect() {
    callState = "ended"
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    destroy()
    CallConnectionStore.unregister(this)
    CallForegroundService.stop(context)
    CallBridgeModule.emitCallEnded(callUuid, "user")
  }

  /**
   * M-7 (G-8 解消): JS 側 `callBridge.endCall(uuid)` から uuid 一致時に呼ばれる。
   * `TelecomManager.endCall()` (deprecated、「現在アクティブな通話」粒度の近似) と異なり、
   * この Connection インスタンスだけを正確に終話できる。
   */
  fun endFromJs() {
    onDisconnect()
  }

  override fun onAbort() {
    callState = "ended"
    setDisconnected(DisconnectCause(DisconnectCause.OTHER))
    destroy()
    CallConnectionStore.unregister(this)
    CallForegroundService.stop(context)
    CallBridgeModule.emitCallEnded(callUuid, "force_terminated")
  }

  override fun onReject() {
    callState = "ended"
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    destroy()
    CallConnectionStore.unregister(this)
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
