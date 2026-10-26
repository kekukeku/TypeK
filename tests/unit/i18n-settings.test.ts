import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SupportedLocale } from "../../src/i18n/languageConfig";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

describe("i18n 設定功能", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreDelete.mockClear();
    mockStoreSave.mockClear();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockEmit.mockClear().mockResolvedValue(undefined);
    vi.resetModules();
  });

  // ==========================================================================
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') 應正確存入 store 並更新 i18n.global.locale", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale('ja') 應更新 document.documentElement.lang 為 'ja'", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("ja");

      expect(document.documentElement.lang).toBe("ja");
    });
  });

  // ==========================================================================
  // getWhisperLanguageCode
  // ==========================================================================

  describe("getWhisperLanguageCode", () => {
    const testCaseList: [SupportedLocale, string][] = [
      ["zh-TW", "zh"],
      ["en", "en"],
      ["ja", "ja"],
      ["zh-CN", "zh"],
      ["ko", "ko"],
      ["vi", "vi"],
      ["th", "th"],
    ];

    it.each(testCaseList)(
      "[P0] locale '%s' → whisperCode '%s'",
      async (locale, expectedCode) => {
        mockStoreData.set("selectedLocale", locale);

        const { useSettingsStore } = await import(
          "../../src/stores/useSettingsStore"
        );
        const store = useSettingsStore();
        await store.loadSettings();

        expect(store.getWhisperLanguageCode()).toBe(expectedCode);
      },
    );
  });

  // ==========================================================================
  // TranscriptionLocale 型別與 auto 選項
  // ==========================================================================

  describe("TranscriptionLocale", () => {
    it("[P0] getWhisperCodeForTranscriptionLocale('auto') 應回傳 null", async () => {
      const { getWhisperCodeForTranscriptionLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(getWhisperCodeForTranscriptionLocale("auto")).toBeNull();
    });

    it("[P0] getWhisperCodeForTranscriptionLocale 各語言應回傳正確的 whisperCode", async () => {
      const { getWhisperCodeForTranscriptionLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(getWhisperCodeForTranscriptionLocale("zh-TW")).toBe("zh");
      expect(getWhisperCodeForTranscriptionLocale("en")).toBe("en");
      expect(getWhisperCodeForTranscriptionLocale("ja")).toBe("ja");
      expect(getWhisperCodeForTranscriptionLocale("zh-CN")).toBe("zh");
      expect(getWhisperCodeForTranscriptionLocale("ko")).toBe("ko");
      expect(getWhisperCodeForTranscriptionLocale("vi")).toBe("vi");
      expect(getWhisperCodeForTranscriptionLocale("th")).toBe("th");
    });

    it("[P0] TRANSCRIPTION_LANGUAGE_OPTIONS 應包含 auto + 7 個介面語言", async () => {
      const { TRANSCRIPTION_LANGUAGE_OPTIONS } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS).toHaveLength(8);
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS[0].locale).toBe("auto");
      expect(TRANSCRIPTION_LANGUAGE_OPTIONS[0].whisperCode).toBeNull();

      const localeList = TRANSCRIPTION_LANGUAGE_OPTIONS.map(
        (opt: { locale: string }) => opt.locale,
      );
      expect(localeList).toContain("auto");
      expect(localeList).toContain("zh-TW");
      expect(localeList).toContain("en");
      expect(localeList).toContain("ja");
      expect(localeList).toContain("zh-CN");
      expect(localeList).toContain("ko");
      expect(localeList).toContain("vi");
      expect(localeList).toContain("th");
    });
  });

  // ==========================================================================
  // saveTranscriptionLocale
  // ==========================================================================

  describe("saveTranscriptionLocale", () => {
    it("[P0] saveTranscriptionLocale('ja') 應正確存入 store", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("ja");

      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "ja",
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveTranscriptionLocale 應發送 SETTINGS_UPDATED event", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("en");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "transcriptionLocale",
        value: "en",
      });
    });

    it("[P0] saveTranscriptionLocale('auto') 後 getWhisperLanguageCode 應回傳 null", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveTranscriptionLocale("auto");

      expect(store.getWhisperLanguageCode()).toBeNull();
    });
  });

  // ==========================================================================
  // detectSystemLocale
  // ==========================================================================

  describe("detectSystemLocale", () => {
    it("[P0] 精確匹配：navigator.languages=['zh-Hant-TW'] → 'zh-TW'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant-TW"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });

    it("[P0] script subtag 匹配：navigator.languages=['zh-Hant'] → 'zh-TW'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });

    it("[P0] script subtag 匹配：navigator.languages=['zh-Hans'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hans"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] 前綴匹配：navigator.languages=['ja-JP'] → 'ja'", async () => {
      vi.stubGlobal("navigator", { languages: ["ja-JP"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("ja");

      vi.unstubAllGlobals();
    });

    it.each([
      ["vi", "vi"],
      ["vi-VN", "vi"],
      ["th", "th"],
      ["th-TH", "th"],
    ])("[P0] 越南文／泰文：navigator.languages=['%s'] → '%s'", async (lang, expected) => {
      vi.stubGlobal("navigator", { languages: [lang] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe(expected);

      vi.unstubAllGlobals();
    });

    it("[P0] 無匹配時 fallback 為 'zh-TW'：navigator.languages=['fr']", async () => {
      vi.stubGlobal("navigator", { languages: ["fr"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });
  });

  // ==========================================================================
  // Prompt auto-switch
  // ==========================================================================

  describe("轉錄語言切換 prompt 連動", () => {
    it("[P0] 未自訂 prompt 時，切換轉錄語言應自動更新為新語言預設", async () => {
      // 明確設定起始 locale 為 zh-TW（避免 jsdom 環境 detectSystemLocale 不穩定）
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getMinimalPromptForLocale("zh-TW");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 切換轉錄語言為 English（prompt 應跟著切換，但不存檔）
      mockStoreSet.mockClear();
      await store.saveTranscriptionLocale("en");

      const enDefault = getMinimalPromptForLocale("en");
      expect(store.getAiPrompt()).toBe(enDefault);

      // prompt 不應被自動寫入 store（使用者需手動儲存）
      const aiPromptSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string, unknown]) => key === "aiPrompt",
      );
      expect(aiPromptSetCallList).toHaveLength(0);
    });

    it("[P0] 磁碟上的自訂 prompt 不再被讀取，切換轉錄語言仍用各語言精簡指示", async () => {
      const customPrompt = "我的自訂 prompt 內容";
      mockStoreData.set("selectedLocale", "zh-TW");
      mockStoreData.set("aiPrompt", customPrompt);
      mockStoreData.set("promptMode", "custom");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      expect(store.getAiPrompt()).toBe(getMinimalPromptForLocale("zh-TW"));
      expect(store.getAiPrompt()).not.toBe(customPrompt);

      await store.saveTranscriptionLocale("en");

      expect(store.getAiPrompt()).toBe(getMinimalPromptForLocale("en"));
    });

    it("[P0] 轉錄語言為特定語言時，切換 UI 語言不應改變 prompt", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getMinimalPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getMinimalPromptForLocale("zh-TW");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 轉錄語言為 zh-TW（非 auto），切換 UI 語言不影響 prompt
      await store.saveLocale("en");

      expect(store.getAiPrompt()).toBe(zhDefault);
    });

    it("[P0] 轉錄語言為 auto 時，切換 UI 語言應更新 prompt（僅記憶體）", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");
      mockStoreData.set("selectedTranscriptionLocale", "auto");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      // #83：auto 時用「保持輸入語言、不翻譯」的自動版，而非介面語言的明確版
      const { getAutoLanguagePrompt } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getAutoLanguagePrompt("zh-TW");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 轉錄語言為 auto，切換 UI 語言 → prompt 跟著切換
      mockStoreSet.mockClear();
      await store.saveLocale("en");

      const enDefault = getAutoLanguagePrompt("en");
      expect(store.getAiPrompt()).toBe(enDefault);

      // prompt 不應被自動寫入 store
      const aiPromptSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string, unknown]) => key === "aiPrompt",
      );
      expect(aiPromptSetCallList).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 翻譯檔 key 一致性驗證
  // ==========================================================================

  describe("翻譯檔 key 一致性", () => {
    type JsonObject = Record<string, unknown>;

    function getKeyList(obj: JsonObject, prefix = ""): string[] {
      const keyList: string[] = [];
      for (const k of Object.keys(obj).sort()) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (typeof obj[k] === "object" && obj[k] !== null) {
          keyList.push(...getKeyList(obj[k] as JsonObject, full));
        } else {
          keyList.push(full);
        }
      }
      return keyList;
    }

    function getValue(obj: JsonObject, key: string): string {
      const value = key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as JsonObject)[part],
          obj,
        );
      return value as string;
    }

    function getPlaceholderSet(value: string): string[] {
      return Array.from(value.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
    }

    it("[P0] 七個 locale JSON 檔的 key 集合應完全一致", async () => {
      const zhTW = await import("../../src/i18n/locales/zh-TW.json");
      const en = await import("../../src/i18n/locales/en.json");
      const ja = await import("../../src/i18n/locales/ja.json");
      const zhCN = await import("../../src/i18n/locales/zh-CN.json");
      const ko = await import("../../src/i18n/locales/ko.json");
      const vi = await import("../../src/i18n/locales/vi.json");
      const th = await import("../../src/i18n/locales/th.json");

      const baseKeyList = getKeyList(zhTW.default);
      const localeMap: Record<string, string[]> = {
        en: getKeyList(en.default),
        ja: getKeyList(ja.default),
        "zh-CN": getKeyList(zhCN.default),
        ko: getKeyList(ko.default),
        vi: getKeyList(vi.default),
        th: getKeyList(th.default),
      };

      for (const [locale, keyList] of Object.entries(localeMap)) {
        const missingKeyList = baseKeyList.filter((k) => !keyList.includes(k));
        const extraKeyList = keyList.filter((k) => !baseKeyList.includes(k));

        expect(
          missingKeyList,
          `${locale} 缺少以下 key: ${missingKeyList.join(", ")}`,
        ).toHaveLength(0);
        expect(
          extraKeyList,
          `${locale} 多出以下 key: ${extraKeyList.join(", ")}`,
        ).toHaveLength(0);
      }
    });

    it("[P0] 所有字串葉節點 trim 後非空、{name} 集合與 zh-TW 相同", async () => {
      const zhTW = await import("../../src/i18n/locales/zh-TW.json");
      const vi = await import("../../src/i18n/locales/vi.json");
      const th = await import("../../src/i18n/locales/th.json");

      const baseKeyList = getKeyList(zhTW.default);
      for (const [locale, message] of Object.entries({
        vi: vi.default,
        th: th.default,
      })) {
        for (const key of baseKeyList) {
          const value = getValue(message, key);
          expect(value.trim(), `${locale} ${key} 不可為空`).not.toBe("");
          expect(
            getPlaceholderSet(value),
            `${locale} ${key} 的 {name} 集合不符`,
          ).toEqual(getPlaceholderSet(getValue(zhTW.default, key)));
        }
      }
    });

    it("[P0] vi 為 NFC 且不含漢字", async () => {
      const vi = await import("../../src/i18n/locales/vi.json");
      for (const key of getKeyList(vi.default)) {
        const value = getValue(vi.default, key);
        expect(value, `vi ${key} 應為 NFC`).toBe(value.normalize("NFC"));
        expect(value, `vi ${key} 不應含漢字`).not.toMatch(/\p{Script=Han}/u);
      }
    });

    it("[P0] th 含泰文，或與 en 逐字相同（產品名、技術名）", async () => {
      const th = await import("../../src/i18n/locales/th.json");
      const en = await import("../../src/i18n/locales/en.json");
      for (const key of getKeyList(th.default)) {
        const value = getValue(th.default, key);
        expect(
          /\p{Script=Thai}/u.test(value) || value === getValue(en.default, key),
          `th ${key} 既無泰文也與 en 不同`,
        ).toBe(true);
      }
    });
  });

  describe("正式 i18n 實例", () => {
    it("[P0] 已註冊 vi、th，切過去拿得到該語系字串而不是 en fallback", async () => {
      const { default: i18n } = await import("../../src/i18n");
      const en = await import("../../src/i18n/locales/en.json");
      const vi = await import("../../src/i18n/locales/vi.json");
      const th = await import("../../src/i18n/locales/th.json");
      const availableLocaleList = i18n.global.availableLocales;
      expect(availableLocaleList).toContain("vi");
      expect(availableLocaleList).toContain("th");

      const originalLocale = i18n.global.locale.value;
      try {
        i18n.global.locale.value = "vi";
        expect(i18n.global.t("common.save")).toBe(vi.default.common.save);
        expect(i18n.global.t("common.save")).not.toBe(en.default.common.save);
        i18n.global.locale.value = "th";
        expect(i18n.global.t("common.save")).toBe(th.default.common.save);
        expect(i18n.global.t("common.save")).not.toBe(en.default.common.save);
      } finally {
        i18n.global.locale.value = originalLocale;
      }
    });
  });
});
