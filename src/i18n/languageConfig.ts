export type SupportedLocale =
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "zh-CN"
  | "ko-KR"
  | "fr-FR"
  | "es-ES"
  | "ru-RU"
  | "th-TH"
  | "vi-VN"
  | "ar-SA";

export const FALLBACK_LOCALE: SupportedLocale = "zh-TW";

export interface LanguageOption {
  locale: SupportedLocale;
  displayName: string;
  whisperCode: string;
  htmlLang: string;
  navigatorPatternList: string[];
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    locale: "zh-TW",
    displayName: "\u7E41\u9AD4\u4E2D\u6587", // 繁體中文
    whisperCode: "zh",
    htmlLang: "zh-Hant",
    navigatorPatternList: ["zh-Hant-TW", "zh-Hant", "zh-TW"],
  },
  {
    locale: "en-US",
    displayName: "English",
    whisperCode: "en",
    htmlLang: "en",
    navigatorPatternList: ["en-US", "en"],
  },
  {
    locale: "ja-JP",
    displayName: "\u65E5\u672C\u8A9E", // 日本語
    whisperCode: "ja",
    htmlLang: "ja",
    navigatorPatternList: ["ja-JP", "ja"],
  },
  {
    locale: "zh-CN",
    displayName: "\u7B80\u4F53\u4E2D\u6587", // 简体中文
    whisperCode: "zh",
    htmlLang: "zh-Hans",
    navigatorPatternList: ["zh-Hans", "zh-CN"],
  },
  {
    locale: "ko-KR",
    displayName: "\uD55C\uAD6D\uC5B4", // 한국어
    whisperCode: "ko",
    htmlLang: "ko",
    navigatorPatternList: ["ko-KR", "ko"],
  },
  {
    locale: "fr-FR",
    displayName: "Fran\u00E7ais", // Français
    whisperCode: "fr",
    htmlLang: "fr",
    navigatorPatternList: ["fr-FR", "fr"],
  },
  {
    locale: "es-ES",
    displayName: "Espa\u00F1ol", // Español
    whisperCode: "es",
    htmlLang: "es",
    navigatorPatternList: ["es-ES", "es"],
  },
  {
    locale: "ru-RU",
    displayName: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", // Русский
    whisperCode: "ru",
    htmlLang: "ru",
    navigatorPatternList: ["ru-RU", "ru"],
  },
  {
    locale: "th-TH",
    displayName: "\u0E44\u0E17\u0E22", // ไทย
    whisperCode: "th",
    htmlLang: "th",
    navigatorPatternList: ["th-TH", "th"],
  },
  {
    locale: "vi-VN",
    displayName: "Ti\u1EBFng Vi\u1EC7t", // Tiếng Việt
    whisperCode: "vi",
    htmlLang: "vi",
    navigatorPatternList: ["vi-VN", "vi"],
  },
  {
    locale: "ar-SA",
    displayName: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", // العربية
    whisperCode: "ar",
    htmlLang: "ar",
    navigatorPatternList: ["ar-SA", "ar"],
  },
];

export function detectSystemLocale(): SupportedLocale {
  const browserLanguageList =
    typeof navigator !== "undefined" ? navigator.languages : [];

  for (const browserLang of browserLanguageList) {
    // 1. Exact match (e.g. "zh-Hant-TW" -> zh-TW)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some(
          (pattern) => pattern.toLowerCase() === browserLang.toLowerCase(),
        )
      ) {
        return option.locale;
      }
    }

    // 2. Script subtag match (e.g. "zh-Hant" -> zh-TW, "zh-Hans" -> zh-CN)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some((pattern) =>
          browserLang.toLowerCase().startsWith(pattern.toLowerCase() + "-"),
        )
      ) {
        return option.locale;
      }
    }

    // 3. Language prefix match (e.g. "ja-JP" -> ja, "ko-KR" -> ko, "en-US" -> en)
    const langPrefix = browserLang.split("-")[0].toLowerCase();
    for (const option of LANGUAGE_OPTIONS) {
      if (option.locale.toLowerCase() === langPrefix) {
        return option.locale;
      }
    }

    // 4. Bare "zh" -> zh-TW (protect traditional Chinese users)
    if (langPrefix === "zh") {
      return "zh-TW";
    }
  }

  // 5. Fallback
  return FALLBACK_LOCALE;
}

export function getHtmlLangForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.htmlLang ?? "zh-Hant";
}

export function getWhisperCodeForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.whisperCode ?? "zh";
}

export type TranscriptionLocale = SupportedLocale | "auto";

export interface TranscriptionLanguageOption {
  locale: TranscriptionLocale;
  displayName: string;
  whisperCode: string | null;
}

export const TRANSCRIPTION_LANGUAGE_OPTIONS: TranscriptionLanguageOption[] = [
  {
    locale: "auto",
    displayName: "自動偵測",
    whisperCode: null,
  },
  ...LANGUAGE_OPTIONS.map((opt) => ({
    locale: opt.locale as TranscriptionLocale,
    displayName: opt.displayName,
    whisperCode: opt.whisperCode,
  })),
];

export function getWhisperCodeForTranscriptionLocale(
  locale: TranscriptionLocale,
): string | null {
  if (locale === "auto") return null;
  return getWhisperCodeForLocale(locale);
}
