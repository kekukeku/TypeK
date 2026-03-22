import { createI18n } from "vue-i18n";
import { FALLBACK_LOCALE } from "./languageConfig";
import zhTW from "./locales/zh-TW.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";
import zhCN from "./locales/zh-CN.json";
import koKR from "./locales/ko-KR.json";
import frFR from "./locales/fr-FR.json";
import esES from "./locales/es-ES.json";
import ruRU from "./locales/ru-RU.json";
import thTH from "./locales/th-TH.json";
import viVN from "./locales/vi-VN.json";
import arSA from "./locales/ar-SA.json";

const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: "en-US",
  messages: {
    "zh-TW": zhTW,
    "en-US": enUS,
    "ja-JP": jaJP,
    "zh-CN": zhCN,
    "ko-KR": koKR,
    "fr-FR": frFR,
    "es-ES": esES,
    "ru-RU": ruRU,
    "th-TH": thTH,
    "vi-VN": viVN,
    "ar-SA": arSA,
  },
});

export default i18n;
