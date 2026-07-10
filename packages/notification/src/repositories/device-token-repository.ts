/**
 * デバイストークンリポジトリ インターフェース
 *
 * 本番実装 (Supabase) はこのインターフェースを満たすクラスとして注入する。
 * テストでは in-memory 実装を使用する。
 */

import type { Result } from "@trancall/shared-kernel";
import type { UserId } from "@trancall/shared-kernel";

import type { DeviceTokenRow, NotificationTarget } from "../schemas";

export interface DeviceTokenRepository {
  /**
   * デバイストークンを登録・更新する。
   * UNIQUE(platform, token) 制約に基づき既存行を upsert する。
   */
  upsert(
    userId: UserId,
    target: NotificationTarget,
  ): Promise<Result<DeviceTokenRow>>;

  /**
   * 指定ユーザーの指定プラットフォームのトークンをすべて取得する。
   * is_active = true のものだけ返す。
   */
  findActiveByUserId(
    userId: UserId,
    platform?: "ios" | "android",
  ): Promise<Result<DeviceTokenRow[]>>;

  /**
   * トークンを無効化する（APNs 410 Gone や FCM UNREGISTERED 受信時）。
   */
  revoke(
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true>>;

  /**
   * ユーザーの特定プラットフォームのトークンを削除する（ログアウト時）。
   */
  delete(
    userId: UserId,
    platform: "ios" | "android",
    token: string,
  ): Promise<Result<true>>;
}
