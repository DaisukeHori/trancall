/**
 * hmac-validator.test.ts
 *
 * HmacValidator TypeScript ラッパーのユニットテスト。
 *
 * - setHmacValidatorNativeModule で mock を注入し validateCallPayload が呼ばれることを検証
 * - Node crypto.createHmac で reference signature を生成し canonical string 順序を確認
 * - native module 未実装時 (Expo Go) に false を返す fallback を確認
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";

// HmacValidator.ts は expo-modules-core (requireOptionalNativeModule) を静的 import する。
// expo-modules-core は内部で "react-native" を transitively import しており、
// vitest (node 環境、RN レンダリング無し) では実 react-native パッケージのロードが
// Flow 構文 (`import typeof`) のパースエラーになるため wholesale mock する
// (既存 incoming-call-push.test.ts / permissions.test.ts と同じ方針)。
// expo-modules-core の実パッケージは JSI (native runtime) が注入する `globalThis.expo` に
// 依存しており、vitest (node 環境、RN/JSI 無し) では読み込めない。
// requireOptionalNativeModule のみを持つ薄い mock に差し替える
// (native module 未リンク環境と同じ挙動 = null を返す、既存 callkit/voip-push テストと同方針)。
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import {
  validateCallPayload,
  setHmacValidatorNativeModule,
} from "../src/native/HmacValidator.js";
import type { HmacValidatorNativeModule } from "../src/native/HmacValidator.js";

// MARK: - Mock factory

function makeMockNativeModule(): HmacValidatorNativeModule & {
  validateCallPayload: ReturnType<typeof vi.fn>;
} {
  return {
    validateCallPayload: vi.fn<() => Promise<boolean>>(),
  };
}

let mockModule: ReturnType<typeof makeMockNativeModule>;

beforeEach(() => {
  mockModule = makeMockNativeModule();
  setHmacValidatorNativeModule(mockModule);
});

afterEach(() => {
  setHmacValidatorNativeModule(null);
});

// MARK: - Reference signature generator (Node.js crypto)

/**
 * canonical string を組み立て HMAC-SHA256 (hex) を計算する。
 * notification-detail.md §3.2 §3.3 の canonical 実装。
 */
function computeReferenceSignature(
  fields: {
    type: string;
    uuid: string;
    roomId: string;
    callerId: string;
    callerTrancallId: string;
    issuedAt: string;
    expiresAt: string;
  },
  secret: string,
): string {
  const canonical = [
    fields.type,
    fields.uuid,
    fields.roomId,
    fields.callerId,
    fields.callerTrancallId,
    fields.issuedAt,
    fields.expiresAt,
  ].join("|");

  return crypto
    .createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");
}

// MARK: - Test fixtures

const SECRET = "my-super-secret-key-for-testing-hmac-32";

const VALID_PAYLOAD_FIELDS = {
  type: "incoming_call",
  uuid: "fe2b8410-3a72-44f0-8d3a-2f6b3c9e1d77",
  roomId: "550e8400-e29b-41d4-a716-446655440000",
  callerId: "u_abc123",
  callerTrancallId: "@johnwang_sf",
  issuedAt: "2026-05-11T10:00:00.000Z",
  expiresAt: "2026-05-11T10:00:30.000Z",
} as const;

// reference signature (Node.js crypto で計算)
const VALID_SIGNATURE = computeReferenceSignature(VALID_PAYLOAD_FIELDS, SECRET);

function makeValidPayload(): Record<string, unknown> {
  return {
    ...VALID_PAYLOAD_FIELDS,
    callerName: "John Wang",
    callerAvatarUrl: "https://example.com/avatar.png",
    roomType: "audio",
    translationEnabled: true,
    languagePair: "en-ja",
    callerLanguage: "en",
    signature: VALID_SIGNATURE,
  };
}

// MARK: - Tests

