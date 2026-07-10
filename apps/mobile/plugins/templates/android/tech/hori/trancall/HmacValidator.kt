package tech.hori.trancall

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HMAC-SHA256 署名検証ユーティリティ (Android)
 *
 * 設計参照: docs/notification-detail.md §3 (canonical)
 *           docs/native-call-bridge.md §12.1
 *
 * canonical string 順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
 */
object HmacValidator {

    /**
     * incoming_call push payload の HMAC 署名を検証する。
     *
     * @param payload FCM `remoteMessage.data` の Map<String, Any> (または [String: String] を Any でラップ)
     * @param secret  共有鍵 `TRANCALL_PUSH_HMAC_SECRET` (32 文字以上)
     * @return 署名が正当であれば true、不正・欠損・型不一致の場合は false
     */
    fun validateCallPayload(payload: Map<String, Any>, secret: String): Boolean {
        // 必須フィールドを取り出す
        val type_           = payload["type"]             as? String ?: return false
        val uuid            = payload["uuid"]             as? String ?: return false
        val roomId          = payload["roomId"]           as? String ?: return false
        val callerId        = payload["callerId"]         as? String ?: return false
        val callerTrancallId = payload["callerTrancallId"] as? String ?: return false
        val issuedAt        = payload["issuedAt"]         as? String ?: return false
        val expiresAt       = payload["expiresAt"]        as? String ?: return false
        val signature       = payload["signature"]        as? String ?: return false

        // canonical string 組立 (notification-detail.md §3.2)
        val canonical = listOf(type_, uuid, roomId, callerId, callerTrancallId, issuedAt, expiresAt)
            .joinToString("|")

        // HMAC-SHA256 計算
        val mac = Mac.getInstance("HmacSHA256")
        val secretKeySpec = SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(secretKeySpec)
        val computedBytes: ByteArray = mac.doFinal(canonical.toByteArray(Charsets.UTF_8))

        // 受信 signature (64 文字 lowercase hex) を ByteArray に変換
        val receivedBytes: ByteArray = hexToBytes(signature) ?: return false

        // MessageDigest.isEqual で constant-time 比較 (Java 6 以降で保証)
        // Arrays.equals や手動ループは short-circuit リスクがあるため不採用
        return MessageDigest.isEqual(computedBytes, receivedBytes)
    }

    /**
     * 小文字 hex 文字列 ("a1b2...") を ByteArray に変換。
     * 奇数長や非 hex 文字が含まれる場合は null を返す。
     */
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
