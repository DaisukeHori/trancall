/**
 * use-notification-permission.ts — アプリ起動時の通知権限要求
 *
 * #32: expo-notifications の runtime 権限要求を適切なライフサイクル (アプリ起動時) で実行する。
 * 拒否された場合は permission-store に記録し、root-navigator.tsx の
 * PermissionNotificationsScreen (ソフトバナー) を表示するトリガーにする。
 */
import { useEffect } from "react";
import { ensureNotificationPermission } from "../lib/permissions/index";
import { usePermissionStore } from "../stores/permission-store";

export function useNotificationPermissionRequest(): void {
  const setDeniedPermission = usePermissionStore((state) => state.setDeniedPermission);

  useEffect(() => {
    let cancelled = false;

    void ensureNotificationPermission().then((granted) => {
      if (!cancelled && !granted) {
        setDeniedPermission("notifications");
      }
    });

    return () => {
      cancelled = true;
    };
    // 依存配列は意図的に [] (マウント時に一度だけ実行する)
  }, []);
}