describe("HmacValidator TypeScript wrapper", () => {
  // ---- Native module 呼び出し確認 ----

  it("setHmacValidatorNativeModule で注入した module の validateCallPayload が呼ばれること", async () => {
    mockModule.validateCallPayload.mockResolvedValue(true);

    const payload = makeValidPayload();
    const result = await validateCallPayload(payload, SECRET);

    expect(mockModule.validateCallPayload).toHaveBeenCalledOnce();
    expect(mockModule.validateCallPayload).toHaveBeenCalledWith(payload, SECRET);
    expect(result).toBe(true);
  });

  it("native module が false を返した場合 wrapper も false を返すこと", async () => {
    mockModule.validateCallPayload.mockResolvedValue(false);

    const payload = makeValidPayload();
    const result = await validateCallPayload(payload, SECRET);

    expect(result).toBe(false);
  });

  // ---- Expo Go fallback ----

  it("native module 未注入 (Expo Go) 時に false を返すこと", async () => {
    setHmacValidatorNativeModule(null);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const payload = makeValidPayload();
    const result = await validateCallPayload(payload, SECRET);

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("TranCallBridge native module is not available"),
    );
    consoleSpy.mockRestore();
  });

  // ---- canonical string 順序確認 (Node crypto reference) ----

  it("canonical string 順序: type|uuid|roomId|callerId|callerTrancallId|issuedAt|expiresAt", () => {
    const fields = VALID_PAYLOAD_FIELDS;
    const canonical = [
      fields.type,
      fields.uuid,
      fields.roomId,
      fields.callerId,
      fields.callerTrancallId,
      fields.issuedAt,
      fields.expiresAt,
    ].join("|");

    const sig = crypto.createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");

    // 64 文字の lowercase hex であること
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // reference と一致すること
    expect(sig).toBe(VALID_SIGNATURE);
  });

  it("フィールド順序が変わると signature が変わること (canonical string 順序確認)", () => {
    // callerTrancallId と callerId を入れ替えた signature は異なるはず
    const wrongOrderCanonical = [
      VALID_PAYLOAD_FIELDS.type,
      VALID_PAYLOAD_FIELDS.uuid,
      VALID_PAYLOAD_FIELDS.roomId,
      VALID_PAYLOAD_FIELDS.callerTrancallId, // ← 入れ替え
      VALID_PAYLOAD_FIELDS.callerId,         // ← 入れ替え
      VALID_PAYLOAD_FIELDS.issuedAt,
      VALID_PAYLOAD_FIELDS.expiresAt,
    ].join("|");

    const wrongSig = crypto
      .createHmac("sha256", SECRET)
      .update(wrongOrderCanonical, "utf8")
      .digest("hex");

    expect(wrongSig).not.toBe(VALID_SIGNATURE);
  });

  it("表示用フィールド (callerName 等) は signature に影響しないこと", () => {
    // callerName を変えても canonical フィールドは同じなので signature は同じ
    const sig = computeReferenceSignature(
      { ...VALID_PAYLOAD_FIELDS }, // 同じ canonical フィールド
      SECRET,
    );
    expect(sig).toBe(VALID_SIGNATURE);
  });

  it("secret が違うと signature が変わること", () => {
    const differentSig = computeReferenceSignature(VALID_PAYLOAD_FIELDS, "different-secret-key-xyz");
    expect(differentSig).not.toBe(VALID_SIGNATURE);
  });

  // ---- payload pairs での signature 比較 ----

  it("正しい secret と payload の組み合わせで signature が一致すること", () => {
    const sig = computeReferenceSignature(VALID_PAYLOAD_FIELDS, SECRET);
    expect(sig).toBe(VALID_SIGNATURE);
    expect(sig).toHaveLength(64);
  });

  it("expiresAt が変わると signature が変わること (リプレイ攻撃に対し TTL が署名対象に含まれること)", () => {
    const sig = computeReferenceSignature(
      { ...VALID_PAYLOAD_FIELDS, expiresAt: "2026-05-11T10:01:00.000Z" },
      SECRET,
    );
    expect(sig).not.toBe(VALID_SIGNATURE);
  });

  it("uuid が変わると signature が変わること", () => {
    const sig = computeReferenceSignature(
      { ...VALID_PAYLOAD_FIELDS, uuid: "00000000-0000-0000-0000-000000000001" },
      SECRET,
    );
    expect(sig).not.toBe(VALID_SIGNATURE);
  });
});
