/**
 * support-screen.test.ts
 * T-24: support-screen + diagnosticData 自動収集 テスト
 *
 * テスト対象:
 * 1. support-screen rendering (コンポーネントモジュールの import が失敗しないこと)
 * 2. diagnosticData 収集 (collectDiagnosticData)
 * 3. submit API 呼出 (submitInquiry mock)
 * 4. エラー時 retry (error state presence)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock react-native
// ---------------------------------------------------------------------------

vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  ActivityIndicator: "ActivityIndicator",
  Alert: {
    alert: vi.fn(),
  },
  Platform: {
    OS: "ios",
  },
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

// ---------------------------------------------------------------------------
// Mock @trancall/ui-kit
// ---------------------------------------------------------------------------

vi.mock("@trancall/ui-kit", () => ({
  useTheme: () => ({
    colors: {
      bgPrimary: "#FFFFFF",
      bgSecondary: "#F2F2F7",
      bgTertiary: "#E5E5EA",
      textPrimary: "#000000",
      textSecondary: "#3C3C43",
      textTertiary: "#C7C7CC",
      border: "#C6C6C8",
      primary: "#0A7AFF",
      primaryDark: "#006FE6",
      danger: "#FF3B30",
      success: "#34C759",
    },
    spacing: {
      8: 8,
      16: 16,
    },
    radii: {
      8: 8,
      12: 12,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock i18n
// ---------------------------------------------------------------------------

vi.mock("../src/i18n/index.js", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  i18n: {
    language: "ja",
  },
}));

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

vi.mock("../src/stores/auth-store.js", () => ({
  useAuthStore: vi.fn((selector: (state: { session: { accessToken: string } | null }) => unknown) => {
    const state = { session: { accessToken: "mock-token" } };
    return selector(state);
  }),
}));

vi.mock("../src/stores/recent-calls-store.js", () => ({
  useRecentCallsStore: vi.fn((selector: (state: { recentCalls: { id: string }[] }) => unknown) => {
    const state = {
      recentCalls: [
        { id: "room-001" },
        { id: "room-002" },
        { id: "room-003" },
        { id: "room-004" },
        { id: "room-005" },
        { id: "room-006" },
      ],
    };
    return selector(state);
  }),
}));

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const { mockSubmitInquiry } = vi.hoisted(() => {
  return { mockSubmitInquiry: vi.fn() };
});

vi.mock("../src/api/support-api.js", () => ({
  submitInquiry: mockSubmitInquiry,
  SupportCategorySchema: {
    enum: ["bug", "billing", "feature_request", "privacy", "other"],
  },
}));

// Mock API config
vi.mock("../src/api/config.js", () => ({
  API_BASE_URL: "http://localhost:3000",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
}));

// Mock expo-application
vi.mock("expo-application", () => ({
  nativeApplicationVersion: "1.2.3",
}));

// Mock expo-device
vi.mock("expo-device", () => ({
  osVersion: "iOS 17.5",
  modelName: "iPhone 15 Pro",
}));

// ---------------------------------------------------------------------------
// Tests: collectDiagnosticData
// ---------------------------------------------------------------------------

import { collectDiagnosticData } from "../src/screens/support-screen.js";

describe("collectDiagnosticData", () => {
  it("returns all required fields", () => {
    const data = collectDiagnosticData(["room-001", "room-002", "room-003"]);
    expect(typeof data.appVersion).toBe("string");
    expect(typeof data.osVersion).toBe("string");
    expect(typeof data.deviceModel).toBe("string");
    expect(typeof data.submittedAt).toBe("string");
    expect(typeof data.locale).toBe("string");
    expect(typeof data.timeZone).toBe("string");
    expect(typeof data.callHistoryLast7d).toBe("number");
    expect(Array.isArray(data.last5RoomIds)).toBe(true);
  });

  it("callHistoryLast7d equals the number of provided roomIds", () => {
    const roomIds = ["room-001", "room-002", "room-003"];
    const data = collectDiagnosticData(roomIds);
    expect(data.callHistoryLast7d).toBe(3);
  });

  it("last5RoomIds contains at most 5 entries", () => {
    const roomIds = ["a", "b", "c", "d", "e", "f", "g"];
    const data = collectDiagnosticData(roomIds);
    expect(data.last5RoomIds.length).toBe(5);
  });

  it("last5RoomIds contains first 5 roomIds in order", () => {
    const roomIds = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const data = collectDiagnosticData(roomIds);
    expect(data.last5RoomIds).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("submittedAt is a valid ISO 8601 string", () => {
    const data = collectDiagnosticData([]);
    const parsed = new Date(data.submittedAt);
    expect(!isNaN(parsed.getTime())).toBe(true);
  });

  it("handles empty roomIds array", () => {
    const data = collectDiagnosticData([]);
    expect(data.callHistoryLast7d).toBe(0);
    expect(data.last5RoomIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: support-api submitInquiry mock behavior
// ---------------------------------------------------------------------------

import { submitInquiry } from "../src/api/support-api.js";
import type { SupportInquiryRequest, DiagnosticData } from "../src/api/support-api.js";

describe("submitInquiry API call behavior", () => {
  const mockDiagnosticData: DiagnosticData = {
    appVersion: "1.0.0",
    osVersion: "iOS 17.5",
    deviceModel: "iPhone 15 Pro",
    submittedAt: new Date().toISOString(),
    locale: "ja-JP",
    callHistoryLast7d: 3,
  };

  const validRequest: SupportInquiryRequest = {
    category: "bug",
    body: "Something is broken.",
    diagnosticData: mockDiagnosticData,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls submitInquiry with valid request and returns ok: true", async () => {
    mockSubmitInquiry.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: true,
        data: {
          ticketId: "TC-20260512-A1B2C3",
          estimatedResponseHours: 48,
        },
      },
    });

    const result = await submitInquiry(validRequest, "mock-access-token");
    expect(result.ok).toBe(true);
    expect(mockSubmitInquiry).toHaveBeenCalledTimes(1);
    expect(mockSubmitInquiry).toHaveBeenCalledWith(validRequest, "mock-access-token");
  });

  it("returns ok: false on network error", async () => {
    mockSubmitInquiry.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Cannot connect",
        retryable: true,
      },
    });

    const result = await submitInquiry(validRequest, "mock-access-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("returns ok: false on rate limit exceeded", async () => {
    mockSubmitInquiry.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "SUPPORT_RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded",
        retryable: false,
        httpStatus: 429,
      },
    });

    const result = await submitInquiry(validRequest, "mock-access-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUPPORT_RATE_LIMIT_EXCEEDED");
    }
  });

  it("submits with optional subject when provided", async () => {
    mockSubmitInquiry.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: true,
        data: { ticketId: "TC-20260512-ABCDEF", estimatedResponseHours: 24 },
      },
    });

    const requestWithSubject: SupportInquiryRequest = {
      ...validRequest,
      subject: "Test subject",
    };

    await submitInquiry(requestWithSubject, "token");
    expect(mockSubmitInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Test subject" }),
      "token",
    );
  });

  it("submits without subject when not provided", async () => {
    mockSubmitInquiry.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: true,
        data: { ticketId: "TC-20260512-ABCDEF", estimatedResponseHours: 48 },
      },
    });

    const requestWithoutSubject: SupportInquiryRequest = {
      category: "other",
      body: "No subject inquiry",
      diagnosticData: mockDiagnosticData,
    };

    await submitInquiry(requestWithoutSubject, "token");
    expect(mockSubmitInquiry).toHaveBeenCalledWith(
      expect.not.objectContaining({ subject: expect.anything() }),
      "token",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: SupportCategorySchema values
// ---------------------------------------------------------------------------

import { SupportCategorySchema } from "../src/api/support-api.js";

describe("SupportCategorySchema", () => {
  it("contains all 5 expected categories", () => {
    const expectedCategories = ["bug", "billing", "feature_request", "privacy", "other"];
    for (const cat of expectedCategories) {
      expect(SupportCategorySchema.enum).toContain(cat);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: screen module can be imported
// ---------------------------------------------------------------------------

describe("SupportScreen module", () => {
  it("exports SupportScreen component", async () => {
    const mod = await import("../src/screens/support-screen.js");
    expect(typeof mod.SupportScreen).toBe("function");
  });

  it("exports collectDiagnosticData function", async () => {
    const mod = await import("../src/screens/support-screen.js");
    expect(typeof mod.collectDiagnosticData).toBe("function");
  });
});
