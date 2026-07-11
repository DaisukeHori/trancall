// ⚠️ device-verification-required: Android Studio / Gradle ビルド・実機/エミュレータ検証を
// 一度も行っていない。
package tech.hori.trancall.callbridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * 通話中 NotificationChannel (`trancall_call_channel`) 生成ロジックの単一ソース (M-6)。
 *
 * 背景: `CallBridgeModule.OnCreate` (Expo Module 初期化時) で channel を ensure する実装は
 * 既に存在していたが、FCM data message による着信 (`FcmService.onMessageReceived`) は
 * React Native / Expo Modules ホストが一度も起動していない headless プロセス起動経路
 * (Android がプッシュ配送のためだけに Application を起こすケース) を通ることがあり、
 * その場合 `CallBridgeModule` は一度もインスタンス化されず `OnCreate` が実行されないまま
 * `CallConnectionService.onCreateIncomingConnection` → `CallForegroundService.start()` →
 * `startForeground()` が呼ばれる可能性がある。Android 8+ で未作成の channel を指定して
 * `startForeground()` を呼ぶと `IllegalArgumentException` になるため、
 * `CallForegroundService` 自身が呼び出し直前に確実に ensure できるよう、
 * ここに channel 作成ロジックを一元化し `CallBridgeModule` と `CallForegroundService` の
 * 両方から呼ぶ (どちらの起動経路でも channel 未作成のまま `startForeground` に到達しない)。
 *
 * `NotificationManager.createNotificationChannel` は同一 ID を渡しても例外を投げず
 * 既存 channel を上書き (実質 no-op) するだけの安全な操作 (Android 公式仕様) なので、
 * 複数箇所から重複して呼んでも問題ない。
 */
object CallNotificationChannels {
  const val CALL_CHANNEL_ID = "trancall_call_channel"

  fun ensureCallChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    val channel = NotificationChannel(
      CALL_CHANNEL_ID,
      "通話",
      NotificationManager.IMPORTANCE_HIGH,
    )
    manager.createNotificationChannel(channel)
  }
}
