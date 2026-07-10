/**
 * lib/permissions — マイク / 通知 runtime 権限要求
 *
 * #32: expo-audio (マイク) / expo-notifications (通知) の runtime 権限要求フロー。
 * canonical: docs/legal-and-consent.md §6.5 (PERMISSION_MICROPHONE_DENIED /
 *            PERMISSION_NOTIFICATION_DENIED / PERMISSION_TELECOM_REVOKED)
 *
 * Expo Go / native module 未リンク環境では expo-audio / expo-notifications の
 * native call が reject する可能性があるため、必ず try-catch し安全側 (未許可) に倒す。
 */
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import * as Notifications from "expo-notifications";

/**
 * マイク権限を確認し、未許可なら要求する。
 * 既に許可済みなら request を呼ばずに true を返す (無駄なダイアログを出さない)。
 *
 * @returns 許可されていれば true
 */
export async function ensureMicrophonePermission(): Promise<boolean> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;

    const result = await requestRecordingPermissionsAsync();
    return result.granted;
  } catch (error) {
    console.warn("[permissions] microphone permission check failed", error);
    return false;
  }
}

/**
 * 通知権限を確認し、未許可なら要求する。
 * 着信 VoIP push を OS レベルで受け取るために起動時に要求する
 * (iOS は PushKit 経路のため実際は必須ではないが、Android FCM の
 * heads-up 通知表示や「翻訳完了」等の一般通知には必要)。
 *
 * @returns 許可されていれば true
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;

    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return result.granted;
  } catch (error) {
    console.warn("[permissions] notification permission check failed", error);
    return false;
  }
}
