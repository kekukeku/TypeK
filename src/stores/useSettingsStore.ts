import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  type ComboTriggerKey,
  type ChordTriggerKey,
  type ThemeMode,
  isCustomTriggerKey,
  isComboTriggerKey,
  isChordTriggerKey,
  isRecordedTriggerKey,
  isPresetTriggerKey,
} from "../types/settings";
import {
  getKeyDisplayName,
  getComboTriggerKeyDisplayName,
  getChordTriggerKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
} from "../lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { openLogFolder, setFileLoggingEnabled } from "../lib/logger";
import {
  type PromptLocale,
  getAutoLanguagePrompt,
  getMinimalPromptForLocale,
} from "../i18n/prompts";
import i18n from "../i18n";
import {
  type SupportedLocale,
  type TranscriptionLocale,
  FALLBACK_LOCALE,
  LANGUAGE_OPTIONS,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
} from "../i18n/languageConfig";
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";
import { applyTheme, DEFAULT_THEME_MODE, isThemeMode } from "../lib/theme";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_STT_PROVIDER_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  getDefaultModelIdForProvider,
  findLlmModelConfig,
  type LlmModelId,
  type LlmProviderId,
  type SttProviderId,
  type WhisperModelId,
} from "../lib/modelRegistry";

declare const __APP_VERSION__: string;

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = navigator.userAgent.includes("Mac"); // macOS only — Windows 尚未支援 text field 讀取
const DEFAULT_INPUT_CONTEXT_ENABLED = navigator.userAgent.includes("Mac"); // macOS only — Windows 版 read_input_context 回空內容
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
const DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED = false;
const DEFAULT_RECORDING_AUTO_CLEANUP_DAYS = 7;
const DEFAULT_DEBUG_LOG_ENABLED = false;
const DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD = false;
const DEFAULT_HIDE_DOCK_ICON = false;
const DEFAULT_START_HIDDEN = false;
const IS_MACOS = navigator.userAgent.includes("Mac");

/**
 * 解析 LLM provider：有存過就用存的。預設 provider 曾是 groq，
 * 從沒存過 provider、但已設好 Groq key 的舊使用者固定留在 groq，
 * 升版後不會突然要求 Gemini key（docs/plan-input-context.md）。
 */
export function resolveLlmProviderId(
  savedLlmProviderId: LlmProviderId | null | undefined,
  savedGroqApiKey: string | null | undefined,
): LlmProviderId {
  if (savedLlmProviderId) return savedLlmProviderId;
  return savedGroqApiKey?.trim() ? "groq" : DEFAULT_LLM_PROVIDER_ID;
}

/**
 * 轉錄服務：缺值／非法值一律 groq；非 Mac 讀到 apple 也回 groq
 * （呼叫端負責把修正後的值寫回 store，不 emit 事件）。
 */
export function resolveSttProviderId(
  savedProviderId: unknown,
  isMac: boolean = IS_MACOS,
): SttProviderId {
  if (savedProviderId === "byteplus") return "byteplus";
  if (savedProviderId === "apple") return isMac ? "apple" : "groq";
  return "groq";
}

/** 已存的說話語言若不在支援清單（例如已移除的語言），遷移為 auto 並寫回磁碟。 */
const TRANSCRIPTION_LOCALE_SET = new Set<string>([
  "auto",
  ...LANGUAGE_OPTIONS.map((option) => option.locale),
]);

