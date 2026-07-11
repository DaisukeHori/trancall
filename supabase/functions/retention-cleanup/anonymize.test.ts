/**
 * anonymize.ts (Deno edge function 版) のユニットテスト
 *
 * 検証項目:
 * - 決定論性: 同一 userId + salt で常に同一の UUID が生成される
 * - 一意性: 異なる userId は異なる UUID になる
 * - UUID v4 形式: RFC 4122 準拠の形式であること
 * - salt が変わると結果が変わること
 * - ⚠️ ゴールデンベクタ (parity テスト):
 *   apps/server/src/__tests__/anonymize.test.ts の同名テストと同じ入力・
 *   同じ期待値を検証する。どちらかの実装がドリフトした場合、該当ランタイム
 *   側のテストが先に失敗して検知できる。
 *
 * 実行: deno test supabase/functions/retention-cleanup/anonymize.test.ts
 */

import { assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveAnonymizedUserId } from "./anonymize.ts";

const SALT = "test-anonymize-salt-minimum-32chars!";
const USER_ID_A = "11111111-1111-4111-8111-111111111111";
const USER_ID_B = "22222222-2222-4222-8222-222222222222";

Deno.test("deriveAnonymizedUserId: 同一 userId + salt で常に同じ UUID を返す (決定論性)", async () => {
  const result1 = await deriveAnonymizedUserId(USER_ID_A, SALT);
  const result2 = await deriveAnonymizedUserId(USER_ID_A, SALT);
  assertEquals(result1, result2);
});

Deno.test("deriveAnonymizedUserId: 異なる userId は異なる UUID を生成する (衝突なし)", async () => {
  const resultA = await deriveAnonymizedUserId(USER_ID_A, SALT);
  const resultB = await deriveAnonymizedUserId(USER_ID_B, SALT);
  assertNotEquals(resultA, resultB);
});

Deno.test("deriveAnonymizedUserId: UUID v4 形式 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx) に準拠する", async () => {
  const result = await deriveAnonymizedUserId(USER_ID_A, SALT);
  assertMatch(result, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

Deno.test("deriveAnonymizedUserId: 同じ userId でも salt が変わると異なる UUID を生成する", async () => {
  const result1 = await deriveAnonymizedUserId(USER_ID_A, SALT);
  const result2 = await deriveAnonymizedUserId(USER_ID_A, "different-salt-minimum-32chars!!!!");
  assertNotEquals(result1, result2);
});

Deno.test("deriveAnonymizedUserId: 元の userId とは異なる UUID を生成する", async () => {
  const result = await deriveAnonymizedUserId(USER_ID_A, SALT);
  assertNotEquals(result, USER_ID_A);
});

Deno.test("deriveAnonymizedUserId: ゴールデンベクタ: 既知の入力から既知の UUID を生成する (apps/server 版との parity 用)", async () => {
  assertEquals(await deriveAnonymizedUserId(USER_ID_A, SALT), "373a5bfc-ff2b-48de-949d-9bdcb9b1717b");
  assertEquals(await deriveAnonymizedUserId(USER_ID_B, SALT), "c53b5907-347e-45a3-a8d5-fe91f70c37a1");
});
