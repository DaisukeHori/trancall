/**
 * navigate-to-subscription.test.ts
 *
 * M-5: pre-call-screen.tsx / call-summary-screen.tsx の「アップグレード」ボタンから
 * Settings > Subscription 画面への cross-stack ナビゲーション配線のテスト。
 *
 * `@react-navigation/native` の実ランタイムは RN レンダリング環境を要求するため
 * (incoming-call-push.test.ts と同じ方針で) wholesale mock し、
 * createNavigationContainerRef を模した fake ref を注入して
 * navigateToSubscriptionScreen() の navigate 呼び出しペイロードを検証する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsReady, mockNavigate } = vi.hoisted(() => ({
  mockIsReady: vi.fn<() => boolean>(),
  mockNavigate: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({
    isReady: mockIsReady,
    navigate: mockNavigate,
  }),
}));

import { navigateToSubscriptionScreen } from "../src/navigation/navigation-ref.js";

describe("navigateToSubscriptionScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rootNavigationRef が ready の場合、Main → Settings → Subscription へネスト遷移する", () => {
    mockIsReady.mockReturnValue(true);

    navigateToSubscriptionScreen();

    expect(mockNavigate).toHaveBeenCalledWith("Main", {
      screen: "Settings",
      params: { screen: "Subscription" },
    });
  });

  it("rootNavigationRef が未 mount (isReady()===false) の場合は何もしない", () => {
    mockIsReady.mockReturnValue(false);

    navigateToSubscriptionScreen();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
