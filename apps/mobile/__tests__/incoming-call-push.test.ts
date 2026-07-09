/**
 * incoming-call-push.test.ts
 *
 * #30/#68: VoIP push → IncomingCall 画面ナビゲーション配線のテスト。
 *
 * `@react-navigation/native` の実ランタイムは RN レンダリング環境を要求するため
 * (既存の screen テスト群と同じ方針で) wholesale mock する。
 * `createNavigationContainerRef` を模した fake ref を注入し、
 * navigateToIncomingCall の payload → route params 変換ロジックを検証する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsReady, mockNavigate } = vi.hoisted(() => ({
  mockIsReady: vi.fn<() => boolean>(),
  mockNavigate: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("../src/i18n/index.js", () => ({
  i18n: { t: (key: string) => key },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({
    isReady: mockIsReady,
    navigate: mockNavigate,
  }),
}));

import { navigateToIncomingCall } from "../src/hooks/use-incoming-call-push.js";

const PAYLOAD = {
  type: "incoming_call" as const,
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  roomId: "room_abc123",
  callerId: "u_caller1",
  callerName: "山田 太郎",
  callerAvatarUrl: "https://example.com/avatar.png",
  callerTrancallId: "@yamada_taro",
  roomType: "audio" as const,
  translationEnabled: true,
  languagePair: "ja-en",
  callerLanguage: "ja",
  issuedAt: "2026-05-12T10:23:45.000Z",
  expiresAt: "2026-05-12T10:24:15.000Z",
  signature: "a".repeat(64),
};

describe("navigateToIncomingCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("rootNavigationRef が isReady() でない場合は navigate を呼ばず安全に return する", () => {
    mockIsReady.mockReturnValue(false);

    expect(() => { navigateToIncomingCall(PAYLOAD); }).not.toThrow();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("isReady() の場合、Call > IncomingCall へ正しい params を渡す", () => {
    mockIsReady.mockReturnValue(true);

    navigateToIncomingCall(PAYLOAD);

    expect(mockNavigate).toHaveBeenCalledWith("Call", {
      screen: "IncomingCall",
      params: {
        roomId: "room_abc123",
        callerName: "山田 太郎",
        callerLanguage: "ja",
        callUuid: "550e8400-e29b-41d4-a716-446655440000",
        translationEnabled: true,
        callerAvatarUri: "https://example.com/avatar.png",
      },
    });
  });

  it("callerAvatarUrl が null の場合、callerAvatarUri を params に含めない", () => {
    mockIsReady.mockReturnValue(true);

    navigateToIncomingCall({ ...PAYLOAD, callerAvatarUrl: null });

    expect(mockNavigate).toHaveBeenCalledWith("Call", {
      screen: "IncomingCall",
      params: {
        roomId: "room_abc123",
        callerName: "山田 太郎",
        callerLanguage: "ja",
        callUuid: "550e8400-e29b-41d4-a716-446655440000",
        translationEnabled: true,
      },
    });
  });
});
