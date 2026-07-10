/**
 * permission-store — ランタイム権限拒否状態の管理
 *
 * #32: マイク (expo-audio) / 通知 (expo-notifications) の runtime 権限要求結果を保持し、
 * 拒否時に root-navigator.tsx の Permission*Screen フォールバック UI を表示するトリガーになる。
 *
 * canonical: docs/legal-and-consent.md §6.5 (PERMISSION_MICROPHONE_DENIED /
 *            PERMISSION_NOTIFICATION_DENIED / PERMISSION_TELECOM_REVOKED)
 */
import { create } from "zustand";

export type DeniedPermission = "microphone" | "notifications" | "manage_own_calls";

export interface PermissionStoreState {
  deniedPermission: DeniedPermission | null;
  setDeniedPermission: (permission: DeniedPermission) => void;
  clearDeniedPermission: () => void;
}

export const usePermissionStore = create<PermissionStoreState>()((set) => ({
  deniedPermission: null,

  setDeniedPermission: (permission) => {
    set({ deniedPermission: permission });
  },

  clearDeniedPermission: () => {
    set({ deniedPermission: null });
  },
}));

export const selectDeniedPermission = (s: PermissionStoreState): DeniedPermission | null =>
  s.deniedPermission;
