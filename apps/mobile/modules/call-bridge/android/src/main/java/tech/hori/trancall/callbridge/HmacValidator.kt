// ⚠️ device-verification-required: Android Studio / 実機ビルドで一度も検証していない。
package tech.hori.trancall.callbridge

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HMAC-SHA256 署名検証ユーティリティ (Android, call-bridge module 版)
 *
 * 設計参照: docs/notification-detail.md §3 (canonical)
 *           docs/native-call-bridge.md §12.1
 *
 * canonical string 順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
 *
 * 注意 (コード重複の理由): `apps/mobile/android/app/src/main/java/tech/hori/trancall/HmacValidator.kt`
 * (app module, FcmService.kt が使用) と同一ロジックのコピー。Gradle library module は app module に
 * 依存されるだけで app module 側のクラスを参照できない (逆方向依存はビルド不可) ため、
 * JS の HmacValidator.ts から CallBridgeModule.validateCallPayload 経由で呼べるようにするには
 * このモジュール内に同じ検証ロジックを複製する必要がある。ロジック変更時は両ファイルを同期すること。
 */
object HmacValidator {

    fun validateCallPayload(payload: Map<String, Any?>, secret: String): Boolean {
        val type_ = payload["type"] as? String ?: return false
        val uuid = payload["uuid"] as? String ?: return false
        val roomId = payload["roomId"] as? String ?: return false
        val callerId = payload["callerId"] as? String ?: return false
        val callerTrancallId = payload["callerTrancallId"] as? String ?: return false
        val issuedAt = payload["issuedAt"] as? String ?: return false
        val expiresAt = payload["expiresAt"] as? String ?: return false
        val signature = payload["signature"] as? String ?: return false

        val canonical = listOf(type_, uuid, roomId, callerId, callerTrancallId, issuedAt, expiresAt)
            .joinToString("|")

        val mac = Mac.getInstance("HmacSHA256")
        val secretKeySpec = SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(secretKeySpec)
        val computedBytes: ByteArray = mac.doFinal(canonical.toByteArray(Charsets.UTF_8))

        val receivedBytes: ByteArray = hexToBytes(signature) ?: return false

        return MessageDigest.isEqual(computedBytes, receivedBytes)
    }

    private fun hexToBytes(hex: String): ByteArray? {
        if (hex.length % 2 != 0) return null
        return try {
            ByteArray(hex.length / 2) { i ->
                hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
        } catch (_: NumberFormatException) {
            null
        }
    }
}
