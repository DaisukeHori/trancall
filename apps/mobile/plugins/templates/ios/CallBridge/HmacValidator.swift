import CryptoKit
import Foundation

/// HMAC-SHA256 署名検証ユーティリティ (iOS)
///
/// 設計参照: docs/notification-detail.md §3 (canonical)
///           docs/native-call-bridge.md §12.1
///
/// canonical string 順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt
enum HmacValidator {

    // MARK: - Public API

    /// incoming_call push payload の HMAC 署名を検証する。
    ///
    /// - Parameters:
    ///   - payload: `trancall` キー配下のペイロード辞書
    ///   - secret:  共有鍵 `TRANCALL_PUSH_HMAC_SECRET` (32 文字以上)
    /// - Returns: 署名が正当であれば `true`、不正・欠損・型不一致の場合は `false`
    static func validateCallPayload(payload: [String: Any], secret: String) -> Bool {
        // 必須フィールドを取り出す
        guard
            let type_          = payload["type"]             as? String,
            let uuid           = payload["uuid"]             as? String,
            let roomId         = payload["roomId"]           as? String,
            let callerId       = payload["callerId"]         as? String,
            let callerTrancallId = payload["callerTrancallId"] as? String,
            let issuedAt       = payload["issuedAt"]         as? String,
            let expiresAt      = payload["expiresAt"]        as? String,
            let signature      = payload["signature"]        as? String
        else {
            return false
        }

        // canonical string 組立 (notification-detail.md §3.2)
        let canonical = [type_, uuid, roomId, callerId, callerTrancallId, issuedAt, expiresAt]
            .joined(separator: "|")

        guard let keyData = secret.data(using: .utf8) else { return false }
        let key = SymmetricKey(data: keyData)

        // 受信 signature (64 文字 lowercase hex) を Data に変換
        guard let receivedMacBytes = hexToData(signature) else { return false }

        // CryptoKit の isValidAuthenticationCode で constant-time 比較
        // (手動の == / byte ループは short-circuit リスクがあるため不採用)
        return HMAC<SHA256>.isValidAuthenticationCode(
            receivedMacBytes,
            authenticating: Data(canonical.utf8),
            using: key
        )
    }

    // MARK: - Private helpers

    /// 小文字 hex 文字列 ("a1b2...") を Data に変換。
    /// 奇数長や非 hex 文字が含まれる場合は nil を返す。
    private static func hexToData(_ hex: String) -> Data? {
        guard hex.count % 2 == 0 else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            let byteString = hex[index..<nextIndex]
            guard let byte = UInt8(byteString, radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        return data
    }
}
