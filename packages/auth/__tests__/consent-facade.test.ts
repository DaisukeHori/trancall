/**
 * AuthFacade 同意管理メソッド テスト
 *
 * canonical: docs/legal-and-consent.md v1.2 §4 / §15 テスト戦略
 * テスト対象: recordConsent / hasConsent / revokeConsent / getRequiredConsents
 *
 * モック戦略: ConsentRepository / LegalDocumentVersionRepository は
 *            in-memory 実装を使用する。
 */

import { describe, expect, it, vi } from "vitest";

import {
  brandUserId,
  type Result,
  type UserId,
} from "@trancall/shared-kernel";

import {
  type ConsentScope,
  type ConsentRecord,
  type LegalDocumentVersion,
} from "@trancall/shared-kernel";

import { createAuthFacade } from "../src/facade.js";
import { type ConsentRepository } from "../src/repositories/consent-repository.js";
import { type LegalDocumentVersionRepository } from "../src/repositories/legal-document-version-repository.js";
import { type AuthEventBus } from "../src/facade.js";

// ============================================================
// テストヘルパー
// ============================================================

function makeUserId(): UserId {
  const r = brandUserId("00000000-0000-4000-8000-000000000001");
  if (!r.success) throw new Error("test setup: brandUserId failed");
  return r.data;
}

function makeConsentRecord(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    userId: makeUserId(),
    scope: "voice_to_openai",
    version: "2026-05-12",
    recordedAt: "2026-05-12T00:00:00.000Z",
    revokedAt: null,
    ipAddress: null,
    userAgent: null,
    source: "onboarding",
    ...overrides,
  };
}

function makeLegalDocumentVersion(overrides: Partial<LegalDocumentVersion> = {}): LegalDocumentVersion {
  return {
    scope: "legal_terms",
    version: "2026-05-12",
    documentUrl: "https://trancall.app/terms",
    effectiveAt: "2026-05-12T00:00:00.000Z",
    supersedes: null,
    changeSummary: null,
    ...overrides,
  };
}

// ============================================================
// モックファクトリー
// ============================================================

function makeConsentRepo(overrides: Partial<ConsentRepository> = {}): ConsentRepository {
  return {
    upsert: vi.fn<(record: Omit<ConsentRecord, "id">) => Promise<Result<ConsentRecord>>>()
      .mockResolvedValue({ ok: true, data: makeConsentRecord() }),
    findActive: vi.fn<(userId: UserId, scope: ConsentScope) => Promise<Result<ConsentRecord | null>>>()
      .mockResolvedValue({ ok: true, data: null }),
    listActive: vi.fn<(userId: UserId) => Promise<Result<ConsentRecord[]>>>()
      .mockResolvedValue({ ok: true, data: [] }),
    revoke: vi.fn<(userId: UserId, scope: ConsentScope) => Promise<Result<true>>>()
      .mockResolvedValue({ ok: true, data: true }),
    ...overrides,
  };
}

function makeLegalDocRepo(overrides: Partial<LegalDocumentVersionRepository> = {}): LegalDocumentVersionRepository {
  return {
    findLatest: vi.fn<(scope: ConsentScope) => Promise<Result<LegalDocumentVersion | null>>>()
      .mockResolvedValue({ ok: true, data: null }),
    findAllLatest: vi.fn<() => Promise<Result<LegalDocumentVersion[]>>>()
      .mockResolvedValue({ ok: true, data: [] }),
    ...overrides,
  };
}

function makeEventBus(): AuthEventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================
// recordConsent テスト
// ============================================================

