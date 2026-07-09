package tech.hori.trancall

import android.net.Uri
import android.os.Bundle
import android.telecom.TelecomManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import tech.hori.trancall.callbridge.CallBridgeModule
import tech.hori.trancall.callbridge.CallConnectionService
import tech.hori.trancall.callbridge.PhoneAccounts
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * FCM data message 受信サービス
 *
 * 設計参照: docs/notification-detail.md §2.1 (Android 受信処理)
 *           docs/native-call-bridge.md §5 / §12.1
 *
 * - FCM High priority + data-only message (notification キーなし) で
 *   Doze 中でも onMessageReceived が起動される。
 * - HMAC 検証失敗時は ConnectionService を呼ばずに drop (silent fail)。
 */
class FcmService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FcmService"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        if (data["type"] != "incoming_call") {
            // incoming_call 以外のメッセージは別途処理 (通知表示等)
            return
        }

        handleIncomingCall(data)
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "FCM token refreshed: ${token.take(16)}...")
        // #H-3: JS bridge 経由でトークンをサーバーに通知する
        CallBridgeModule.emitDeviceToken(token = token, platform = "android")
    }

    // MARK: - Private

    private fun handleIncomingCall(data: Map<String, String>) {
        // FCM data は string 型のみのため Any にアップキャスト
        val payload: Map<String, Any> = data

        // ① expiresAt 検証 (リプレイ攻撃対策、30 秒 TTL)
        val expiresAtString = data["expiresAt"]
        if (expiresAtString == null) {
            Log.w(TAG, "Missing expiresAt — dropping")
            return
        }
        val expiresAt = try {
            Instant.parse(expiresAtString)
        } catch (_: DateTimeParseException) {
            Log.w(TAG, "Invalid expiresAt format — dropping")
            return
        }
        if (Instant.now().isAfter(expiresAt)) {
            Log.w(TAG, "Payload expired at $expiresAtString — dropping")
            return
        }

        // ② HMAC 署名検証
        val secret = getHmacSecret()
        if (secret == null) {
            Log.e(TAG, "HMAC secret not configured — dropping")
            return
        }
        if (!HmacValidator.validateCallPayload(payload, secret)) {
            Log.w(TAG, "HMAC verification failed — dropping")
            return
        }

        // ③ 必須フィールドを取り出す
        val uuid             = data["uuid"]             ?: run { Log.w(TAG, "Missing uuid"); return }
        val callerName       = data["callerName"]       ?: run { Log.w(TAG, "Missing callerName"); return }
        val callerTrancallId = data["callerTrancallId"] ?: run { Log.w(TAG, "Missing callerTrancallId"); return }
        val roomId           = data["roomId"]           ?: run { Log.w(TAG, "Missing roomId"); return }

        // ④ ConnectionService に投入
        reportIncomingCall(
            uuid             = uuid,
            callerName       = callerName,
            callerTrancallId = callerTrancallId,
            roomId           = roomId,
            callerId         = data["callerId"] ?: "",
            callerLanguage   = data["callerLanguage"] ?: "",
            languagePair     = data["languagePair"] ?: "",
        )
    }

    /**
     * TelecomManager.addNewIncomingCall を呼び CallConnectionService (call-bridge module) に通知する。
     * Stage 2: modules/call-bridge/android/.../CallConnectionService.kt を参照。
     *
     * 設計参照: docs/native-call-bridge.md §5.3
     */
    private fun reportIncomingCall(
        uuid: String,
        callerName: String,
        callerTrancallId: String,
        roomId: String,
        callerId: String,
        callerLanguage: String,
        languagePair: String,
    ) {
        Log.i(TAG, "Incoming call verified — uuid=$uuid caller=$callerTrancallId roomId=$roomId callerName=$callerName")

        val telecomManager = getSystemService(TELECOM_SERVICE) as? TelecomManager
        if (telecomManager == null) {
            Log.e(TAG, "TelecomManager unavailable — dropping")
            return
        }

        val extras = Bundle().apply {
            putString(CallConnectionService.EXTRA_UUID, uuid)
            putString(CallConnectionService.EXTRA_CALLER_NAME, callerName)
            putString(CallConnectionService.EXTRA_CALLER_TRANCALL_ID, callerTrancallId)
            putString(CallConnectionService.EXTRA_ROOM_ID, roomId)
        }
        val callExtras = Bundle().apply {
            putParcelable(
                TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
                Uri.fromParts("trancall", callerTrancallId, null),
            )
            putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, extras)
        }
        telecomManager.addNewIncomingCall(PhoneAccounts.handle(applicationContext), callExtras)

        // #H-3: JS 側 (call-overlay.tsx の IncomingCall screen) へ着信を通知する。
        // languagePair ("ja-en" 形式) から targetLang を抽出、無ければ callerLanguage を fallback に使う。
        val targetLang = languagePair.split("-").lastOrNull() ?: callerLanguage
        CallBridgeModule.emitIncomingCall(
            uuid = uuid,
            callerId = callerId,
            callerName = callerName,
            callerTrancallId = callerTrancallId,
            roomId = roomId,
            sourceLang = callerLanguage,
            targetLang = targetLang,
        )
    }

    /**
     * EAS Secrets 経由でビルド時注入された HMAC 共有鍵を取得する。
     * BuildConfig.TRANCALL_PUSH_HMAC_SECRET に注入されている想定。
     * アプリ起動時に EncryptedSharedPreferences へ書き込んで encrypted at rest 保管。
     *
     * 返値が null の場合はシークレット未設定 (開発環境 / 設定漏れ)。
     */
    private fun getHmacSecret(): String? {
        // EncryptedSharedPreferences から取得する実装は Sprint 3 Phase 1a で完成予定
        // ここでは BuildConfig からのフォールバックを返す
        return try {
            val buildConfig = Class.forName("${packageName}.BuildConfig")
            val field = buildConfig.getField("TRANCALL_PUSH_HMAC_SECRET")
            val value = field.get(null) as? String
            if (value.isNullOrBlank()) null else value
        } catch (_: Exception) {
            null
        }
    }
}
