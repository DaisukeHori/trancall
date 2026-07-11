// ⚠️ device-verification-required: Android Studio / Gradle ビルド・実機/エミュレータ検証を
// 一度も行っていない。
package tech.hori.trancall.callbridge

import java.lang.ref.WeakReference

/**
 * M-7 (G-7/G-8 解消): `TranCallConnection` を横断的に参照するための共有 state store。
 *
 * 背景 (docs/native-call-bridge-impl-status.md §5.2/§7 G-7/G-8):
 *   - `CallConnectionService.onCreate{Incoming,Outgoing}Connection` が生成する
 *     `TranCallConnection` は、生成元の `ConnectionService` からしか参照できず、
 *     `CallBridgeModule` (JS ⇄ Native ブリッジ) からは横断参照できなかった
 *     (`getCurrentCallState()` が常に `null` を返す原因、G-7)。
 *   - `answerCall()`/`endCall()` も同様に、JS から特定の uuid を指定して操作したくても
 *     操作対象の `Connection` インスタンスを引き当てる手段が無かった (G-8)。
 *
 * Android の Self-Managed ConnectionService はライブラリ内で完結する設計 (§5.1 の
 * アーキテクチャ上の決定、iOS のような protocol 越しの delegation が不要) なので、
 * 生成された `TranCallConnection` をこの object (プロセス内シングルトン) に登録するだけで
 * `CallBridgeModule` からも直接参照できるようになる。
 *
 * Phase 1a は同時通話数 1 前提 (iOS 版 `CallBridgeProvider.activeCalls` の Android 近似) のため
 * 単一の `WeakReference` で保持する (Connection のライフサイクルより長生きしないよう weak 参照)。
 */
object CallConnectionStore {
  private var current: WeakReference<TranCallConnection>? = null

  fun register(connection: TranCallConnection) {
    current = WeakReference(connection)
  }

  fun unregister(connection: TranCallConnection) {
    if (current?.get() === connection) {
      current = null
    }
  }

  fun currentConnection(): TranCallConnection? = current?.get()

  /** [Pair.first] = uuid, [Pair.second] = CallStateSchema 相当の state 文字列 */
  fun currentCallState(): Pair<String, String>? {
    val connection = current?.get() ?: return null
    return connection.callUuid to connection.callState
  }
}
