// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
// docs/native-call-bridge.md §5.2 のコード片を元にしたスキャフォールド。
package tech.hori.trancall.callbridge

import android.content.ComponentName
import android.content.Context
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

/**
 * PhoneAccountHandle / PhoneAccount 登録の共通ヘルパー。
 * CallBridgeModule (登録) と CallConnectionService / FcmService (Handle 参照) の両方から使う。
 *
 * 設計参照: docs/native-call-bridge.md §5.2
 */
object PhoneAccounts {
  const val ACCOUNT_ID = "trancall-self-managed"

  fun handle(context: Context): PhoneAccountHandle {
    return PhoneAccountHandle(
      ComponentName(context, CallConnectionService::class.java),
      ACCOUNT_ID,
    )
  }

  /**
   * アプリ起動時 (CallBridgeModule.OnCreate) に一度だけ呼ぶ。
   * ⚠️ device-verification-required: 実機での registerPhoneAccount 呼び出し・
   * ユーザーへの Telecom 設定promptの実際の挙動は未検証。
   */
  fun register(context: Context) {
    val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
      ?: return

    val account = PhoneAccount.builder(handle(context), "TranCall")
      .setCapabilities(
        // Phase 1a は音声のみ。CAPABILITY_VIDEO_CALLING は Phase 2 で追加 (§5.2 注釈)
        PhoneAccount.CAPABILITY_SELF_MANAGED,
      )
      .setShortDescription("TranCall 翻訳通話")
      .build()

    telecomManager.registerPhoneAccount(account)
  }
}
