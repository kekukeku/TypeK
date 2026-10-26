import { createI18n } from "vue-i18n";
import { FALLBACK_LOCALE } from "./languageConfig";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import ko from "./locales/ko.json";
import vi from "./locales/vi.json";
import th from "./locales/th.json";

const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: "en",
  messages: {
    "zh-TW": zhTW,
    en,
    ja,
    "zh-CN": zhCN,
    ko,
    vi,
    th,
  },
});

export default i18n;
