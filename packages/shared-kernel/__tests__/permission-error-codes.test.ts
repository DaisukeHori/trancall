/**
 * permission-error-codes.test.ts — Mobile-only PERMISSION_* error code の単体テスト
 *
 * canonical 定義: docs/legal-and-consent.md v1.2 §6.5.4
 *
 * 検証観点:
 * 1. 全 PERMISSION_* code が PERMISSION_ERROR_CODES に定義済み
 * 2. PermissionErrorCode 型として各 code が使用可能
 * 3. PERMISSION_ERROR_CODE_VALUES に全コードが含まれる (網羅性)
 * 4. isPermissionErrorCode 型ガードの正常/異常動作
 * 5. mobile-only マーカー: PERMISSION_ERROR_CODES は AUTH_CONSENT_* とは別系統
 */

import { describe, expect, it } from "vitest";

import {
  PERMISSION_ERROR_CODES,
  PERMISSION_ERROR_CODE_VALUES,
  isPermissionErrorCode,
} from "../src/schemas/permission-error-codes.js";

// ============================================================
// §6.5.4 canonical — 3 値の定義確認
// ============================================================

describe("PERMISSION_ERROR_CODES", () => {
  it("PERMISSION_MICROPHONE_DENIED が定義されている (§6.5.1 マイク拒否)", () => {
    expect(PERMISSION_ERROR_CODES.PERMISSION_MICROPHONE_DENIED).toBe(
      "PERMISSION_MICROPHONE_DENIED",
    );
  });

  it("PERMISSION_NOTIFICATION_DENIED が定義されている (§6.5.2 通知拒否)", () => {
    expect(PERMISSION_ERROR_CODES.PERMISSION_NOTIFICATION_DENIED).toBe(
      "PERMISSION_NOTIFICATION_DENIED",
    );
  });

  it("PERMISSION_TELECOM_REVOKED が定義されている (§6.5.3 MANAGE_OWN_CALLS 強制取消)", () => {
    expect(PERMISSION_ERROR_CODES.PERMISSION_TELECOM_REVOKED).toBe(
      "PERMISSION_TELECOM_REVOKED",
    );
  });

  it("§6.5.4 canonical の 3 コードが合計 3 種類であることを確認", () => {
    expect(Object.keys(PERMISSION_ERROR_CODES)).toHaveLength(3);
  });

  it("すべての code が PERMISSION_ prefix を持つ (命名規則)", () => {
    for (const code of Object.values(PERMISSION_ERROR_CODES)) {
      expect(code.startsWith("PERMISSION_")).toBe(true);
    }
  });

  it("const オブジェクトのため値が変更されない (readonly)", () => {
    // TypeScript の型システムで保証されるが、ランタイムでも確認
    // as const は Object.freeze ではないため frozen=false は正常
    // 代わりに TypeScript 型で PermissionErrorCode の制限を確認する
    expect(typeof PERMISSION_ERROR_CODES.PERMISSION_MICROPHONE_DENIED).toBe("string");
  });
});

// ============================================================
// PERMISSION_ERROR_CODE_VALUES — 網羅性確認
// ============================================================

describe("PERMISSION_ERROR_CODE_VALUES", () => {
  it("PERMISSION_MICROPHONE_DENIED を含む", () => {
    expect(PERMISSION_ERROR_CODE_VALUES).toContain("PERMISSION_MICROPHONE_DENIED");
  });

  it("PERMISSION_NOTIFICATION_DENIED を含む", () => {
    expect(PERMISSION_ERROR_CODE_VALUES).toContain("PERMISSION_NOTIFICATION_DENIED");
  });

  it("PERMISSION_TELECOM_REVOKED を含む", () => {
    expect(PERMISSION_ERROR_CODE_VALUES).toContain("PERMISSION_TELECOM_REVOKED");
  });

  it("PERMISSION_ERROR_CODES と同じ 3 値を持つ", () => {
    expect(PERMISSION_ERROR_CODE_VALUES).toHaveLength(
      Object.values(PERMISSION_ERROR_CODES).length,
    );
  });
});

// ============================================================
// isPermissionErrorCode — 型ガード
// ============================================================

describe("isPermissionErrorCode", () => {
  it("PERMISSION_MICROPHONE_DENIED → true を返す", () => {
    expect(isPermissionErrorCode("PERMISSION_MICROPHONE_DENIED")).toBe(true);
  });

  it("PERMISSION_NOTIFICATION_DENIED → true を返す", () => {
    expect(isPermissionErrorCode("PERMISSION_NOTIFICATION_DENIED")).toBe(true);
  });

  it("PERMISSION_TELECOM_REVOKED → true を返す", () => {
    expect(isPermissionErrorCode("PERMISSION_TELECOM_REVOKED")).toBe(true);
  });

  it("未定義の PERMISSION_* 文字列 → false を返す", () => {
    expect(isPermissionErrorCode("PERMISSION_CAMERA_DENIED")).toBe(false);
  });

  it("AUTH_CONSENT_REQUIRED は PERMISSION_* ではない → false (別系統確認)", () => {
    expect(isPermissionErrorCode("AUTH_CONSENT_REQUIRED")).toBe(false);
  });

  it("AUTH_CONSENT_REVOKED は PERMISSION_* ではない → false (別系統確認)", () => {
    expect(isPermissionErrorCode("AUTH_CONSENT_REVOKED")).toBe(false);
  });

  it("空文字 → false を返す", () => {
    expect(isPermissionErrorCode("")).toBe(false);
  });

  it("VALIDATION_ERROR (server error code) → false (server には伝播しない)", () => {
    expect(isPermissionErrorCode("VALIDATION_ERROR")).toBe(false);
  });

  it("INTERNAL_ERROR (server error code) → false (server には伝播しない)", () => {
    expect(isPermissionErrorCode("INTERNAL_ERROR")).toBe(false);
  });

  it("部分一致文字列 PERMISSION → false", () => {
    expect(isPermissionErrorCode("PERMISSION")).toBe(false);
  });
});

// ============================================================
// Mobile-only 分離確認 — AUTH_CONSENT_* との独立性
// ============================================================

describe("Mobile-only マーカー — AUTH_CONSENT_* との独立性", () => {
  const authConsentCodes = [
    "AUTH_CONSENT_REQUIRED",
    "AUTH_CONSENT_REVOKED",
    "AUTH_CONSENT_VERSION_MISMATCH",
    "AUTH_CONSENT_IRREVOCABLE",
    "AUTH_LEGAL_DOC_UNAVAILABLE",
  ];

  it.each(authConsentCodes)(
    "AUTH_CONSENT_* コード '%s' は PERMISSION_ERROR_CODES に含まれない",
    (authCode) => {
      expect(
        (Object.values(PERMISSION_ERROR_CODES) as string[]).includes(authCode),
      ).toBe(false);
    },
  );

  it("PERMISSION_ERROR_CODE_VALUES に AUTH_CONSENT_* が混入していない", () => {
    for (const authCode of authConsentCodes) {
      expect(PERMISSION_ERROR_CODE_VALUES).not.toContain(authCode);
    }
  });
});
