// Tokens — JS mirror of packages/ui-kit/src/tokens.ts
// Kept identical so the prototype theming stays in lockstep with the canonical source.

const TC = {
  light: {
    primary: "#0A7AFF", primaryBg: "#E6F1FB",
    secondary: "#8E8E93", secondaryBg: "#F5F5F5",
    success: "#34C759", successBg: "#EAF3DE",
    danger: "#FF3B30", dangerBg: "#FCEBEB",
    warning: "#FF9500", warningBg: "#FAEEDA",
    bgPrimary: "#FFFFFF", bgSecondary: "#F5F5F5", bgTertiary: "#E8E8E8",
    textPrimary: "#1A1A1A", textSecondary: "#8E8E93", textTertiary: "#C7C7CC",
    border: "#E5E5EA",
    subtitleBg: "rgba(0,0,0,0.7)", subtitleOriginal: "#AAAAAA", subtitleTranslated: "#FFFFFF",
  },
  dark: {
    primary: "#64B5F6", primaryBg: "#0C447C",
    secondary: "#8E8E93", secondaryBg: "#2C2C2E",
    success: "#34C759", successBg: "#1A3A1A",
    danger: "#FF3B30", dangerBg: "#3A1A1A",
    warning: "#FF9500", warningBg: "#3A2A0A",
    bgPrimary: "#1C1C1E", bgSecondary: "#2C2C2E", bgTertiary: "#3A3A3C",
    textPrimary: "#F5F5F5", textSecondary: "#8E8E93", textTertiary: "#636366",
    border: "#38383A",
    subtitleBg: "rgba(0,0,0,0.85)", subtitleOriginal: "#AAAAAA", subtitleTranslated: "#FFFFFF",
  },
};

const TC_FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Roboto, system-ui, sans-serif`;
const TC_MONO = `ui-monospace, "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, Consolas, monospace`;

const TC_LANGS = [
  { code: "en", native: "English",    flag: "🇺🇸", en: "English" },
  { code: "es", native: "Español",    flag: "🇪🇸", en: "Spanish" },
  { code: "pt", native: "Português",  flag: "🇧🇷", en: "Portuguese" },
  { code: "fr", native: "Français",   flag: "🇫🇷", en: "French" },
  { code: "ja", native: "日本語",      flag: "🇯🇵", en: "Japanese" },
  { code: "ru", native: "Русский",    flag: "🇷🇺", en: "Russian" },
  { code: "zh", native: "中文",        flag: "🇨🇳", en: "Chinese" },
  { code: "de", native: "Deutsch",    flag: "🇩🇪", en: "German" },
  { code: "ko", native: "한국어",      flag: "🇰🇷", en: "Korean" },
  { code: "hi", native: "हिन्दी",       flag: "🇮🇳", en: "Hindi" },
  { code: "id", native: "Indonesia",  flag: "🇮🇩", en: "Indonesian" },
  { code: "vi", native: "Tiếng Việt", flag: "🇻🇳", en: "Vietnamese" },
  { code: "it", native: "Italiano",   flag: "🇮🇹", en: "Italian" },
];

Object.assign(window, { TC, TC_FONT, TC_MONO, TC_LANGS });
