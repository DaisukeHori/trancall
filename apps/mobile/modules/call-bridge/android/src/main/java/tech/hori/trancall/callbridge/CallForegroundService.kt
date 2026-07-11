// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// docs/native-call-bridge.md §5.5 のコード片を元にしたスキャフォールド。
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

    /**
     * L-7: ライブラリモジュールはコンパイル時にアプリ側リソース ID (例: `R.mipmap.ic_launcher`) を
     * 直接参照できない (循環依存になるため、apps/mobile/modules/call-bridge は app module に
     * 依存されるだけの一方向関係)。実行時に `Resources.getIdentifier` でアプリ側パッケージ名
     * (`context.packageName`) からリソース ID を解決する、ライブラリモジュールがアプリリソースを
     * 参照する標準的な回避策 (Android 公式にも getIdentifier は存在するが、ライブラリ配布物では
     * 非推奨気味 — ただし本件は同一 apk 内の app 側リソースを参照するだけなので問題ない)。
     *
     * 優先順位:
     *   1. `drawable/ic_notification` — アプリ側が将来、通知専用の単色シルエットアイコン
     *      (Android 公式ガイドライン: 通知アイコンは白背景/透過のシルエット推奨) を用意した場合
     *   2. `mipmap/ic_launcher_foreground` — adaptive icon の前景レイヤー (背景円が無く
     *      ic_launcher そのものより通知アイコンとして破綻しにくい)
     *   3. `mipmap/ic_launcher` — アプリ本アイコン (最終的な実アイコンフォールバック)
     *   4. 上記が全て解決できない場合のみ Android 標準アイコン (`sym_call_incoming`) を使う
     *      (`setSmallIcon` は省略不可のため、実アイコンが一切見つからない異常系でも
     *      クラッシュさせない最終防波堤)
     */
    fun resolveSmallIconResId(context: Context): Int {
      val resources = context.resources
      val packageName = context.packageName
      val candidates = listOf(
        "ic_notification" to "drawable",
        "ic_launcher_foreground" to "mipmap",
        "ic_launcher" to "mipmap",
      )
      for ((name, type) in candidates) {
        val resId = resources.getIdentifier(name, type, packageName)
        if (resId != 0) return resId
      }
      return android.R.drawable.sym_call_incoming
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // M-6 (G-6 とは別、遅延生成依存の解消): CallBridgeModule.OnCreate (Expo Module 初期化時)
    // でも channel を ensure しているが、FCM data message による headless 起動経路
    // (React Native / Expo Modules ホストが一度も起動していない状態で FcmService →
    // TelecomManager.addNewIncomingCall → CallConnectionService → ここに到達するケース) では
    // CallBridgeModule が一度もインスタンス化されない可能性があるため、startForeground の
    // 直前でも必ず ensure する (CallNotificationChannels.ensureCallChannel は冪等)。
    CallNotificationChannels.ensureCallChannel(this)

    val notification: Notification = NotificationCompat.Builder(this, CallNotificationChannels.CALL_CHANNEL_ID)
      .setContentTitle("通話中")
      .setContentText("TranCall で通話中")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      // L-7 (G-6 解消): アプリ側の実アイコンを実行時解決する (resolveSmallIconResId)。
      .setSmallIcon(resolveSmallIconResId(this))
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
