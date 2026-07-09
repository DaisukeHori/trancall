import CryptoKit
import Foundation
import PushKit
import CallKit

/// VoIP Push (PushKit) 受信デリゲート実装
///
/// 設計参照: docs/notification-detail.md §1.1 (受信処理手順)
///           docs/native-call-bridge.md §4 / §12.1
///
/// iOS 13+ 制約: didReceiveIncomingPushWith から 5 秒以内に
/// CXProvider.reportNewIncomingCall を呼ばないとプロセスが強制終了される。
/// そのため HMAC 検証 (CryptoKit) と expiresAt 検証を同期で完了し、
/// OK の場合のみ直ちに reportNewIncomingCall を呼ぶ。
class PushKitDelegate: NSObject, PKPushRegistryDelegate {

    private let provider: CXProvider
    private let hmacSecret: String

    /// - Parameters:
    ///   - provider:    CXProvider インスタンス (設定済み)
    ///   - hmacSecret:  共有鍵 `TRANCALL_PUSH_HMAC_SECRET` (expo-secure-store から取得)
    init(provider: CXProvider, hmacSecret: String) {
        self.provider = provider
        self.hmacSecret = hmacSecret
    }

    // MARK: - PKPushRegistryDelegate

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        defer { completion() }

        guard type == .voIP else { return }

        // ① trancall キーを取り出す (notification-detail.md §1)
        guard let trancall = payload.dictionaryPayload["trancall"] as? [String: Any] else {
            print("[PushKitDelegate] Missing trancall key — dropping")
            return
        }

        // ② expiresAt 検証 (リプレイ攻撃対策、30 秒 TTL)
        guard let expiresAtString = trancall["expiresAt"] as? String,
              let expiresAt = iso8601Date(from: expiresAtString) else {
            print("[PushKitDelegate] Missing or invalid expiresAt — dropping")
            return
        }
        guard expiresAt > Date() else {
            print("[PushKitDelegate] Payload expired at \(expiresAtString) — dropping")
            return
        }

        // ③ HMAC 署名検証 (CryptoKit constant-time 比較)
        guard HmacValidator.validateCallPayload(payload: trancall, secret: hmacSecret) else {
            print("[PushKitDelegate] HMAC verification failed — dropping")
            return
        }

        // ④ 必須フィールドを取り出す
        guard
            let uuidString       = trancall["uuid"]             as? String,
            let callUUID         = UUID(uuidString: uuidString),
            let callerName       = trancall["callerName"]       as? String,
            let callerTrancallId = trancall["callerTrancallId"] as? String
        else {
            print("[PushKitDelegate] Missing required display fields — dropping")
            return
        }

        // ⑤ CallKit に投入 (5 秒以内厳守)
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerTrancallId)
        update.localizedCallerName = callerName
        update.hasVideo = false

        provider.reportNewIncomingCall(with: callUUID, update: update) { error in
            if let error = error {
                print("[PushKitDelegate] reportNewIncomingCall error: \(error.localizedDescription)")
            }
        }
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        // VoIP token をサーバーに登録する処理は NotificationFacade 経由で実施
        // (実装は packages/notification 側のアダプタが担う)
        guard type == .voIP else { return }
        let token = pushCredentials.token
            .map { String(format: "%02.2hhx", $0) }
            .joined()
        print("[PushKitDelegate] VoIP token updated: \(token)")
        // TODO: JS bridge 経由でトークンをサーバーに通知する (Sprint 3 Phase 1a)
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didInvalidatePushTokenFor type: PKPushType
    ) {
        guard type == .voIP else { return }
        print("[PushKitDelegate] VoIP push token invalidated")
    }

    // MARK: - Helpers

    private func iso8601Date(from string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string)
    }
}
