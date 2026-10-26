import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

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

describe("useSettingsStore", () => {
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
  // loadSettings
  // ==========================================================================

  describe("loadSettings", () => {
    it("[P0] 應從 store 載入已儲存的 hotkey config", async () => {
      mockStoreData.set("hotkeyTriggerKey", "option");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("groqApiKey", "gsk_test123");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "option",
        triggerMode: "toggle",
      });
      expect(store.triggerMode).toBe("toggle");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 無儲存值時應使用平台預設值", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // 在 Node.js 環境中 navigator.userAgent 不含 "Mac"，預設為 rightAlt
      expect(store.hotkeyConfig?.triggerKey).toBeDefined();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P1] 載入後應同步 hotkey config 到 Rust", async () => {
      mockStoreData.set("hotkeyTriggerKey", "control");
      mockStoreData.set("hotkeyTriggerMode", "hold");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "control",
        triggerMode: "hold",
      });
    });

    it("[P1] store 載入失敗時應 fallback 到預設值", async () => {
      mockStoreGet.mockRejectedValueOnce(new Error("store corrupted"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).not.toBeNull();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P2] 重複呼叫 loadSettings 應只執行一次", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();
      await store.loadSettings();

      // store.get 在第一次 loadSettings 中被呼叫多次（key, mode, apiKey, prompt）
      // 第二次不應再呼叫
      const callCountAfterFirst = mockStoreGet.mock.calls.length;
      await store.loadSettings();
      expect(mockStoreGet.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  // ==========================================================================
  // saveHotkeyConfig
  // ==========================================================================

  describe("saveHotkeyConfig", () => {
    it("[P0] 應持久化 triggerKey 和 triggerMode 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("command", "toggle");

      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerKey", "command");
      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerMode", "toggle");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 應更新 hotkeyConfig ref", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("shift", "hold");

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "shift",
        triggerMode: "hold",
      });
      expect(store.triggerMode).toBe("hold");
    });

    it("[P0] 應透過 invoke 同步 config 到 Rust", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("fn", "toggle");

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "fn",
        triggerMode: "toggle",
      });
    });

    it("[P0] 應發送 SETTINGS_UPDATED 事件廣播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("option", "hold");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "hotkey",
        value: { triggerKey: "option", triggerMode: "hold" },
      });
    });

    it("[P1] SETTINGS_UPDATED payload 應包含正確的 key 和 value", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("control", "toggle");

      const emitCall = mockEmit.mock.calls[0];
      expect(emitCall[0]).toBe("settings:updated");
      expect(emitCall[1]).toEqual({
        key: "hotkey",
        value: { triggerKey: "control", triggerMode: "toggle" },
      });
    });
  });

  // ==========================================================================
  // saveApiKey
  // ==========================================================================

  describe("saveApiKey", () => {
    it("[P0] 應儲存 trimmed API key", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveApiKey("  gsk_abc123  ");

      expect(mockStoreSet).toHaveBeenCalledWith("groqApiKey", "gsk_abc123");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 空白 API key 應拋出錯誤", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveApiKey("   ")).rejects.toThrow(
        "API Key 不可為空白",
      );
    });
  });

  // ==========================================================================
  // deleteApiKey
  // ==========================================================================

  describe("deleteApiKey", () => {
    it("[P0] 應從 store 刪除 API key 並清空狀態", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveApiKey("gsk_test");
      expect(store.hasApiKey).toBe(true);

      await store.deleteApiKey();

      expect(mockStoreDelete).toHaveBeenCalledWith("groqApiKey");
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.hasApiKey).toBe(false);
    });
  });

  // ==========================================================================
  // saveEnhancementThreshold
  // ==========================================================================

  describe("saveEnhancementThreshold", () => {
    it("[P0] 應持久化 enabled 和 charCount 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 20);

      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdEnabled",
        false,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        20,
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 應更新 reactive refs", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 25);

      expect(store.isEnhancementThresholdEnabled).toBe(false);
      expect(store.enhancementThresholdCharCount).toBe(25);
    });

    it("[P0] 應發送 SETTINGS_UPDATED 事件廣播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 15);

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "enhancementThreshold",
        value: { enabled: true, charCount: 15 },
      });
    });

    it("[P1] charCount < 1 應 fallback 到預設值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 0);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] 非整數 charCount 應 fallback 到預設值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 3.5);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] store 儲存失敗時應拋出錯誤", async () => {
      mockStoreSave.mockRejectedValueOnce(new Error("disk full"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveEnhancementThreshold(true, 10)).rejects.toThrow(
        "disk full",
      );
    });
  });

  // ==========================================================================
  // refreshCrossWindowSettings
  // ==========================================================================

  describe("saveHideDockIcon (gh-56)", () => {
    let uaSpy: ReturnType<typeof vi.spyOn> | null = null;

    function stubMacUserAgent() {
      uaSpy = vi
        .spyOn(window.navigator, "userAgent", "get")
        .mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    }

    afterEach(() => {
      uaSpy?.mockRestore();
      uaSpy = null;
    });

    it("[P1] 應持久化 hideDockIcon 並 emit settings:updated", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHideDockIcon(true);

      expect(mockStoreSet).toHaveBeenCalledWith("hideDockIcon", true);
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.isHideDockIconEnabled).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "hideDockIcon",
        value: true,
      });
    });

    it("[P1] macOS 上切換隱藏應呼叫 set_dock_icon_hidden（gh-82）", async () => {
      stubMacUserAgent();
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHideDockIcon(true);
      expect(mockInvoke).toHaveBeenLastCalledWith("set_dock_icon_hidden", {
        hidden: true,
      });

      await store.saveHideDockIcon(false);
      expect(mockInvoke).toHaveBeenLastCalledWith("set_dock_icon_hidden", {
        hidden: false,
      });
    });

    it("[P2] 非 macOS 不呼叫 set_dock_icon_hidden", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHideDockIcon(true);

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "set_dock_icon_hidden",
        expect.anything(),
      );
    });

    it("[P2] set_dock_icon_hidden 失敗不應讓儲存失敗", async () => {
      stubMacUserAgent();
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveHideDockIcon(true)).resolves.toBeUndefined();
      expect(store.isHideDockIconEnabled).toBe(true);
      expect(mockStoreSet).toHaveBeenCalledWith("hideDockIcon", true);
    });

    it("[P2] loadSettings 應載入已儲存的 hideDockIcon", async () => {
      mockStoreData.set("hideDockIcon", true);
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.isHideDockIconEnabled).toBe(true);
    });

    it("[P2] loadSettings 未存過 hideDockIcon 時預設 false", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.isHideDockIconEnabled).toBe(false);
    });
  });

  // ==========================================================================
  // startHidden（gh-76：啟動時隱藏主視窗）
  // ==========================================================================

  describe("startHidden", () => {
    it("[P1] 應持久化 startHidden 並 emit settings:updated", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveStartHidden(true);

      expect(mockStoreSet).toHaveBeenCalledWith("startHidden", true);
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.isStartHiddenEnabled).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "startHidden",
        value: true,
      });
    });

    it("[P1] loadSettings 應載入已儲存的 startHidden", async () => {
      mockStoreData.set("startHidden", true);
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.isStartHiddenEnabled).toBe(true);
    });

    it("[P2] loadSettings 未存過 startHidden 時預設 false", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.isStartHiddenEnabled).toBe(false);
    });

    it("[P1] refreshCrossWindowSettings 應同步另一視窗改過的 startHidden", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      expect(store.isStartHiddenEnabled).toBe(false);

      mockStoreData.set("startHidden", true);
      await store.refreshCrossWindowSettings();
      expect(store.isStartHiddenEnabled).toBe(true);
    });
  });

  describe("hideDockIcon 跨視窗同步（gh-82）", () => {
    let uaSpy: ReturnType<typeof vi.spyOn> | null = null;

    afterEach(() => {
      uaSpy?.mockRestore();
      uaSpy = null;
    });

    it("[P1] macOS 上另一視窗改了 hideDockIcon，應呼叫 set_dock_icon_hidden", async () => {
      uaSpy = vi
        .spyOn(window.navigator, "userAgent", "get")
        .mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();
      mockInvoke.mockClear();

      mockStoreData.set("hideDockIcon", true);
      await store.refreshCrossWindowSettings();
      await vi.waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith("set_dock_icon_hidden", {
          hidden: true,
        }),
      );
    });
  });

  describe("refreshCrossWindowSettings", () => {
    it("[P0] 應整包重新讀取跨視窗會用到的設定", async () => {
      mockStoreData.set("hotkeyTriggerKey", "command");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("customTriggerKey", { custom: { keycode: 321 } });
      mockStoreData.set("customTriggerKeyDomCode", "F13");
      mockStoreData.set("groqApiKey", "  gsk_sync  ");
      mockStoreData.set("aiPrompt", "  同步後 prompt  ");
      mockStoreData.set("promptMode", "custom");
      mockStoreData.set("enhancementThresholdEnabled", true);
      mockStoreData.set("enhancementThresholdCharCount", 42);
      mockStoreData.set("llmModelId", "openai/gpt-oss-120b");
      mockStoreData.set("whisperModelId", "whisper-large-v3-turbo");
      mockStoreData.set("muteOnRecording", false);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.refreshCrossWindowSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "command",
        triggerMode: "toggle",
      });
      expect(store.customTriggerKey).toEqual({ custom: { keycode: 321 } });
      expect(store.customTriggerKeyDomCode).toBe("F13");
      expect(store.getApiKey()).toBe("gsk_sync");
      // 舊 promptMode／aiPrompt 留在磁碟但不讀：行為等於精簡
      expect(store.getAiPrompt()).not.toBe("同步後 prompt");
      expect(store.getAiPrompt().length).toBeGreaterThan(0);
      expect(store.isEnhancementThresholdEnabled).toBe(true);
      expect(store.enhancementThresholdCharCount).toBe(42);
      expect(store.selectedLlmModelId).toBe("openai/gpt-oss-120b");
      expect(store.selectedWhisperModelId).toBe("whisper-large-v3-turbo");
      expect(store.isMuteOnRecordingEnabled).toBe(false);
    });
  });

  // ==========================================================================
  // selectedTranscriptionLocale
  // ==========================================================================

  describe("selectedTranscriptionLocale", () => {
    it("[P0] loadSettings 應從 store 載入已儲存的 transcriptionLocale", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("ja");
    });

    it("[P0] store 無 selectedTranscriptionLocale 時應預設為 selectedLocale（遷移）", async () => {
      mockStoreData.set("selectedLocale", "ko");
      // 不設定 selectedTranscriptionLocale 以觸發遷移邏輯

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("ko");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "ko",
      );
    });

    it("[P0] getWhisperLanguageCode 應讀取 selectedTranscriptionLocale（非 selectedLocale）", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      // transcriptionLocale 是 ja，不是 UI locale en
      expect(store.getWhisperLanguageCode()).toBe("ja");
    });

    it("[P0] getWhisperLanguageCode 在 auto 模式下應回傳 null", async () => {
      mockStoreData.set("selectedLocale", "zh-TW");
      mockStoreData.set("selectedTranscriptionLocale", "auto");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.getWhisperLanguageCode()).toBeNull();
    });

    it("[P0] 已存 yue → 遷移為 auto 並寫回磁碟（不走 saveTranscriptionLocale）", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "yue");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("auto");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "auto",
      );
      expect(mockStoreSave).toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalledWith(
        "settings:updated",
        expect.objectContaining({ key: "transcriptionLocale" }),
      );
      expect(store.getWhisperLanguageCode()).toBeNull();

      const { getAutoLanguagePrompt } = await import("../../src/i18n/prompts");
      expect(store.getAiPrompt()).toBe(getAutoLanguagePrompt("en"));
    });

    it("[P0] 遷移後第二次載入不再寫回磁碟", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "yue");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      mockStoreSet.mockClear();
      await store.refreshCrossWindowSettings();

      expect(
        mockStoreSet.mock.calls.filter(
          ([key]: [string, unknown]) => key === "selectedTranscriptionLocale",
        ),
      ).toHaveLength(0);
    });

    it("[P0] 已存 ja 不遷移、不寫回", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.selectedTranscriptionLocale).toBe("ja");
      expect(
        mockStoreSet.mock.calls.filter(
          ([key]: [string, unknown]) => key === "selectedTranscriptionLocale",
        ),
      ).toHaveLength(0);
    });

    it("[P0] 跨視窗刷新讀到 yue 也遷移為 auto 並寫回", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "yue");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.refreshCrossWindowSettings();

      expect(store.selectedTranscriptionLocale).toBe("auto");
      expect(mockStoreSet).toHaveBeenCalledWith(
        "selectedTranscriptionLocale",
        "auto",
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] refreshCrossWindowSettings 應同步 selectedTranscriptionLocale", async () => {
      mockStoreData.set("selectedLocale", "en");
      mockStoreData.set("selectedTranscriptionLocale", "ja");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.refreshCrossWindowSettings();

      expect(store.selectedTranscriptionLocale).toBe("ja");
    });
  });

  // ==========================================================================
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') should persist to store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale should emit SETTINGS_UPDATED event", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("ja");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "locale",
        value: "ja",
      });
    });
  });

  // ==========================================================================
  // loadSettings locale
  // ==========================================================================

  describe("loadSettings locale", () => {
    it("[P0] should load saved locale from store", async () => {
      mockStoreData.set("selectedLocale", "en");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // When a saved locale exists, loadSettings should NOT re-set it
      // (the "first launch" path calls store.set("selectedLocale", detected))
      const selectedLocaleSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string]) => key === "selectedLocale",
      );
      expect(selectedLocaleSetCallList).toHaveLength(0);
    });
  });
});

