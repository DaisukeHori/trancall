/**
 * anonymize.ts (Deno edge function 版) — per-user 決定論的匿名化 UUID 生成
 *
 * ⚠️ apps/server/src/lib/anonymize.ts の deriveAnonymizedUserId と
 *    同一ロジックを維持すること。Deno edge function ランタイムは
 *    monorepo の Node.js 側コード (apps/server) を直接 import できないため、
 *    やむを得ず実装を分離しているが、アルゴリズムは完全に一致させる必要がある。
 *    (両実装のゴールデンベクタは apps/server/src/__tests__/anonymize.test.ts と
 *     supabase/functions/retention-cleanup/anonymize.test.ts で相互に検証している)
 *
 * 案 1 (採用): SHA-256(originalUserId || salt) を UUID v4 形式に整形。
 * 同一ユーザーは常に同じ匿名 UUID にマッピングされるため、
 * user_consents の UNIQUE(user_id, scope, version) 制約に違反しない。
 *
 * 参照: docs/account-deletion.md §TODO (T-29) 対処案 1
 * salt: 環境変数 ANONYMIZE_SALT (32 文字以上) で設定
 */

/**
 * per-user 決定論的匿名化 UUID を生成する (案 1 採用)。
 * SHA-256(userId + salt) の先頭 16 バイトを UUID v4 形式に整形する。
 * 同一 userId は常に同じ UUID になるため UNIQUE(user_id, scope, version) 制約を保持。
 * docs/account-deletion.md §TODO (T-29) 対処案 1
 */
export async function deriveAnonymizedUserId(userId: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // 先頭 32 hex 文字 (16 バイト) を使用
  const b0 = hex.slice(0, 8);
  const b1 = hex.slice(8, 12);
  // version 4: バイト 6 の上位 4 ビットを 0100 に設定
  const b2 = "4" + hex.slice(13, 16);
  // variant 10xx: バイト 8 の上位 2 ビットを 10 に設定 (8, 9, a, b のいずれか)
  const variantNibble = (parseInt(hex[16]!, 16) & 0x3) | 0x8;
  const b3 = variantNibble.toString(16) + hex.slice(17, 20);
  const b4 = hex.slice(20, 32);

  return `${b0}-${b1}-${b2}-${b3}-${b4}`;
}
