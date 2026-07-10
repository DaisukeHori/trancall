/**
 * anonymize.ts — per-user 決定論的匿名化 UUID 生成
 *
 * 案 1 (採用): SHA-256(originalUserId || salt) を UUID v4 形式に整形。
 * 同一ユーザーは常に同じ匿名 UUID にマッピングされるため、
 * user_consents の UNIQUE(user_id, scope, version) 制約に違反しない。
 *
 * 参照: docs/account-deletion.md §TODO (T-29) 対処案 1
 * salt: 環境変数 ANONYMIZE_SALT (32 文字以上) で設定
 */

import { createHash } from "node:crypto";
import type { UserId } from "@trancall/shared-kernel";
import { brandUserId } from "@trancall/shared-kernel";

/**
 * per-user 決定論的匿名化 UUID を生成する。
 *
 * @param userId  元のユーザー UUID
 * @param salt    環境変数 ANONYMIZE_SALT の値 (32 文字以上)
 * @returns       UUID v4 形式の匿名化 UserId
 *
 * アルゴリズム:
 *   1. SHA-256(userId + salt) を計算 (32 バイト = 64 hex 文字)
 *   2. 先頭 16 バイト (32 hex 文字) を使用
 *   3. UUID v4 フォーマット (8-4-4-4-12) に整形
 *   4. variant bits (バイト 8 の上位 2 ビット = 10) および
 *      version bits (バイト 6 の上位 4 ビット = 0100) を RFC 4122 準拠に固定
 */
export function deriveAnonymizedUserId(userId: UserId, salt: string): UserId {
  const hash = createHash("sha256")
    .update(userId + salt)
    .digest("hex");

  // 先頭 32 hex 文字 (16 バイト) を使用
  const hex = hash.slice(0, 32);

  // UUID v4 の version / variant ビットを埋め込む
  const b0 = hex.slice(0, 8);
  const b1 = hex.slice(8, 12);
  // version 4: バイト 6 の上位 4 ビットを 0100 に設定
  const b2 = "4" + hex.slice(13, 16);
  // variant 10xx: バイト 8 の上位 2 ビットを 10 に設定 (8, 9, a, b のいずれか)
  // hex は 32 文字 (sha256 の先頭 16 バイト) 確定のため charAt(16) は必ず有効な文字を返す
  const variantHex = (parseInt(hex.charAt(16), 16) & 0x3) | 0x8;
  const b3 = variantHex.toString(16) + hex.slice(17, 20);
  const b4 = hex.slice(20, 32);

  const uuidStr = `${b0}-${b1}-${b2}-${b3}-${b4}`;

  const result = brandUserId(uuidStr);
  if (!result.success) {
    // 上記のビット操作が正しければこの分岐には入らない
    throw new Error(`[anonymize] UUID 生成に失敗しました: ${uuidStr}`);
  }
  return result.data;
}