describe("AuthFacade.recordConsent", () => {
  it("正常系: 新規同意を記録して ConsentRecord を返す", async () => {
    const userId = makeUserId();
    const expected = makeConsentRecord({ userId, scope: "voice_to_openai", version: "2026-05-12" });
    const consentRepo = makeConsentRepo({
      upsert: vi.fn().mockResolvedValue({ ok: true, data: expected }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "onboarding");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scope).toBe("voice_to_openai");
    expect(result.data.version).toBe("2026-05-12");
    expect(consentRepo.upsert).toHaveBeenCalledOnce();
  });

  it("冪等性: 同一 (userId, scope, version) で再度呼んでも既存レコードを返す", async () => {
    const userId = makeUserId();
    const existingRecord = makeConsentRecord({ userId, scope: "legal_terms", version: "2026-05-12" });
    const consentRepo = makeConsentRepo({
      upsert: vi.fn()
        // 1 回目: 新規作成
        .mockResolvedValueOnce({ ok: true, data: existingRecord })
        // 2 回目: 同一レコード (冪等)
        .mockResolvedValueOnce({ ok: true, data: existingRecord }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result1 = await facade.recordConsent(userId, "legal_terms", "2026-05-12", "onboarding");
    const result2 = await facade.recordConsent(userId, "legal_terms", "2026-05-12", "onboarding");

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    expect(result1.data.id).toBe(result2.data.id);
    expect(consentRepo.upsert).toHaveBeenCalledTimes(2);
  });

  it("EventBus に auth.consent_recorded イベントを発行する", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      upsert: vi.fn().mockResolvedValue({ ok: true, data: makeConsentRecord({ userId }) }),
    });
    const eventBus = makeEventBus();
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      eventBus,
    });

    await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "incoming_call_first_time");

    expect(eventBus.publish).toHaveBeenCalledOnce();
    const publishedEvent = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(publishedEvent?.type).toBe("auth.consent_recorded");
    expect(publishedEvent?.payload.scope).toBe("voice_to_openai");
    expect(publishedEvent?.payload.source).toBe("incoming_call_first_time");
  });

  it("EventBus 発行失敗時もサイレントに処理を完了する", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      upsert: vi.fn().mockResolvedValue({ ok: true, data: makeConsentRecord({ userId }) }),
    });
    const eventBus: AuthEventBus = {
      publish: vi.fn().mockRejectedValue(new Error("EventBus 接続失敗")),
    };
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      eventBus,
    });

    const result = await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "onboarding");

    expect(result.ok).toBe(true);
  });

  it("consentRepo 未設定時は AUTH_CONSENT_NOT_CONFIGURED エラーを返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: { findByUserId: vi.fn() } });

    const result = await facade.recordConsent(userId, "voice_to_openai", "2026-05-12", "onboarding");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_NOT_CONFIGURED");
  });

  it("metadata (ipAddress / userAgent) を ConsentRepository に渡す", async () => {
    const userId = makeUserId();
    const upsertMock = vi.fn().mockResolvedValue({ ok: true, data: makeConsentRecord({ userId }) });
    const consentRepo = makeConsentRepo({ upsert: upsertMock });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    await facade.recordConsent(
      userId,
      "voice_to_openai",
      "2026-05-12",
      "settings_screen",
      { ipAddress: "192.0.2.1", userAgent: "TranCall/1.0" },
    );

    const calledRecord: Omit<ConsentRecord, "id"> = upsertMock.mock.calls[0]?.[0];
    expect(calledRecord?.ipAddress).toBe("192.0.2.1");
    expect(calledRecord?.userAgent).toBe("TranCall/1.0");
  });
});

// ============================================================
// hasConsent テスト
// ============================================================

describe("AuthFacade.hasConsent", () => {
  it("正常系 true: revokedAt IS NULL かつ version 一致", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({
        ok: true,
        data: makeConsentRecord({ userId, scope: "voice_to_openai", version: "2026-05-12" }),
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.hasConsent(userId, "voice_to_openai", "2026-05-12");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(true);
  });

  it("未同意 (findActive が null を返す) → false", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({ ok: true, data: null }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.hasConsent(userId, "voice_to_openai", "2026-05-12");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(false);
  });

  it("バージョン不一致 → false", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({
        ok: true,
        data: makeConsentRecord({
          userId,
          scope: "legal_terms",
          version: "2025-01-01", // 古いバージョン
        }),
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.hasConsent(userId, "legal_terms", "2026-05-12");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe(false);
  });

  it("consentRepo 未設定時はエラーを返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: { findByUserId: vi.fn() } });

    const result = await facade.hasConsent(userId, "voice_to_openai", "2026-05-12");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_NOT_CONFIGURED");
  });

  it("リポジトリエラーはそのまま伝播する", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "AUTH_CONSENT_READ_ERROR", message: "DB 障害", retryable: true },
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.hasConsent(userId, "voice_to_openai", "2026-05-12");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_READ_ERROR");
  });
});

