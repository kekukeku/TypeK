import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "../../src/i18n";

const { mockInvoke, settingsState, audioPreviewMock } = vi.hoisted(() => ({
  audioPreviewMock: {
    startPreview: vi.fn().mockResolvedValue(true),
    stopPreview: vi.fn().mockResolvedValue(undefined),
  },
  mockInvoke: vi.fn(async (command: string) => {
    if (command === "list_audio_input_devices") return [];
    if (command === "get_default_input_device_name") return null;
    return undefined;
  }),
  settingsState: {
    selectedLlmProviderId: "groq",
    selectedLlmModelId: "qwen/qwen3.8-27b",
    selectedWhisperModelId: "whisper-large-v3",
    selectedSttProviderId: "byteplus",
    selectedTranscriptionLocale: "zh-TW",
    selectedLocale: "zh-TW",
    selectedAudioInputDeviceName: "",
    themeMode: "system",
    hasApiKey: true,
    hasLlmApiKey: true,
    hasSttCredential: true,
    byteplusApiKey: "bp_key",
    apiKey: "gsk_test",
    isEnhancementThresholdEnabled: false,
    enhancementThresholdCharCount: 10,
    isRecordingAutoCleanupEnabled: false,
    recordingAutoCleanupDays: 7,
    isDebugLogEnabled: false,
    isAutoStartEnabled: false,
    isMuteOnRecordingEnabled: true,
    isSoundEffectsEnabled: true,
    isHideDockIconEnabled: false,
    isStartHiddenEnabled: false,
    isSmartDictionaryEnabled: false,
    isInputContextEnabled: false,
    isCopyTranscriptionToClipboardEnabled: true,
    hotkeyConfig: { triggerKey: "option", triggerMode: "hold" },
    triggerMode: "hold",
    getApiKey: () => "gsk_test",
    getSttApiKey: () => "bp_key",
    getLlmApiKey: () => "gsk_test",
    getWhisperLanguageCode: () => "zh",
    loadAutoStartStatus: vi.fn().mockResolvedValue(undefined),
    saveSttProvider: vi.fn().mockResolvedValue(undefined),
    saveByteplusApiKey: vi.fn().mockResolvedValue(undefined),
    deleteByteplusApiKey: vi.fn().mockResolvedValue(undefined),
    saveApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    saveLlmProvider: vi.fn(),
    saveLlmModel: vi.fn(),
    saveWhisperModel: vi.fn(),
    saveOpenaiApiKey: vi.fn(),
    deleteOpenaiApiKey: vi.fn(),
    saveAnthropicApiKey: vi.fn(),
    deleteAnthropicApiKey: vi.fn(),
    saveGeminiApiKey: vi.fn(),
    deleteGeminiApiKey: vi.fn(),
    saveEnhancementThreshold: vi.fn(),
    saveRecordingAutoCleanup: vi.fn(),
    saveDebugLog: vi.fn(),
    openDebugLogFolder: vi.fn(),
    saveMuteOnRecording: vi.fn(),
    saveSoundEffectsEnabled: vi.fn(),
    saveHideDockIcon: vi.fn(),
    saveStartHidden: vi.fn(),
    saveSmartDictionaryEnabled: vi.fn(),
    saveInputContextEnabled: vi.fn(),
    saveCopyTranscriptionToClipboard: vi.fn(),
    saveLocale: vi.fn(),
    saveTheme: vi.fn(),
    saveTranscriptionLocale: vi.fn(),
    saveAudioInputDevice: vi.fn(),
    saveHotkeyConfig: vi.fn(),
    toggleAutoStart: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED: false,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT: 10,
}));

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => ({
    deleteAllRecordingFiles: vi.fn(),
  }),
}));

vi.mock("../../src/composables/useAudioPreview", async () => {
  const { computed } = await import("vue");
  return {
    useAudioPreview: () => ({
      previewLevel: computed(() => 0),
      isPreviewActive: computed(() => false),
      startPreview: audioPreviewMock.startPreview,
      stopPreview: audioPreviewMock.stopPreview,
    }),
  };
});

vi.mock("../../src/composables/useHotkeyRecordingSession", () => ({
  useHotkeyRecordingSession: () => ({
    isRecording: { value: false },
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

import SettingsView from "../../src/views/SettingsView.vue";

function mountSettings() {
  return mount(SettingsView, {
    global: {
      plugins: [i18n],
      stubs: {
        ConnectionTestButton: true,
      },
    },
  });
}

describe("SettingsView — 轉錄服務", () => {
  it("[P0] 轉錄非 groq 且 LLM 為 groq 時，文字整理卡出現 Groq 金鑰欄", async () => {
    settingsState.selectedSttProviderId = "byteplus";
    settingsState.selectedLlmProviderId = "groq";

    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.find("#llm-groq-api-key").exists()).toBe(true);
    expect(wrapper.find("#byteplus-api-key").exists()).toBe(true);
  });

  it("[P0] 轉錄為 groq 時，文字整理卡只顯示共用金鑰提示，不重複金鑰欄", async () => {
    settingsState.selectedSttProviderId = "groq";
    settingsState.selectedLlmProviderId = "groq";

    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.find("#llm-groq-api-key").exists()).toBe(false);
    expect(wrapper.find("#groq-api-key").exists()).toBe(true);
  });
});

describe("SettingsView — 麥克風測試按鈕", () => {
  function mountWithDeviceList() {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "list_audio_input_devices") return [];
      if (command === "get_default_input_device_name") return null;
      return undefined;
    });
    return mountSettings();
  }

  it("[P0] 掛載時不自動開啟麥克風", async () => {
    audioPreviewMock.startPreview.mockClear();
    const wrapper = mountWithDeviceList();
    await flushPromises();

    expect(audioPreviewMock.startPreview).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("[P0] 按下「測試麥克風」才開始，10 秒後自動停止", async () => {
    vi.useFakeTimers();
    audioPreviewMock.startPreview.mockClear();
    audioPreviewMock.stopPreview.mockClear();

    const wrapper = mountWithDeviceList();
    await flushPromises();

    const button = wrapper
      .findAll("button")
      .find((item) => item.text().includes("測試麥克風"));
    expect(button).toBeDefined();
    await button!.trigger("click");
    await flushPromises();

    expect(audioPreviewMock.startPreview).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(audioPreviewMock.stopPreview).toHaveBeenCalled();

    vi.useRealTimers();
    wrapper.unmount();
  });
});
