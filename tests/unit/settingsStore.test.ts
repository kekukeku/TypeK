import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock tauri-plugin-store
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/i18n/prompts", () => ({
  getMinimalPromptForLocale: (locale: string) => `MINIMAL:${locale}`,
  getAutoLanguagePrompt: (uiLocale: string) => `AUTO:${uiLocale}`,
}));

vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-TW",
  LANGUAGE_OPTIONS: [
    { locale: "zh-TW" },
    { locale: "en" },
    { locale: "ja" },
    { locale: "zh-CN" },
    { locale: "ko" },
    { locale: "vi" },
    { locale: "th" },
  ],
  detectSystemLocale: () => "zh-TW",
  getHtmlLangForLocale: () => "zh-TW",
  getWhisperCodeForTranscriptionLocale: () => null,
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn(),
  SETTINGS_UPDATED: "settings:updated",
}));

vi.mock("../../src/lib/errorUtils", () => ({
  extractErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getHotkeyRecordingTimeoutMessage: () => "",
  getHotkeyUnsupportedKeyMessage: () => "",
  getHotkeyPresetHint: () => "",
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/lib/keycodeMap", () => ({
  getKeyDisplayName: () => "",
  getPlatformKeycode: () => 0,
  isPresetEquivalentKey: () => false,
  getDangerousKeyWarning: () => null,
  getEscapeReservedMessage: () => null,
}));

vi.mock("../../src/lib/modelRegistry", () => ({
  DEFAULT_LLM_MODEL_ID: "test-llm",
  DEFAULT_LLM_PROVIDER_ID: "groq",
  DEFAULT_STT_PROVIDER_ID: "groq",
  DEFAULT_WHISPER_MODEL_ID: "test-whisper",
  getEffectiveLlmModelId: (id: string | null) => id ?? "test-llm",
  getEffectiveWhisperModelId: (id: string | null) => id ?? "test-whisper",
  getModelListByProvider: () => [],
  getDefaultModelIdForProvider: () => "test-llm",
}));

vi.mock("../../src/lib/llmProvider", () => ({
  findProviderConfig: () => undefined,
}));

describe("useSettingsStore — 精簡指示", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    mockStoreDelete.mockReset();

    // Default: return null for all keys
    mockStoreGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupStoreGetMock(overrides: Record<string, unknown>) {
    mockStoreGet.mockImplementation((key: string) => {
      if (key in overrides) return Promise.resolve(overrides[key]);
      return Promise.resolve(null);
    });
  }

  async function createStore() {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    return useSettingsStore();
  }

  it("[P0] 新安裝 → getAiPrompt() 回傳精簡指示", async () => {
    setupStoreGetMock({});
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe("MINIMAL:zh-TW");
  });

  it("[P0] 磁碟上的 aiPrompt／promptMode 不再被讀取", async () => {
    setupStoreGetMock({
      promptMode: "custom",
      aiPrompt: "我的自訂 prompt 完全不一樣",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe("MINIMAL:zh-TW");
    const promptSetCallList = mockStoreSet.mock.calls.filter(
      ([key]: [string, unknown]) => key === "aiPrompt" || key === "promptMode",
    );
    expect(promptSetCallList).toHaveLength(0);
  });

  it("[P0] #83 辨識語言自動 → getAiPrompt 改用自動版，帶介面語系", async () => {
    setupStoreGetMock({
      selectedLocale: "en",
      selectedTranscriptionLocale: "auto",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe("AUTO:en");
  });

  it("[P0] 辨識語言明確設定 → 用該語言的內建精簡指示", async () => {
    setupStoreGetMock({
      selectedLocale: "zh-TW",
      selectedTranscriptionLocale: "en",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe("MINIMAL:en");
  });
});