// ============================================================
// revokeConsent テスト
// ============================================================

describe("AuthFacade.revokeConsent", () => {
  it("正常系: 取消可能 scope を取り消せる", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({
        ok: true,
        data: makeConsentRecord({ userId, scope: "voice_to_openai", version: "2026-05-12" }),
      }),
      revoke: vi.fn().mockResolvedValue({ ok: true, data: true }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.revokeConsent(userId, "voice_to_openai");

    expect(result.ok).toBe(true);
  });

  it("legal_terms は取消不可 → AUTH_CONSENT_IRREVOCABLE (422)", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo: makeConsentRepo(),
    });

    const result = await facade.revokeConsent(userId, "legal_terms");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_IRREVOCABLE");
    expect(result.error.httpStatus).toBe(422);
  });

  it("privacy_policy は取消不可 → AUTH_CONSENT_IRREVOCABLE (422)", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo: makeConsentRepo(),
    });

    const result = await facade.revokeConsent(userId, "privacy_policy");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_IRREVOCABLE");
  });

  it("EventBus に auth.consent_revoked イベントを発行する", async () => {
    const userId = makeUserId();
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({
        ok: true,
        data: makeConsentRecord({ userId, scope: "voice_to_openai", version: "2026-05-12" }),
      }),
      revoke: vi.fn().mockResolvedValue({ ok: true, data: true }),
    });
    const eventBus = makeEventBus();
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      eventBus,
    });

    await facade.revokeConsent(userId, "voice_to_openai");

    expect(eventBus.publish).toHaveBeenCalledOnce();
    const publishedEvent = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(publishedEvent?.type).toBe("auth.consent_revoked");
    expect(publishedEvent?.payload.scope).toBe("voice_to_openai");
  });

  it("既取消済み (findActive が null を返す) でもリポジトリ revoke を呼んで ok を返す", async () => {
    const userId = makeUserId();
    const revokeMock = vi.fn().mockResolvedValue({ ok: true, data: true });
    const consentRepo = makeConsentRepo({
      findActive: vi.fn().mockResolvedValue({ ok: true, data: null }), // 既に取消済み
      revoke: revokeMock,
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
    });

    const result = await facade.revokeConsent(userId, "voice_to_openai");

    expect(result.ok).toBe(true);
    expect(revokeMock).toHaveBeenCalledOnce();
  });

  it("consentRepo 未設定時はエラーを返す (voice_to_openai は取消可能なので IRREVOCABLE ではない)", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: { findByUserId: vi.fn() } });

    const result = await facade.revokeConsent(userId, "voice_to_openai");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // voice_to_openai は取消可能なので AUTH_CONSENT_IRREVOCABLE ではない
    expect(result.error.code).not.toBe("AUTH_CONSENT_IRREVOCABLE");
    expect(result.error.code).toBe("AUTH_CONSENT_NOT_CONFIGURED");
  });
});

// ============================================================
// getRequiredConsents テスト
// ============================================================

