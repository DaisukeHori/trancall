import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import zh from "./locales/zh.json" with { type: "json" };

const resources = {
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
} as const;

type SupportedLanguage = keyof typeof resources;

const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ["ja", "en", "zh"];
const DEFAULT_LANGUAGE: SupportedLanguage = "ja";

function isNoArgFunction(value: unknown): value is () => unknown {
  return typeof value === "function";
}

// Array.isArray の標準型宣言は `arg is any[]` に narrow するため、
// `unknown[]` に narrow する自前の type predicate を用意する。
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * require() で読み込んだ未知の値から `getLocales()` の呼び出し結果 (Locale[] 相当) を
 * 型アサーションを使わず (type predicate + `in` / `typeof` narrowing のみで) 安全に取り出す。
 */
function extractLanguageCodes(mod: unknown): readonly string[] {
  if (mod === null || typeof mod !== "object" || !("getLocales" in mod)) return [];

  const getLocales = mod.getLocales;
  if (!isNoArgFunction(getLocales)) return [];

  const locales: unknown = getLocales();
  if (!isUnknownArray(locales)) return [];

  const codes: string[] = [];
  for (const locale of locales) {
    if (locale === null || typeof locale !== "object" || !("languageCode" in locale)) continue;
    const code = locale.languageCode;
    if (typeof code === "string") codes.push(code);
  }
  return codes;
}

/**
 * デバイスのロケール設定から対応言語 (ja/en/zh) を判定する。
 *
 * `expo-localization` は Expo/RN 専用モジュールのため desktop (Electron, Phase 3) 等
 * 未インストール環境や vitest (Node) 環境では解決できない場合がある。
 * その場合は例外を握りつぶし `DEFAULT_LANGUAGE` (ja) にフォールバックする
 * (既存の native module 呼び出しパターンに合わせた defensive require)。
 */
function detectDeviceLanguage(): SupportedLanguage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localizationModule: unknown = require("expo-localization");
    for (const languageCode of extractLanguageCodes(localizationModule)) {
      const match = SUPPORTED_LANGUAGES.find((lang) => lang === languageCode);
      if (match != null) return match;
    }
  } catch {
    // expo-localization 未インストール、または native module 未初期化 → ja fallback
  }
  return DEFAULT_LANGUAGE;
}

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: detectDeviceLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: {
        escapeValue: false,
      },
    });
}

export { i18n, useTranslation, resources };
