/**
 * voip-push-hmac.test.ts
 *
 * #68/#70 (H-3): legacy (react-native-voip-push-notification 経由) の着信パスに
 * HMAC 検証 (validateCallPayload) を配線したことの回帰防止テスト。
 *
 * - verifyIncomingCallHmac (純関数) が SecureStore から secret を取得し
 *   validateCallPayload に渡すことを検証
 * - secret が SecureStore に無い場合は fail-closed (false) になることを検証
 * - registerVoIPPushListeners 経由の着信で、HMAC 検証失敗時は CallKit
 *   (displayIncomingCall) が呼ばれないことを end-to-end で検証
 * - HMAC 検証成功時は displayIncomingCall + onIncomingCall が呼ばれることを検証
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("../src/i18n/index.js", () => ({
  i18n: { t: (key: string) => key },
  useTranslation: () => ({ t: (key: string) => key }),
}));

// expo-modules-core は HmacValidator.ts が静的 import する。JSI 依存のため
// vitest (node 環境) では実パッケージを読み込めない (既存 hmac-validator.test.ts と同方針)。
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

const { mockGetItemAsync } = vi.hoisted(() => ({
  mockGetItemAsync: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: mockGetItemAsync,
}));

import {
  createIncomingPushHandler,
  verifyIncomingCallHmac,
  type VoIPPushPayload,
} from "../src/lib/callkit/voip-push.js";
import { setHmacValidatorNativeModule } from "../src/native/HmacValidator.js";
import { getCallKeep, setCallKeepNativeModule } from "../src/lib/callkit/index.js";
import type { HmacValidatorNativeModule } from "../src/native/HmacValidator.js";
import type { RNCallKeepNativeModule } from "../src/lib/callkit/index.js";

const PAYLOAD: VoIPPushPayload = {
  type: "incoming_call",
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  roomId: "room_abc123",
  callerId: "u_caller1",
  callerName: "山田 太郎",
  callerAvatarUrl: "https://example.com/avatar.png",
  callerTrancallId: "@yamada_taro",
  roomType: "audio",
  translationEnabled: true,
  languagePair: "ja-en",
  callerLanguage: "ja",
  issuedAt: "2026-05-12T10:23:45.000Z",
  expiresAt: "2026-05-12T10:24:15.000Z",
  signature: "a".repeat(64),
};

function makeMockHmacModule(): HmacValidatorNativeModule & {
  validateCallPayload: ReturnType<typeof vi.fn>;
} {
  return { validateCallPayload: vi.fn<() => Promise<boolean>>() };
}

function makeMockCallKeepModule(): RNCallKeepNativeModule & {
  displayIncomingCall: ReturnType<typeof vi.fn>;
  endCall: ReturnType<typeof vi.fn>;
} {
  return {
    setup: vi.fn(),
    displayIncomingCall: vi.fn(),
    answerIncomingCall: vi.fn(),
    endCall: vi.fn(),
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  };
}

describe("verifyIncomingCallHmac", () => {
  let mockHmacModule: ReturnType<typeof makeMockHmacModule>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHmacModule = makeMockHmacModule();
    setHmacValidatorNativeModule(mockHmacModule);
  });

  afterEach(() => {
    setHmacValidatorNativeModule(null);
  });

  it("SecureStore に secret があれば validateCallPayload に渡して結果を返す", async () => {
    mockGetItemAsync.mockResolvedValue("stored-secret-value");
    mockHmacModule.validateCallPayload.mockResolvedValue(true);

    const result = await verifyIncomingCallHmac(PAYLOAD);

    expect(mockGetItemAsync).toHaveBeenCalledWith("trancall:push-hmac-secret");
    expect(mockHmacModule.validateCallPayload).toHaveBeenCalledWith(PAYLOAD, "stored-secret-value");
    expect(result).toBe(true);
  });

  it("native module が false を返せば false を返す", async () => {
    mockGetItemAsync.mockResolvedValue("stored-secret-value");
    mockHmacModule.validateCallPayload.mockResolvedValue(false);

    const result = await verifyIncomingCallHmac(PAYLOAD);

    expect(result).toBe(false);
  });

  it("SecureStore に secret が無ければ fail-closed で false を返し validateCallPayload を呼ばない", async () => {
    mockGetItemAsync.mockResolvedValue(null);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await verifyIncomingCallHmac(PAYLOAD);

    expect(result).toBe(false);
    expect(mockHmacModule.validateCallPayload).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("TRANCALL_PUSH_HMAC_SECRET"));
    consoleSpy.mockRestore();
  });

  it("SecureStore.getItemAsync が例外を投げても fail-closed で false を返す (non-fatal)", async () => {
    mockGetItemAsync.mockRejectedValue(new Error("Keychain unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await verifyIncomingCallHmac(PAYLOAD);

    expect(result).toBe(false);
    expect(mockHmacModule.validateCallPayload).not.toHaveBeenCalled();
  });
});

describe("createIncomingPushHandler (iOS legacy path) — HMAC gating end-to-end", () => {
  let mockHmacModule: ReturnType<typeof makeMockHmacModule>;
  let mockCallKeepModule: ReturnType<typeof makeMockCallKeepModule>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHmacModule = makeMockHmacModule();
    setHmacValidatorNativeModule(mockHmacModule);
    mockCallKeepModule = makeMockCallKeepModule();
    setCallKeepNativeModule(mockCallKeepModule);
  });

  afterEach(() => {
    setHmacValidatorNativeModule(null);
    setCallKeepNativeModule(null);
  });

  it("HMAC 検証成功時は displayIncomingCall と onIncomingCall が呼ばれる", async () => {
    mockGetItemAsync.mockResolvedValue("correct-secret");
    mockHmacModule.validateCallPayload.mockResolvedValue(true);
    const onIncomingCall = vi.fn();

    const handleIncoming = createIncomingPushHandler(getCallKeep(), { onIncomingCall });
    handleIncoming({ data: { aps: {}, trancall: PAYLOAD } });
    // handleIncoming は async 検証を待たずに戻るため、マイクロタスクの解決を待つ
    await vi.waitFor(() => {
      expect(mockCallKeepModule.displayIncomingCall).toHaveBeenCalled();
    });

    expect(mockCallKeepModule.displayIncomingCall).toHaveBeenCalledWith(
      PAYLOAD.uuid,
      PAYLOAD.callerTrancallId,
      PAYLOAD.callerName,
      "generic",
      false,
    );
    expect(onIncomingCall).toHaveBeenCalledWith(PAYLOAD);
  });

  it("HMAC 検証失敗時は displayIncomingCall も onIncomingCall も呼ばれない (log only で破棄)", async () => {
    mockGetItemAsync.mockResolvedValue("wrong-secret");
    mockHmacModule.validateCallPayload.mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onIncomingCall = vi.fn();

    const handleIncoming = createIncomingPushHandler(getCallKeep(), { onIncomingCall });
    handleIncoming({ data: { aps: {}, trancall: PAYLOAD } });
    await vi.waitFor(() => {
      expect(mockHmacModule.validateCallPayload).toHaveBeenCalled();
    });

    expect(mockCallKeepModule.displayIncomingCall).not.toHaveBeenCalled();
    expect(onIncomingCall).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("HMAC verification failed"),
    );
    consoleSpy.mockRestore();
  });

  it("secret が SecureStore に無い場合も displayIncomingCall を呼ばない (fail-closed)", async () => {
    mockGetItemAsync.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onIncomingCall = vi.fn();

    const handleIncoming = createIncomingPushHandler(getCallKeep(), { onIncomingCall });
    handleIncoming({ data: { aps: {}, trancall: PAYLOAD } });
    await vi.waitFor(() => {
      expect(mockGetItemAsync).toHaveBeenCalled();
    });
    // マイクロタスクが尽きるまで少し待つ (displayIncomingCall が呼ばれていないことの確認)
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockHmacModule.validateCallPayload).not.toHaveBeenCalled();
    expect(mockCallKeepModule.displayIncomingCall).not.toHaveBeenCalled();
  });

  it("schema 不一致 payload は従来通り HMAC 検証を経由せずフォールバック表示 + 即終話する", () => {
    const onIncomingCall = vi.fn();

    const handleIncoming = createIncomingPushHandler(getCallKeep(), { onIncomingCall });
    handleIncoming({ data: { broken: "payload" } });

    expect(mockHmacModule.validateCallPayload).not.toHaveBeenCalled();
    expect(mockCallKeepModule.displayIncomingCall).toHaveBeenCalled();
    expect(mockCallKeepModule.endCall).toHaveBeenCalled();
    expect(onIncomingCall).not.toHaveBeenCalled();
  });
});