describe("AuthFacade.getRequiredConsents", () => {
  const allVersions: LegalDocumentVersion[] = [
    makeLegalDocumentVersion({ scope: "legal_terms", version: "2026-05-12", documentUrl: "https://trancall.app/terms" }),
    makeLegalDocumentVersion({ scope: "privacy_policy", version: "2026-05-12", documentUrl: "https://trancall.app/privacy" }),
    makeLegalDocumentVersion({ scope: "voice_to_openai", version: "2026-05-12", documentUrl: null }),
    makeLegalDocumentVersion({ scope: "transcript_retention", version: "2026-05-12", documentUrl: null }),
    makeLegalDocumentVersion({ scope: "push_notification", version: "2026-05-12", documentUrl: null }),
  ];

  it("正常系: 全 scope の RequiredConsentView を返す (data_deletion_request は除外)", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({ ok: true, data: allVersions }),
    });
    const consentRepo = makeConsentRepo({
      listActive: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // data_deletion_request は除外
    const scopes = result.data.map((v) => v.scope);
    expect(scopes).not.toContain("data_deletion_request");
    expect(result.data.length).toBe(allVersions.length);
  });

  it("未同意ユーザー: 全 scope で isUpToDate=false、userVersion=null", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({ ok: true, data: allVersions }),
    });
    const consentRepo = makeConsentRepo({
      listActive: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const view of result.data) {
      expect(view.isUpToDate).toBe(false);
      expect(view.userVersion).toBeNull();
    }
  });

  it("最新版に同意済みの scope は isUpToDate=true", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({ ok: true, data: allVersions }),
    });
    const consentRepo = makeConsentRepo({
      listActive: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          makeConsentRecord({ userId, scope: "legal_terms", version: "2026-05-12" }),
          makeConsentRecord({ userId, scope: "voice_to_openai", version: "2026-05-12" }),
        ],
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legalTermsView = result.data.find((v) => v.scope === "legal_terms");
    const voiceView = result.data.find((v) => v.scope === "voice_to_openai");
    const privacyView = result.data.find((v) => v.scope === "privacy_policy");
    expect(legalTermsView?.isUpToDate).toBe(true);
    expect(voiceView?.isUpToDate).toBe(true);
    expect(privacyView?.isUpToDate).toBe(false); // 未同意
  });

  it("古いバージョンに同意済みの scope は isUpToDate=false", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({
        ok: true,
        data: [makeLegalDocumentVersion({ scope: "legal_terms", version: "2026-05-12" })],
      }),
    });
    const consentRepo = makeConsentRepo({
      listActive: vi.fn().mockResolvedValue({
        ok: true,
        data: [makeConsentRecord({ userId, scope: "legal_terms", version: "2025-01-01" })],
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.data.find((v) => v.scope === "legal_terms");
    expect(view?.isUpToDate).toBe(false);
    expect(view?.userVersion).toBe("2025-01-01");
    expect(view?.currentVersion).toBe("2026-05-12");
  });

  it("ソート: isRequired=true の scope が先頭に来る", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({ ok: true, data: allVersions }),
    });
    const consentRepo = makeConsentRepo({
      listActive: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo,
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const views = result.data;
    // isRequired=false が登場する前に isRequired=true がすべて来る
    let foundOptional = false;
    for (const view of views) {
      if (!view.isRequired) foundOptional = true;
      if (foundOptional && view.isRequired) {
        throw new Error(`isRequired=true の ${view.scope} が isRequired=false の後に来た`);
      }
    }
  });

  it("LegalDocumentVersionRepository エラー時はエラーを伝播", async () => {
    const userId = makeUserId();
    const legalDocRepo = makeLegalDocRepo({
      findAllLatest: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "AUTH_LEGAL_DOC_UNAVAILABLE", message: "DB 障害", retryable: true },
      }),
    });
    const facade = createAuthFacade({
      profileRepo: { findByUserId: vi.fn() },
      consentRepo: makeConsentRepo(),
      legalDocRepo,
    });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_LEGAL_DOC_UNAVAILABLE");
  });

  it("consentRepo/legalDocRepo 未設定時はエラーを返す", async () => {
    const userId = makeUserId();
    const facade = createAuthFacade({ profileRepo: { findByUserId: vi.fn() } });

    const result = await facade.getRequiredConsents(userId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_CONSENT_NOT_CONFIGURED");
  });
});