function resolveStoredTranscriptionLocale(value: unknown): {
  locale: TranscriptionLocale | null;
  shouldPersist: boolean;
} {
  if (typeof value !== "string" || value === "") {
    return { locale: null, shouldPersist: false };
  }
  if (TRANSCRIPTION_LOCALE_SET.has(value)) {
    return { locale: value as TranscriptionLocale, shouldPersist: false };
  }
  return { locale: "auto", shouldPersist: true };
}

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (⌥)",
  rightOption: "Right Option (⌥)",
  command: "Command (⌘)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (⌃)",
  rightControl: "Right Control",
  shift: "Shift (⇧)",
};

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  const apiKey = ref<string>("");
  const hasApiKey = computed(() => apiKey.value !== "");
  const showPromptUpgradeNotice = ref(false);
  const isAutoStartEnabled = ref(false);
  const isEnhancementThresholdEnabled = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  );
  const enhancementThresholdCharCount = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  );
  const selectedLlmProviderId = ref<LlmProviderId>(DEFAULT_LLM_PROVIDER_ID);
  const selectedLlmModelId = ref<LlmModelId>(DEFAULT_LLM_MODEL_ID);
  const selectedWhisperModelId = ref<WhisperModelId>(DEFAULT_WHISPER_MODEL_ID);
  const openaiApiKey = ref<string>("");
  const anthropicApiKey = ref<string>("");
  const geminiApiKey = ref<string>("");
  const selectedSttProviderId = ref<SttProviderId>(DEFAULT_STT_PROVIDER_ID);
  const byteplusApiKey = ref<string>("");
  const hasSttCredential = computed(() => {
    switch (selectedSttProviderId.value) {
      case "groq":
        return apiKey.value !== "";
      case "byteplus":
        return byteplusApiKey.value !== "";
      case "apple":
        // macOS 內建免金鑰；授權狀態由設定頁另外顯示／檢查
        return true;
      default:
        selectedSttProviderId.value satisfies never;
        return false;
    }
  });
  const hasLlmApiKey = computed(() => {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value !== "";
      case "openai":
        return openaiApiKey.value !== "";
      case "anthropic":
        return anthropicApiKey.value !== "";
      case "gemini":
        return geminiApiKey.value !== "";
      default:
        // exhaustiveness：若 LlmProviderId 新增成員，這行會 type error
        selectedLlmProviderId.value satisfies never;
        return false;
    }
  });
  const customTriggerKey = ref<CustomTriggerKey | ComboTriggerKey | ChordTriggerKey | null>(null);
  const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);
  const isSmartDictionaryEnabled = ref<boolean>(
    DEFAULT_SMART_DICTIONARY_ENABLED,
  );
  const isInputContextEnabled = ref<boolean>(DEFAULT_INPUT_CONTEXT_ENABLED);
  const customTriggerKeyDomCode = ref<string>("");
  const selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE);
  const selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE);
  const themeMode = ref<ThemeMode>(DEFAULT_THEME_MODE);
  const isSoundEffectsEnabled = ref<boolean>(DEFAULT_SOUND_EFFECTS_ENABLED);
  const isHideDockIconEnabled = ref<boolean>(DEFAULT_HIDE_DOCK_ICON);
  // gh-76：啟動時隱藏主視窗（HUD 讀此值決定是否 show main-window）
  const isStartHiddenEnabled = ref<boolean>(DEFAULT_START_HIDDEN);
  const isRecordingAutoCleanupEnabled = ref<boolean>(
    DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
  );
  const recordingAutoCleanupDays = ref<number>(
    DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
  );
  // 除錯記錄（Debug Log）— 與錄音清理完全獨立的設定
  const isDebugLogEnabled = ref<boolean>(DEFAULT_DEBUG_LOG_ENABLED);
  const selectedAudioInputDeviceName = ref<string>("");
  const isCopyTranscriptionToClipboardEnabled = ref<boolean>(
    DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD,
  );
  let isLoaded = false;

  /** Resolve which prompt locale to use for prompt default (shared logic). */
  function getEffectivePromptLocale(): PromptLocale {
    return selectedTranscriptionLocale.value === "auto"
      ? selectedLocale.value
      : selectedTranscriptionLocale.value;
  }

  function getApiKey(): string {
    return apiKey.value;
  }

  function getSttApiKey(): string {
    switch (selectedSttProviderId.value) {
      case "groq":
        return apiKey.value;
      case "byteplus":
        return byteplusApiKey.value;
      case "apple":
        return "";
    }
  }

  function getLlmApiKey(): string {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value;
      case "openai":
        return openaiApiKey.value;
      case "anthropic":
        return anthropicApiKey.value;
      case "gemini":
        return geminiApiKey.value;
    }
  }

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] Failed to sync hotkey config:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "sync-hotkey" });
    }
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedApiKey = await store.get<string>("groqApiKey");

      // Backward-compatible key parsing: string → PresetTriggerKey, object → CustomTriggerKey
      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      apiKey.value = savedApiKey?.trim() ?? "";

      // 轉錄服務：升級使用者缺值即 groq；非 Mac 讀到 apple 要寫回修正值（不 emit）
      const savedSttProviderId = await store.get<unknown>("sttProviderId");
      selectedSttProviderId.value = resolveSttProviderId(savedSttProviderId);
      if (
        typeof savedSttProviderId === "string" &&
        savedSttProviderId !== selectedSttProviderId.value
      ) {
        await store.set("sttProviderId", selectedSttProviderId.value);
        await store.save();
      }
      const savedByteplusApiKey = await store.get<string>("byteplusApiKey");
      byteplusApiKey.value = savedByteplusApiKey?.trim() ?? "";

      // Load independently persisted custom/combo key
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      if (
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        isRecordedTriggerKey(savedCustomKey)
      ) {
        customTriggerKey.value = savedCustomKey;
        customTriggerKeyDomCode.value = savedCustomDomCode ?? "";
      }

      // Load locale (first launch: detect system language, upgrade: fallback to zh-TW)
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      if (savedLocale) {
        selectedLocale.value = savedLocale;
      } else {
        const detected = detectSystemLocale();
        selectedLocale.value = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      // Load transcription locale (migration: default to UI locale if missing)
      const savedTranscriptionLocale = await store.get<unknown>(
        "selectedTranscriptionLocale",
      );
      const storedTranscriptionLocale = resolveStoredTranscriptionLocale(
        savedTranscriptionLocale,
      );
      if (storedTranscriptionLocale.locale) {
        selectedTranscriptionLocale.value = storedTranscriptionLocale.locale;
        if (storedTranscriptionLocale.shouldPersist) {
          await store.set(
            "selectedTranscriptionLocale",
            storedTranscriptionLocale.locale,
          );
          await store.save();
        }
      } else {
        selectedTranscriptionLocale.value = selectedLocale.value;
        await store.set("selectedTranscriptionLocale", selectedLocale.value);
        await store.save();
      }

      // Load theme mode (default: follow system)
      const savedThemeMode = await store.get<ThemeMode>("themeMode");
      themeMode.value = isThemeMode(savedThemeMode)
        ? savedThemeMode
        : DEFAULT_THEME_MODE;
      applyTheme(themeMode.value);

      // 舊版整理指示設定不再讀取；鍵留在磁碟上，回退舊版時仍找得到原文

      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;

      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;

      // LLM Provider
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      selectedLlmProviderId.value = resolveLlmProviderId(
        savedLlmProviderId,
        savedApiKey,
      );
      if (!savedLlmProviderId) {
        // 推斷結果寫回 store，之後不再推斷（使用者之後補上 Groq key 也不會被切走）
        await store.set("llmProviderId", selectedLlmProviderId.value);
        await store.save();
      }

      // OpenAI / Anthropic API keys
      const savedOpenaiApiKey = await store.get<string>("openaiApiKey");
      openaiApiKey.value = savedOpenaiApiKey?.trim() ?? "";
      const savedAnthropicApiKey = await store.get<string>("anthropicApiKey");
      anthropicApiKey.value = savedAnthropicApiKey?.trim() ?? "";
      const savedGeminiApiKey = await store.get<string>("geminiApiKey");
      geminiApiKey.value = savedGeminiApiKey?.trim() ?? "";

      // LLM Model ID（含 Kimi K2 遷移）
      const savedLlmModelId = await store.get<string>("llmModelId");
      const llmMigratedFromKimiK2 = await store.get<boolean>(
        "llmMigratedFromKimiK2",
      );
      if (
        !llmMigratedFromKimiK2 &&
        savedLlmModelId === "moonshotai/kimi-k2-instruct"
      ) {
        // 留在 groq：不能借用全域預設（已改為 Gemini），否則 model 與 provider 錯配
        selectedLlmModelId.value = getDefaultModelIdForProvider("groq");
        selectedLlmProviderId.value = "groq";
        await store.set("llmModelId", selectedLlmModelId.value);
        await store.set("llmProviderId", "groq");
        await store.set("llmMigratedFromKimiK2", true);
        await store.save();
      } else {
        const effectiveLlmModelId = getEffectiveLlmModelId(
          savedLlmModelId ?? null,
        );
        selectedLlmModelId.value = effectiveLlmModelId;
      }

      // model-provider 交叉驗證：防止 key 洩漏到錯誤 provider
      const modelConfig = findLlmModelConfig(selectedLlmModelId.value);
      if (modelConfig && modelConfig.providerId !== selectedLlmProviderId.value) {
        selectedLlmModelId.value = getDefaultModelIdForProvider(
          selectedLlmProviderId.value,
        );
        await store.set("llmModelId", selectedLlmModelId.value);
        await store.save();
      }

      const savedWhisperModelId = await store.get<string>("whisperModelId");
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );

      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;

      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;

      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      isHideDockIconEnabled.value = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;

      const savedStartHidden = await store.get<boolean>("startHidden");
      isStartHiddenEnabled.value = savedStartHidden ?? DEFAULT_START_HIDDEN;

      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedInputContext = await store.get<boolean>("inputContextEnabled");
      isInputContextEnabled.value =
        savedInputContext ?? DEFAULT_INPUT_CONTEXT_ENABLED;

      const savedRecordingAutoCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecordingAutoCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;

      const savedRecordingAutoCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecordingAutoCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedDebugLogEnabled = await store.get<boolean>("debugLogEnabled");
      isDebugLogEnabled.value = savedDebugLogEnabled ?? DEFAULT_DEBUG_LOG_ENABLED;

      const savedAudioInputDeviceName = await store.get<string>(
        "audioInputDeviceName",
      );
      selectedAudioInputDeviceName.value = savedAudioInputDeviceName ?? "";

      // 1.3.3 一次性遷移：預設改成「不留在剪貼簿」，貼完還原使用者原本內容。
      // 有旗標後就完全照使用者自己的選擇，不再覆寫。
      const isCopyTranscriptionDefaultMigrated = await store.get<boolean>(
        "copyTranscriptionDefaultMigrated",
      );
      if (!isCopyTranscriptionDefaultMigrated) {
        isCopyTranscriptionToClipboardEnabled.value = false;
        await store.set("copyTranscriptionToClipboard", false);
        await store.set("copyTranscriptionDefaultMigrated", true);
        await store.save();
      } else {
        const savedCopyTranscriptionToClipboard = await store.get<boolean>(
          "copyTranscriptionToClipboard",
        );
        isCopyTranscriptionToClipboardEnabled.value =
          savedCopyTranscriptionToClipboard ??
          DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
      }

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
      isEnhancementThresholdEnabled.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      isMuteOnRecordingEnabled.value = DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value = DEFAULT_SOUND_EFFECTS_ENABLED;
      isHideDockIconEnabled.value = DEFAULT_HIDE_DOCK_ICON;
      isStartHiddenEnabled.value = DEFAULT_START_HIDDEN;
      isCopyTranscriptionToClipboardEnabled.value =
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
    }
  }

  async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync to Rust immediately
      await syncHotkeyConfigToRust(key, mode);

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  }

  async function saveCustomTriggerKey(
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      // Persist custom key independently (survives mode switching)
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = customKey;
      customTriggerKeyDomCode.value = domCode;

      // Reuse shared logic for active key + Rust sync + event broadcast
      await saveHotkeyConfig(customKey, mode);

      console.log(
        `[useSettingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  /** Combo（修飾鍵＋主鍵）與 Chord（純修飾鍵和弦，gh-30）共用同一儲存入口 */
  async function saveComboTriggerKey(
    comboKey: ComboTriggerKey | ChordTriggerKey,
    domCode: string,
    mode: TriggerMode,
  ) {
    try {
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", comboKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = comboKey;
      customTriggerKeyDomCode.value = domCode;

      await saveHotkeyConfig(comboKey, mode);

      console.log(
        `[useSettingsStore] Combo/Chord trigger key saved: ${JSON.stringify(comboKey)}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveComboTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode) {
    // Only update active key; keep customTriggerKey intact
    await saveHotkeyConfig(presetKey, mode);
  }

  async function switchToCustomMode(mode: TriggerMode) {
    if (!customTriggerKey.value) return;
    // Restore custom key as active key
    await saveHotkeyConfig(customTriggerKey.value, mode);
  }

  function getTriggerKeyDisplayName(key: TriggerKey): string {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    if (isComboTriggerKey(key)) {
      return getComboTriggerKeyDisplayName(key);
    }
    if (isChordTriggerKey(key)) {
      return getChordTriggerKeyDisplayName(key);
    }
    if (isCustomTriggerKey(key)) {
      // For custom keys, use saved DOM code to look up display name
      if (customTriggerKeyDomCode.value) {
        return getKeyDisplayName(customTriggerKeyDomCode.value);
      }
      return i18n.global.t("settings.hotkey.customKeyDisplay", {
        keycode: key.custom.keycode,
      });
    }
    return String(key);
  }

  async function saveApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      apiKey.value = trimmedKey;

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-api-key" });
      throw err;
    }
  }

  async function refreshApiKey() {
    try {
      const store = await load(STORE_NAME);
      const savedApiKey = await store.get<string>("groqApiKey");
      apiKey.value = savedApiKey?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function deleteApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("groqApiKey");
      await store.save();
      apiKey.value = "";

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveSttProvider(providerId: SttProviderId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("sttProviderId", providerId);
      await store.save();
      selectedSttProviderId.value = providerId;

      const payload: SettingsUpdatedPayload = {
        key: "sttProvider",
        value: providerId,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] STT provider saved: ${providerId}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSttProvider failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-stt-provider" });
      throw err;
    }
  }

  async function saveByteplusApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("byteplusApiKey", trimmedKey);
      await store.save();
      byteplusApiKey.value = trimmedKey;

      const payload: SettingsUpdatedPayload = {
        key: "byteplusApiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] BytePlus API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveByteplusApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-byteplus-api-key",
      });
      throw err;
    }
  }

  async function deleteByteplusApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("byteplusApiKey");
      await store.save();
      byteplusApiKey.value = "";

      const payload: SettingsUpdatedPayload = {
        key: "byteplusApiKey",
        value: "",
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log("[useSettingsStore] BytePlus API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteByteplusApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshSttApiKey() {
    if (selectedSttProviderId.value === "groq") {
      await refreshApiKey();
      return;
    }
    if (selectedSttProviderId.value === "apple") return;
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<string>("byteplusApiKey");
      byteplusApiKey.value = savedKey?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshSttApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  function getAiPrompt(): string {
    // #83：辨識語言「自動」時不再退回介面語言的輸出要求（那會把整理變成翻譯）
    if (selectedTranscriptionLocale.value === "auto") {
      return getAutoLanguagePrompt(selectedLocale.value);
    }
    return getMinimalPromptForLocale(getEffectivePromptLocale());
  }

  /** 只由 Dashboard (main-window.ts) 呼叫，比對版本號決定是否顯示升級提示 */
  async function consumeUpgradeNotice() {
    try {
      const store = await load(STORE_NAME);
      const lastSeenVersion = await store.get<string>("lastSeenVersion");

      if (lastSeenVersion === null || lastSeenVersion === undefined) {
        // 區分首次安裝 vs 舊版升級：有 API key = 老使用者
        const existingApiKey = await store.get<string>("groqApiKey");
        if (existingApiKey) {
          showPromptUpgradeNotice.value = true;
        }
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
        return;
      }

      if (lastSeenVersion !== __APP_VERSION__) {
        showPromptUpgradeNotice.value = true;
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] consumeUpgradeNotice failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveEnhancementThreshold(enabled: boolean, charCount: number) {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      isEnhancementThresholdEnabled.value = enabled;
      enhancementThresholdCharCount.value = validatedCharCount;

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmModel(id: LlmModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", id);
      await store.save();
      selectedLlmModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmProvider(providerId: LlmProviderId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmProviderId", providerId);

      // 切換 provider 時重設為該 provider 預設模型
      const defaultModelId = getDefaultModelIdForProvider(providerId);
      await store.set("llmModelId", defaultModelId);
      await store.save();

      selectedLlmProviderId.value = providerId;
      selectedLlmModelId.value = defaultModelId;

      const payload: SettingsUpdatedPayload = {
        key: "llmProvider",
        value: providerId,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] LLM provider saved: ${providerId}, model reset to: ${defaultModelId}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmProvider failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-provider" });
      throw err;
    }
  }

  async function saveOpenaiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("openaiApiKey", trimmedKey);
      await store.save();
      openaiApiKey.value = trimmedKey;
      console.log("[useSettingsStore] OpenAI API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-openai-api-key" });
      throw err;
    }
  }

  async function deleteOpenaiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("openaiApiKey");
      await store.save();
      openaiApiKey.value = "";
      console.log("[useSettingsStore] OpenAI API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveAnthropicApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("anthropicApiKey", trimmedKey);
      await store.save();
      anthropicApiKey.value = trimmedKey;
      console.log("[useSettingsStore] Anthropic API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-anthropic-api-key",
      });
      throw err;
    }
  }

  async function deleteAnthropicApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("anthropicApiKey");
      await store.save();
      anthropicApiKey.value = "";
      console.log("[useSettingsStore] Anthropic API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveGeminiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("geminiApiKey", trimmedKey);
      await store.save();
      geminiApiKey.value = trimmedKey;
      console.log("[useSettingsStore] Gemini API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-gemini-api-key",
      });
      throw err;
    }
  }

  async function deleteGeminiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("geminiApiKey");
      await store.save();
      geminiApiKey.value = "";
      console.log("[useSettingsStore] Gemini API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshLlmApiKey() {
    try {
      const store = await load(STORE_NAME);
      switch (selectedLlmProviderId.value) {
        case "groq": {
          const savedApiKey = await store.get<string>("groqApiKey");
          apiKey.value = savedApiKey?.trim() ?? "";
          break;
        }
        case "openai": {
          const savedKey = await store.get<string>("openaiApiKey");
          openaiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "anthropic": {
          const savedKey = await store.get<string>("anthropicApiKey");
          anthropicApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "gemini": {
          const savedKey = await store.get<string>("geminiApiKey");
          geminiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshLlmApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveWhisperModel(id: WhisperModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperModelId", id);
      await store.save();
      selectedWhisperModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "whisperModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Whisper model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveWhisperModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function loadAutoStartStatus() {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      isAutoStartEnabled.value = await isEnabled();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function toggleAutoStart() {
    try {
      if (isAutoStartEnabled.value) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        isAutoStartEnabled.value = false;
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        isAutoStartEnabled.value = true;
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveTheme(mode: ThemeMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("themeMode", mode);
      themeMode.value = mode;
      applyTheme(mode);
      await store.save();

      const payload: SettingsUpdatedPayload = { key: "theme", value: mode };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Theme saved: ${mode}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTheme failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-theme" });
      throw err;
    }
  }

  async function saveLocale(locale: SupportedLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedLocale", locale);
      selectedLocale.value = locale;
      i18n.global.locale.value = locale;
      document.documentElement.lang = getHtmlLangForLocale(locale);

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-locale" });
      throw err;
    }
  }

  async function saveTranscriptionLocale(locale: TranscriptionLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedTranscriptionLocale", locale);
      selectedTranscriptionLocale.value = locale;

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "transcriptionLocale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Transcription locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTranscriptionLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-transcription-locale",
      });
      throw err;
    }
  }

  function getWhisperLanguageCode(): string | null {
    return getWhisperCodeForTranscriptionLocale(
      selectedTranscriptionLocale.value,
    );
  }

  async function saveMuteOnRecording(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      isMuteOnRecordingEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-mute" });
      throw err;
    }
  }

  async function saveSoundEffectsEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundEffectsEnabled", enabled);
      await store.save();
      isSoundEffectsEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "soundEffectsEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  }

  // 僅 macOS 生效；失敗不影響已持久化的設定，重啟後由 Rust 端套用。
  // 走 Rust 的啟用策略指令而非前端 setDockVisibility：後者在叫出主視窗時圖示會回來（gh-82）
  async function applyDockVisibility(hidden: boolean) {
    if (!IS_MACOS) return;
    try {
      await invoke("set_dock_icon_hidden", { hidden });
    } catch (applyErr) {
      console.error(
        "[useSettingsStore] set_dock_icon_hidden failed:",
        extractErrorMessage(applyErr),
      );
    }
  }

  async function saveHideDockIcon(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hideDockIcon", enabled);
      await store.save();
      isHideDockIconEnabled.value = enabled;

      await applyDockVisibility(enabled);

      const payload: SettingsUpdatedPayload = {
        key: "hideDockIcon",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] hideDockIcon saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHideDockIcon failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hide-dock-icon" });
      throw err;
    }
  }

  async function saveStartHidden(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("startHidden", enabled);
      await store.save();
      isStartHiddenEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "startHidden",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveStartHidden failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-start-hidden" });
      throw err;
    }
  }

  async function saveInputContextEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("inputContextEnabled", enabled);
      await store.save();
      isInputContextEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "inputContextEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] inputContextEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveInputContextEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-input-context",
      });
      throw err;
    }
  }

  async function saveSmartDictionaryEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("smartDictionaryEnabled", enabled);
      await store.save();
      isSmartDictionaryEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "smartDictionaryEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] smartDictionaryEnabled saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSmartDictionaryEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-smart-dictionary",
      });
      throw err;
    }
  }

  async function saveRecordingAutoCleanup(enabled: boolean, days: number) {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("recordingAutoCleanupEnabled", enabled);
      await store.set("recordingAutoCleanupDays", validatedDays);
      await store.save();

      isRecordingAutoCleanupEnabled.value = enabled;
      recordingAutoCleanupDays.value = validatedDays;

      console.log(
        `[useSettingsStore] Recording auto cleanup saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveRecordingAutoCleanup failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-auto-cleanup",
      });
      throw err;
    }
  }

  async function saveDebugLog(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("debugLogEnabled", enabled);
      await store.save();

      isDebugLogEnabled.value = enabled;

      // 即時通知 Rust 切換檔案 Log 開關（關閉時 Rust 會順手清掉記錄檔）
      await setFileLoggingEnabled(enabled);

      console.log(`[useSettingsStore] Debug log saved: enabled=${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveDebugLog failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-debug-log",
      });
      throw err;
    }
  }

  /** 以系統檔案管理員開啟記錄資料夾（view 經 store 呼叫，不直接碰 lib）。 */
  async function openDebugLogFolder() {
    await openLogFolder();
  }

  async function saveAudioInputDevice(deviceName: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("audioInputDeviceName", deviceName);
      await store.save();

      selectedAudioInputDeviceName.value = deviceName;

      const payload: SettingsUpdatedPayload = {
        key: "audioInputDevice",
        value: deviceName,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Audio input device saved: "${deviceName || "(system default)"}"`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAudioInputDevice failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-audio-input-device",
      });
      throw err;
    }
  }

  async function saveCopyTranscriptionToClipboard(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("copyTranscriptionToClipboard", enabled);
      await store.save();
      isCopyTranscriptionToClipboardEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "copyTranscriptionToClipboard",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] copyTranscriptionToClipboard saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCopyTranscriptionToClipboard failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-copy-transcription-to-clipboard",
      });
      throw err;
    }
  }

  async function refreshCrossWindowSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedApiKey = await store.get<string>("groqApiKey");
      const savedSttProviderId = await store.get<unknown>("sttProviderId");
      const savedByteplusApiKey = await store.get<string>("byteplusApiKey");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedOpenaiKey = await store.get<string>("openaiApiKey");
      const savedAnthropicKey = await store.get<string>("anthropicApiKey");
      const savedGeminiKey = await store.get<string>("geminiApiKey");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedHideDockIcon = await store.get<boolean>("hideDockIcon");
      const savedStartHidden = await store.get<boolean>("startHidden");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      const savedInputContext = await store.get<boolean>("inputContextEnabled");

      hotkeyConfig.value = {
        triggerKey: savedKey ?? getDefaultTriggerKey(),
        triggerMode: savedMode ?? "hold",
      };
      const isValidCustomOrCombo =
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        isRecordedTriggerKey(savedCustomKey);
      customTriggerKey.value = isValidCustomOrCombo ? savedCustomKey : null;
      customTriggerKeyDomCode.value = isValidCustomOrCombo
        ? (savedCustomDomCode ?? "")
        : "";
      // Locale + transcription locale must be synced first
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      selectedLocale.value = savedLocale ?? FALLBACK_LOCALE;
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      const savedTranscriptionLocale = await store.get<unknown>(
        "selectedTranscriptionLocale",
      );
      const storedTranscriptionLocale = resolveStoredTranscriptionLocale(
        savedTranscriptionLocale,
      );
      selectedTranscriptionLocale.value =
        storedTranscriptionLocale.locale ?? selectedLocale.value;
      if (storedTranscriptionLocale.shouldPersist) {
        await store.set(
          "selectedTranscriptionLocale",
          storedTranscriptionLocale.locale,
        );
        await store.save();
      }

      // Theme: sync persisted value back to reactive + apply (cross-window)
      const savedThemeMode = await store.get<ThemeMode>("themeMode");
      themeMode.value = isThemeMode(savedThemeMode)
        ? savedThemeMode
        : DEFAULT_THEME_MODE;
      applyTheme(themeMode.value);

      apiKey.value = savedApiKey?.trim() ?? "";
      selectedSttProviderId.value = resolveSttProviderId(savedSttProviderId);
      if (
        typeof savedSttProviderId === "string" &&
        savedSttProviderId !== selectedSttProviderId.value
      ) {
        await store.set("sttProviderId", selectedSttProviderId.value);
        await store.save();
      }
      byteplusApiKey.value = savedByteplusApiKey?.trim() ?? "";
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      selectedLlmProviderId.value = resolveLlmProviderId(
        savedLlmProviderId,
        savedApiKey,
      );
      const effectiveCrossWindowModelId = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      const crossWindowModelConfig = findLlmModelConfig(effectiveCrossWindowModelId);
      selectedLlmModelId.value =
        crossWindowModelConfig?.providerId === selectedLlmProviderId.value
          ? effectiveCrossWindowModelId
          : getDefaultModelIdForProvider(selectedLlmProviderId.value);
      openaiApiKey.value = savedOpenaiKey?.trim() ?? "";
      anthropicApiKey.value = savedAnthropicKey?.trim() ?? "";
      geminiApiKey.value = savedGeminiKey?.trim() ?? "";
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;
      const nextHideDockIcon = savedHideDockIcon ?? DEFAULT_HIDE_DOCK_ICON;
      if (nextHideDockIcon !== isHideDockIconEnabled.value) {
        void applyDockVisibility(nextHideDockIcon);
      }
      isHideDockIconEnabled.value = nextHideDockIcon;
      isStartHiddenEnabled.value = savedStartHidden ?? DEFAULT_START_HIDDEN;
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;
      isInputContextEnabled.value =
        savedInputContext ?? DEFAULT_INPUT_CONTEXT_ENABLED;

      const savedRecCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;
      const savedRecCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedDebugLogEnabledX = await store.get<boolean>("debugLogEnabled");
      isDebugLogEnabled.value =
        savedDebugLogEnabledX ?? DEFAULT_DEBUG_LOG_ENABLED;

      const savedAudioDevice = await store.get<string>("audioInputDeviceName");
      selectedAudioInputDeviceName.value = savedAudioDevice ?? "";

      const savedCopyTranscriptionToClipboard = await store.get<boolean>(
        "copyTranscriptionToClipboard",
      );
      isCopyTranscriptionToClipboardEnabled.value =
        savedCopyTranscriptionToClipboard ??
        DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD;
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "refresh-cross-window" });
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.set("autoStartRegisteredVersion", __APP_VERSION__);
        await store.save();
        isAutoStartEnabled.value = true;
        console.log("[useSettingsStore] Auto-start enabled on first launch");
      } else {
        await loadAutoStartStatus();
        // 1.2.1 以前的執行檔叫 sayit；改名為 TypeK 後，舊的登入項目會指向不存在的檔案。
        // 每個版本第一次啟動時，自動啟動若是開的就重新登記一次，寫入目前執行檔路徑。
        const registeredVersion = await store.get<string>(
          "autoStartRegisteredVersion",
        );
        if (isAutoStartEnabled.value && registeredVersion !== __APP_VERSION__) {
          const { enable } = await import("@tauri-apps/plugin-autostart");
          await enable();
          await store.set("autoStartRegisteredVersion", __APP_VERSION__);
          await store.save();
          console.log("[useSettingsStore] Auto-start re-registered for this version");
        }
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    showPromptUpgradeNotice,
    isAutoStartEnabled,
    isEnhancementThresholdEnabled,
    enhancementThresholdCharCount,
    selectedLlmProviderId,
    selectedLlmModelId,
    selectedWhisperModelId,
    hasLlmApiKey,
    openaiApiKey: computed(() => openaiApiKey.value),
    anthropicApiKey: computed(() => anthropicApiKey.value),
    geminiApiKey: computed(() => geminiApiKey.value),
    selectedSttProviderId,
    byteplusApiKey: computed(() => byteplusApiKey.value),
    hasSttCredential,
    getSttApiKey,
    refreshSttApiKey,
    saveSttProvider,
    saveByteplusApiKey,
    deleteByteplusApiKey,
    getApiKey,
    getLlmApiKey,
    getAiPrompt,
    consumeUpgradeNotice,
    refreshApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveCustomTriggerKey,
    saveComboTriggerKey,
    switchToPresetMode,
    switchToCustomMode,
    getTriggerKeyDisplayName,
    customTriggerKey,
    customTriggerKeyDomCode,
    // Hotkey recording helpers (proxied from lib/ for views)
    getPlatformKeycode,
    getKeyDisplayName,
    isPresetEquivalentKey,
    getDangerousKeyWarning,
    getEscapeReservedMessage,
    getHotkeyRecordingTimeoutMessage,
    getHotkeyUnsupportedKeyMessage,
    getHotkeyPresetHint,
    saveApiKey,
    deleteApiKey,
    saveEnhancementThreshold,
    saveLlmModel,
    saveLlmProvider,
    saveOpenaiApiKey,
    deleteOpenaiApiKey,
    saveAnthropicApiKey,
    deleteAnthropicApiKey,
    saveGeminiApiKey,
    deleteGeminiApiKey,
    refreshLlmApiKey,
    saveWhisperModel,
    isMuteOnRecordingEnabled,
    saveMuteOnRecording,
    isSoundEffectsEnabled,
    saveSoundEffectsEnabled,
    isHideDockIconEnabled,
    saveHideDockIcon,
    isStartHiddenEnabled,
    saveStartHidden,
    isSmartDictionaryEnabled,
    saveSmartDictionaryEnabled,
    isInputContextEnabled,
    saveInputContextEnabled,
    isRecordingAutoCleanupEnabled,
    recordingAutoCleanupDays,
    saveRecordingAutoCleanup,
    isDebugLogEnabled,
    saveDebugLog,
    openDebugLogFolder,
    selectedAudioInputDeviceName,
    saveAudioInputDevice,
    isCopyTranscriptionToClipboardEnabled,
    saveCopyTranscriptionToClipboard,
    selectedLocale,
    saveLocale,
    selectedTranscriptionLocale,
    saveTranscriptionLocale,
    themeMode,
    saveTheme,
    getWhisperLanguageCode,
    refreshCrossWindowSettings,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
  };
});
