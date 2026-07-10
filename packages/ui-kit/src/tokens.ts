// Design tokens for TranCall UI Kit
// Based on docs/design/tokens.md

export const colors = {
  light: {
    primary: "#0A7AFF",
    primaryBg: "#E6F1FB",
    secondary: "#8E8E93",
    secondaryBg: "#F5F5F5",
    success: "#34C759",
    successBg: "#EAF3DE",
    danger: "#FF3B30",
    dangerBg: "#FCEBEB",
    warning: "#FF9500",
    warningBg: "#FAEEDA",
    bgPrimary: "#FFFFFF",
    bgSecondary: "#F5F5F5",
    bgTertiary: "#E8E8E8",
    callBg: "#1C1C1E",
    textPrimary: "#1A1A1A",
    textSecondary: "#8E8E93",
    textTertiary: "#C7C7CC",
    // primary/danger 等の彩度が高い塗り背景 (Button 塗りつぶし・checkbox チェック済み・badge 等) の
    // 上に乗せる文字色。light/dark どちらのテーマでも常に白固定 (WCAG コントラスト確保のため)。
    textOnColor: "#FFFFFF",
    // elevation shadow は物理的な影の表現のため light/dark 共通で黒固定
    shadowColor: "#000000",
    border: "#E5E5EA",
    subtitleBg: "rgba(0,0,0,0.7)",
    subtitleText: "#FFFFFF",
    subtitleOriginal: "#AAAAAA",
    subtitleTranslated: "#FFFFFF",
    controlSurface: "rgba(255,255,255,0.12)",
    controlSurfaceActive: "rgba(255,255,255,0.92)",
    controlSurfaceBorder: "rgba(255,255,255,0.18)",
    controlText: "rgba(255,255,255,0.92)",
  },
  dark: {
    primary: "#64B5F6",
    primaryBg: "#0C447C",
    secondary: "#8E8E93",
    secondaryBg: "#2C2C2E",
    success: "#34C759",
    successBg: "#1A3A1A",
    danger: "#FF3B30",
    dangerBg: "#3A1A1A",
    warning: "#FF9500",
    warningBg: "#3A2A0A",
    bgPrimary: "#1C1C1E",
    bgSecondary: "#2C2C2E",
    bgTertiary: "#3A3A3C",
    callBg: "#1C1C1E",
    textPrimary: "#F5F5F5",
    textSecondary: "#8E8E93",
    textTertiary: "#636366",
    textOnColor: "#FFFFFF",
    shadowColor: "#000000",
    border: "#38383A",
    subtitleBg: "rgba(0,0,0,0.85)",
    subtitleText: "#FFFFFF",
    subtitleOriginal: "#AAAAAA",
    subtitleTranslated: "#FFFFFF",
    controlSurface: "rgba(255,255,255,0.12)",
    controlSurfaceActive: "rgba(255,255,255,0.92)",
    controlSurfaceBorder: "rgba(255,255,255,0.18)",
    controlText: "rgba(255,255,255,0.92)",
  },
} as const;

export type ColorScheme = "light" | "dark";
export type Colors = typeof colors.light;

export const spacing = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  24: 24,
  32: 32,
  48: 48,
  64: 64,
} as const;

export type Spacing = typeof spacing;

export const typography = {
  heading1: {
    fontSize: 28,
    fontWeight: "700" as const,
    fontFamily: undefined,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "600" as const,
    fontFamily: undefined,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: undefined,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
    fontFamily: undefined,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: "400" as const,
    fontFamily: undefined,
  },
  caption: {
    fontSize: 12,
    fontWeight: "500" as const,
    fontFamily: undefined,
  },
  captionSmall: {
    fontSize: 10,
    fontWeight: "500" as const,
    fontFamily: undefined,
  },
  mono: {
    fontSize: 14,
    fontWeight: "500" as const,
    fontFamily: "monospace" as const,
  },
} as const;

export type Typography = typeof typography;

export const radii = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  full: 9999,
} as const;

export type Radii = typeof radii;

export const callTokens = {
  actionSize: 56,
  controlSize: 48,
  ambientVolumeNormal: 0.3,
  ambientVolumeDucking: 0.1,
  ambientVolumeFallback: 1.0,
} as const;
