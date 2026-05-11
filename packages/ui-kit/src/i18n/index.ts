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

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: "ja",
      fallbackLng: "en",
      interpolation: {
        escapeValue: false,
      },
    });
}

export { i18n, useTranslation, resources };
