// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// docs/native-call-bridge.md §5.5 のコード片を元にしたスキャフォールド。
// 通知アイコン (R.drawable.ic_call) は app module 側リソースを参照する想定だが、
// library module からは app のリソース ID を直接参照できないため、
// ⚠️ 実機ビルド時にリソース解決 (別途 app 側でチャンネル/アイコンを用意するか、
// このモジュール自身に drawable を同梱する) の調整が必要。
package tech.hori.trancall.callbridge

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

private const val NOTIFICATION_ID = 6210
private const val CHANNEL_ID = "trancall_call_channel"
private const val EXTRA_UUID = "uuid"

class CallForegroundService : Service() {

  companion object {
    fun start(context: Context, uuid: String) {
      val intent = Intent(context, CallForegroundService::class.java).apply {
        putExtra(EXTRA_UUID, uuid)
      }
      androidx.core.content.ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CallForegroundService::class.java))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // ⚠️ device-verification-required: NotificationChannel 作成 (Android 8+ 必須) は
    // アプリ起動時 (CallBridgeModule.OnCreate 等) で行う想定だが未実装。
    // channel 未作成のまま startForeground すると実機で例外になる可能性がある。
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("通話中")
      .setContentText("TranCall で通話中")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // TODO(device-verification-required): library module から app 側の実アイコン
      // (packages/ui-kit/assets/trancall-icon.svg 由来の mipmap) を参照できないため、
      // 暫定的に Android 標準アイコンを使用。NotificationCompat.Builder は
      // setSmallIcon 省略不可 (省略すると実行時に失敗する) ため placeholder を必ず設定する。
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+: foregroundServiceType の明示が必須 (§5.5, §9.2)
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