describe("resolveLlmProviderId（預設改 Gemini 的舊使用者遷移）", () => {
  it("[P0] 有存過 provider 就照用", async () => {
    const { resolveLlmProviderId } = await import(
      "../../src/stores/useSettingsStore"
    );
    expect(resolveLlmProviderId("openai", "gsk_x")).toBe("openai");
    expect(resolveLlmProviderId("gemini", "")).toBe("gemini");
  });

  it("[P0] 沒存過 provider、已有 Groq key 的舊使用者留在 groq", async () => {
    const { resolveLlmProviderId } = await import(
      "../../src/stores/useSettingsStore"
    );
    expect(resolveLlmProviderId(null, "gsk_x")).toBe("groq");
    expect(resolveLlmProviderId(undefined, " gsk_x ")).toBe("groq");
  });

  it("[P0] 全新安裝（沒有 provider 也沒有 Groq key）用新預設 gemini", async () => {
    const { resolveLlmProviderId } = await import(
      "../../src/stores/useSettingsStore"
    );
    expect(resolveLlmProviderId(null, null)).toBe("gemini");
    expect(resolveLlmProviderId(undefined, "   ")).toBe("gemini");
  });
});

describe("useSettingsStore — STT provider", () => {
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

  it("[P0] 沒有存過 provider 時預設 groq", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    expect(store.selectedSttProviderId).toBe("groq");
    expect(store.hasSttCredential).toBe(false);
  });

  it("[P0] 非法 provider 值回退 groq", async () => {
    mockStoreData.set("sttProviderId", "openai");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    expect(store.selectedSttProviderId).toBe("groq");
  });

  it("[P0] 非 Mac 讀到 apple → groq，且用 store.set/save 寫回、不 emit", async () => {
    mockStoreData.set("sttProviderId", "apple");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    expect(store.selectedSttProviderId).toBe("groq");
    expect(mockStoreSet).toHaveBeenCalledWith("sttProviderId", "groq");
    expect(mockStoreSave).toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(
      "settings:updated",
      expect.objectContaining({ key: "sttProvider" }),
    );
  });

  it("[P0] getSttApiKey／hasSttCredential 依 provider 切換", async () => {
    mockStoreData.set("groqApiKey", "gsk_groq");
    mockStoreData.set("byteplusApiKey", "bp_key");
    mockStoreData.set("sttProviderId", "groq");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    expect(store.getSttApiKey()).toBe("gsk_groq");
    expect(store.hasSttCredential).toBe(true);

    await store.saveSttProvider("byteplus");
    expect(store.getSttApiKey()).toBe("bp_key");
    expect(store.hasSttCredential).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
      key: "sttProvider",
      value: "byteplus",
    });

    await store.deleteByteplusApiKey();
    expect(store.getSttApiKey()).toBe("");
    expect(store.hasSttCredential).toBe(false);

    await store.saveSttProvider("apple");
    expect(store.getSttApiKey()).toBe("");
    expect(store.hasSttCredential).toBe(true);
  });

  it("[P0] saveByteplusApiKey 去空白、持久化並 emit", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    await store.saveByteplusApiKey("  bp_secret  ");
    expect(store.byteplusApiKey).toBe("bp_secret");
    expect(mockStoreData.get("byteplusApiKey")).toBe("bp_secret");
    expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
      key: "byteplusApiKey",
      value: "bp_secret",
    });
  });

  it("[P0] refreshSttApiKey 依 provider 重讀對應鍵", async () => {
    mockStoreData.set("sttProviderId", "byteplus");
    mockStoreData.set("byteplusApiKey", "old");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    mockStoreData.set("byteplusApiKey", "new_value");
    await store.refreshSttApiKey();
    expect(store.getSttApiKey()).toBe("new_value");

    await store.saveSttProvider("groq");
    mockStoreData.set("groqApiKey", "gsk_new");
    await store.refreshSttApiKey();
    expect(store.getSttApiKey()).toBe("gsk_new");
  });

  it("[P0] refreshCrossWindowSettings 讀 sttProviderId 與 byteplusApiKey", async () => {
    mockStoreData.set("sttProviderId", "byteplus");
    mockStoreData.set("byteplusApiKey", "bp_cross");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    mockStoreData.set("sttProviderId", "groq");
    mockStoreData.set("byteplusApiKey", "bp_updated");
    await store.refreshCrossWindowSettings();

    expect(store.selectedSttProviderId).toBe("groq");
    expect(store.byteplusApiKey).toBe("bp_updated");
  });
});
