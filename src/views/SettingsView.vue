<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import {
  useSettingsStore,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
} from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import {
  buildGitHubIssueUrl,
  buildHotkeyDiagnosticsText,
  type HotkeyDiagnosticsInput,
  type HotkeyRecordingFailureKind,
} from "../composables/useHotkeyDiagnostics";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useHotkeyRecordingSession } from "../composables/useHotkeyRecordingSession";
import {
  type PresetTriggerKey,
  type ComboTriggerKey,
  type ChordTriggerKey,
  isComboTriggerKey,
  isChordTriggerKey,
  isRecordedTriggerKey,
} from "../types/settings";
import type {
  RecordingCapturedPayload,
  RecordingRejectedPayload,
} from "../types/events";
import type { TriggerMode } from "../types";
import {
  getDomCodeByKeycode,
  getKeyDisplayNameByKeycode,
} from "../lib/keycodeMap";
import {
  STT_PROVIDER_LIST,
  WHISPER_MODEL_LIST,
  estimateDailyEnhancementCount,
  findLlmModelConfig,
  findWhisperModelConfig,
  getModelListByProvider,
  type LlmModelId,
  type LlmProviderId,
  type SttProviderId,
  type WhisperModelId,
} from "../lib/modelRegistry";
import { LLM_PROVIDER_LIST, findProviderConfig } from "../lib/llmProvider";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "../i18n/languageConfig";

import { THEME_MODE_VALUES, type ThemeMode } from "../types/settings";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Bug,
  CircleAlert,
  FolderOpen,
  Github,
  Mic,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import type { AudioInputDeviceInfo } from "../types/audio";
import { useAudioPreview } from "../composables/useAudioPreview";
import ConnectionTestButton from "../components/ConnectionTestButton.vue";
import {
  testLlmConnection,
  testWhisperConnection,
} from "../lib/connectionTest";

const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const { t } = useI18n();

// ── 快捷鍵設定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const sttProviderList = computed(() =>
  STT_PROVIDER_LIST.filter((provider) => !provider.macOnly || isMac),
);

const triggerKeyOptions = computed<{ value: PresetTriggerKey; label: string }[]>(() =>
  isMac
    ? [
        { value: "fn", label: t("settings.hotkey.keys.fn") },
        { value: "option", label: t("settings.hotkey.keys.leftOption") },
        { value: "rightOption", label: t("settings.hotkey.keys.rightOption") },
        { value: "control", label: t("settings.hotkey.keys.leftControl") },
        { value: "rightControl", label: t("settings.hotkey.keys.rightControl") },
        { value: "command", label: t("settings.hotkey.keys.command") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
    : [
        { value: "rightAlt", label: t("settings.hotkey.keys.rightAlt") },
        { value: "leftAlt", label: t("settings.hotkey.keys.leftAlt") },
        { value: "control", label: t("settings.hotkey.keys.control") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
);

const hotkeyFeedback = useFeedbackMessage();

// ── 兩層模式切換 ──────────────────────────────────────────
const isCustomMode = ref(false);
const recordingWarning = ref("");
const recordingHint = ref("");

// ── 錄製失敗一鍵回報（gh-30）──
declare const __APP_VERSION__: string;
const recordingFailure = ref<{ kind: HotkeyRecordingFailureKind; reason?: string } | null>(null);
const reportFeedback = useFeedbackMessage();

async function buildDiagnosticsInput(): Promise<HotkeyDiagnosticsInput | null> {
  // await 期間使用者可能重新錄製（會清掉 recordingFailure）：先把本次失敗與設定存下來
  const failure = recordingFailure.value;
  if (!failure) return null;
  const key = settingsStore.hotkeyConfig?.triggerKey;
  const triggerKeyLabel = key
    ? settingsStore.getTriggerKeyDisplayName(key)
    : t("settings.hotkey.notSet");
  const triggerMode = settingsStore.triggerMode;
  const uiLocale = settingsStore.selectedLocale;
  const logLines = await invoke<string[]>("get_hotkey_recording_diagnostics");
  return {
    appVersion: __APP_VERSION__,
    userAgent: navigator.userAgent,
    uiLocale,
    triggerMode,
    triggerKeyLabel,
    failureKind: failure.kind,
    failureReason: failure.reason,
    logLines,
  };
}

async function handleReportToGitHub() {
  try {
    const input = await buildDiagnosticsInput();
    if (!input) return;
    const { url } = buildGitHubIssueUrl(input);
    await openExternalUrl(url);
  } catch (err) {
    reportFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleCopyDiagnostics() {
  try {
    const input = await buildDiagnosticsInput();
    if (!input) return;
    await invoke("copy_to_clipboard", { text: buildHotkeyDiagnosticsText(input) });
    reportFeedback.show("success", t("settings.hotkey.report.copied"));
  } catch (err) {
    reportFeedback.show("error", extractErrorMessage(err));
  }
}

const currentCustomKeyDisplay = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (key && (isComboTriggerKey(key) || isChordTriggerKey(key))) {
    return settingsStore.getTriggerKeyDisplayName(key);
  }
  if (!settingsStore.customTriggerKeyDomCode) return "";
  return settingsStore.getKeyDisplayName(settingsStore.customTriggerKeyDomCode);
});

const hasCustomKey = computed(() => settingsStore.customTriggerKey !== null);

const currentPresetKey = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (!key || isRecordedTriggerKey(key)) return isMac ? "fn" : "rightAlt";
  return key;
});

// 錄製流程（listener／DOM 第二來源／逾時／終態去重）在 session 裡；這裡只負責保存與提示
async function handleRecordingCaptured(payload: RecordingCapturedPayload) {
  const { keycode, modifiers, chordKeycodes } = payload;
  recordingWarning.value = "";
  recordingHint.value = "";

  const currentMode = settingsStore.triggerMode;

  const domCode = getDomCodeByKeycode(keycode);

  if (chordKeycodes.length >= 2) {
    // gh-30：純修飾鍵和弦（例：右 Alt＋右 Ctrl）
    const chordKey: ChordTriggerKey = { chord: { keycodes: chordKeycodes } };
    try {
      await settingsStore.saveComboTriggerKey(chordKey, domCode ?? "", currentMode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: settingsStore.getTriggerKeyDisplayName(chordKey) }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  } else if (modifiers.length > 0) {
    // Combo key: modifier(s) + primary key
    if (domCode) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    const comboKey: ComboTriggerKey = {
      combo: { modifiers, keycode },
    };
    try {
      await settingsStore.saveComboTriggerKey(comboKey, domCode ?? "", currentMode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: settingsStore.getTriggerKeyDisplayName(comboKey) }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  } else {
    // Single key
    const isPresetEquivalent = domCode ? settingsStore.isPresetEquivalentKey(domCode) : false;

    if (domCode && !isPresetEquivalent) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    if (isPresetEquivalent) {
      recordingHint.value = settingsStore.getHotkeyPresetHint();
    }

    try {
      await settingsStore.saveCustomTriggerKey(keycode, domCode ?? "", currentMode);
      const displayName = domCode
        ? settingsStore.getKeyDisplayName(domCode)
        : getKeyDisplayNameByKeycode(keycode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: displayName }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  }
}

function handleRecordingRejected(payload: RecordingRejectedPayload) {
  recordingFailure.value = { kind: "rejected", reason: payload.reason };
  if (payload.reason === "esc_reserved") {
    hotkeyFeedback.show("error", settingsStore.getEscapeReservedMessage());
  }
}

const recordingSession = useHotkeyRecordingSession({
  enableDomSource: !isMac, // gh-78：Windows 上視窗有焦點時 hook 收不到鍵
  onCaptured: (payload) => void handleRecordingCaptured(payload),
  onRejected: handleRecordingRejected,
  onTimeout: () => {
    hotkeyFeedback.show("error", settingsStore.getHotkeyRecordingTimeoutMessage());
    recordingFailure.value = { kind: "timeout" };
  },
  onStartFailed: (err) => {
    hotkeyFeedback.show("error", extractErrorMessage(err));
    recordingFailure.value = { kind: "start-failed" };
  },
});
const isRecording = recordingSession.isRecording;

function startRecording() {
  recordingWarning.value = "";
  recordingHint.value = "";
  recordingFailure.value = null;
  void recordingSession.start();
}

function stopKeyRecording() {
  recordingSession.stop();
}

function switchToCustom() {
  isCustomMode.value = true;
  if (hasCustomKey.value) {
    // Restore saved custom key as active
    settingsStore
      .switchToCustomMode(settingsStore.triggerMode)
      .catch((err: unknown) => {
        hotkeyFeedback.show("error", extractErrorMessage(err));
      });
  }
}

function switchToPreset() {
  isCustomMode.value = false;
  stopKeyRecording();
  recordingWarning.value = "";
  recordingHint.value = "";
  settingsStore
    .switchToPresetMode(currentPresetKey.value, settingsStore.triggerMode)
    .catch((err: unknown) => {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    });
}

async function handleTriggerKeyChange(newKey: PresetTriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    hotkeyFeedback.show("success", t("settings.hotkey.updated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyFeedback.show("success", t("settings.hotkey.modeUpdated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

// ── API Key ─────────────────────────────────────────────────
const apiKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const apiKeyFeedback = useFeedbackMessage();

const isConfirmingDeleteApiKey = ref(false);
let deleteConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet"),
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "border-0 bg-success/15 text-success"
    : "border-0 bg-destructive/15 text-destructive",
);
const shouldShowOnboardingHint = computed(
  () =>
    settingsStore.selectedSttProviderId === "groq" && !settingsStore.hasApiKey,
);

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveApiKey(apiKeyInput.value);
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

function requestDeleteApiKey() {
  if (!isConfirmingDeleteApiKey.value) {
    isConfirmingDeleteApiKey.value = true;
    deleteConfirmTimeoutId = setTimeout(() => {
      isConfirmingDeleteApiKey.value = false;
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimeoutId);
  isConfirmingDeleteApiKey.value = false;
  handleDeleteApiKey();
}

async function handleDeleteApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    apiKeyInput.value = "";
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

// ── 轉錄服務（STT provider）──────────────────────────────────
const sttProviderFeedback = useFeedbackMessage();

async function handleSttProviderChange(providerId: SttProviderId) {
  try {
    await settingsStore.saveSttProvider(providerId);
    sttProviderFeedback.show("success", t("common.save"));
    if (providerId === "apple") {
      await refreshAppleAuthStatus();
    }
  } catch (err) {
    sttProviderFeedback.show("error", extractErrorMessage(err));
  }
}

const byteplusApiKeyInput = ref("");
const isByteplusApiKeyVisible = ref(false);
const isSubmittingByteplusApiKey = ref(false);
const byteplusKeyFeedback = useFeedbackMessage();

const byteplusApiKeyStatusLabel = computed(() =>
  settingsStore.byteplusApiKey
    ? t("settings.apiKey.set")
    : t("settings.apiKey.notSet"),
);
const byteplusApiKeyStatusClass = computed(() =>
  settingsStore.byteplusApiKey
    ? "border-0 bg-success/15 text-success"
    : "border-0 bg-destructive/15 text-destructive",
);

async function handleSaveByteplusApiKey() {
  try {
    isSubmittingByteplusApiKey.value = true;
    await settingsStore.saveByteplusApiKey(byteplusApiKeyInput.value);
    byteplusApiKeyInput.value = "";
    isByteplusApiKeyVisible.value = false;
    byteplusKeyFeedback.show(
      "success",
      t("settings.stt.byteplusApiKey.saved"),
    );
  } catch (err) {
    byteplusKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingByteplusApiKey.value = false;
  }
}

async function handleDeleteByteplusApiKey() {
  try {
    isSubmittingByteplusApiKey.value = true;
    await settingsStore.deleteByteplusApiKey();
    byteplusApiKeyInput.value = "";
    isByteplusApiKeyVisible.value = false;
    byteplusKeyFeedback.show(
      "success",
      t("settings.stt.byteplusApiKey.deleted"),
    );
  } catch (err) {
    byteplusKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingByteplusApiKey.value = false;
  }
}

// ── macOS 內建語音辨識授權 ───────────────────────────────────
const appleAuthStatus = ref<number | null>(null);
const appleAuthFeedback = useFeedbackMessage();

const appleAuthStatusLabel = computed(() => {
  switch (appleAuthStatus.value) {
    case 0:
      return t("settings.stt.appleAuth.notDetermined");
    case 1:
      return t("settings.stt.appleAuth.denied");
    case 2:
      return t("settings.stt.appleAuth.restricted");
    case 3:
      return t("settings.stt.appleAuth.authorized");
    default:
      return t("settings.stt.appleAuth.needsAuthorization");
  }
});

const appleAuthStatusClass = computed(() =>
  appleAuthStatus.value === 3
    ? "border-0 bg-success/15 text-success"
    : "border-0 bg-destructive/15 text-destructive",
);

async function refreshAppleAuthStatus() {
  if (!isMac) return;
  try {
    appleAuthStatus.value = await invoke<number>("apple_speech_auth_status");
  } catch (err) {
    appleAuthStatus.value = null;
    console.error(
      "[SettingsView] apple_speech_auth_status failed:",
      extractErrorMessage(err),
    );
  }
}

async function handleRequestAppleAuth() {
  try {
    appleAuthStatus.value = await invoke<number>("apple_speech_request_auth");
    appleAuthFeedback.show(
      "success",
      t("settings.stt.appleAuth.authRequested"),
    );
  } catch (err) {
    appleAuthFeedback.show(
      "error",
      t("settings.stt.appleAuth.statusUnavailable"),
    );
  }
}

async function handleOpenSpeechSettings() {
  try {
    await openExternalUrl(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
    );
  } catch (err) {
    appleAuthFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleWhisperTest() {
  if (settingsStore.selectedSttProviderId === "apple") {
    await refreshAppleAuthStatus();
  }
  return testWhisperConnection(
    settingsStore.selectedSttProviderId,
    settingsStore.getSttApiKey(),
    settingsStore.selectedWhisperModelId,
    settingsStore.selectedTranscriptionLocale,
    settingsStore.selectedLocale,
  );
}

// ── AI 整理門檻 ──────────────────────────────────────────────
const thresholdEnabled = ref(DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED);
const thresholdCharCount = ref(DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT);
const enhancementThresholdFeedback = useFeedbackMessage();

async function handleToggleEnhancementThreshold() {
  thresholdEnabled.value = !thresholdEnabled.value;
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    enhancementThresholdFeedback.show(
      "success",
      thresholdEnabled.value ? t("settings.threshold.enabledFeedback") : t("settings.threshold.disabledFeedback"),
    );
  } catch (err) {
    thresholdEnabled.value = !thresholdEnabled.value;
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveThresholdCharCount() {
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
    enhancementThresholdFeedback.show("success", t("settings.threshold.charCountSaved"));
  } catch (err) {
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 模型選擇（語音轉錄卡與文字整理卡各自回饋，避免回饋跑錯卡）──
const whisperModelFeedback = useFeedbackMessage();
const llmModelFeedback = useFeedbackMessage();

const whisperModelDescription = computed(() => {
  const config = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
  if (!config) return "";
  return t("settings.model.costPerHour", { cost: config.costPerHour });
});

const llmModelDescription = computed(() => {
  const config = findLlmModelConfig(settingsStore.selectedLlmModelId);
  if (!config) return "";
  const tpsInfo = config.speedTps > 0 ? `${config.speedTps} TPS · ` : "";
  const base = `${tpsInfo}$${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
  // gh-71：免費專案選到沒額度的模型會直接 429，事前把付費狀態講清楚
  if (config.freeTier === "none") return `${base} · ${t("settings.model.paidOnlyHint")}`;
  if (config.freeTier === "limited") return `${base} · ${t("settings.model.limitedFreeHint")}`;
  const dailyCount = estimateDailyEnhancementCount(config);
  if (config.providerId === "groq" && dailyCount > 0) {
    return `${base} · ${t("settings.model.dailyQuotaHint", { count: dailyCount })}`;
  }
  return base;
});

const providerModelList = computed(() =>
  getModelListByProvider(settingsStore.selectedLlmProviderId),
);

async function handleWhisperModelChange(newId: WhisperModelId) {
  try {
    await settingsStore.saveWhisperModel(newId);
    whisperModelFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    whisperModelFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLlmModelChange(newId: LlmModelId) {
  try {
    await settingsStore.saveLlmModel(newId);
    llmModelFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    llmModelFeedback.show("error", extractErrorMessage(err));
  }
}

// ── LLM Provider ────────────────────────────────────────────
const providerFeedback = useFeedbackMessage();
const openaiApiKeyInput = ref("");
const anthropicApiKeyInput = ref("");
const geminiApiKeyInput = ref("");
const isOpenaiApiKeyVisible = ref(false);
const isAnthropicApiKeyVisible = ref(false);
const isGeminiApiKeyVisible = ref(false);

async function handleProviderChange(providerId: LlmProviderId) {
  try {
    await settingsStore.saveLlmProvider(providerId);
    providerFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveOpenaiApiKey() {
  try {
    await settingsStore.saveOpenaiApiKey(openaiApiKeyInput.value);
    openaiApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteOpenaiApiKey() {
  try {
    await settingsStore.deleteOpenaiApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveAnthropicApiKey() {
  try {
    await settingsStore.saveAnthropicApiKey(anthropicApiKeyInput.value);
    anthropicApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAnthropicApiKey() {
  try {
    await settingsStore.deleteAnthropicApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveGeminiApiKey() {
  try {
    await settingsStore.saveGeminiApiKey(geminiApiKeyInput.value);
    geminiApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteGeminiApiKey() {
  try {
    await settingsStore.deleteGeminiApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音自動靜音 ──────────────────────────────────────────────
const muteOnRecordingFeedback = useFeedbackMessage();

async function handleToggleMuteOnRecording(newValue: boolean) {
  try {
    await settingsStore.saveMuteOnRecording(newValue);
    muteOnRecordingFeedback.show(
      "success",
      newValue ? t("settings.app.muteEnabled") : t("settings.app.muteDisabled"),
    );
  } catch (err) {
    muteOnRecordingFeedback.show("error", extractErrorMessage(err));
  }
}

const soundFeedbackFeedback = useFeedbackMessage();

async function handleToggleSoundFeedback(newValue: boolean) {
  try {
    await settingsStore.saveSoundEffectsEnabled(newValue);
    soundFeedbackFeedback.show(
      "success",
      newValue
        ? t("settings.app.soundFeedbackEnabled")
        : t("settings.app.soundFeedbackDisabled"),
    );
  } catch (err) {
    soundFeedbackFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 隱藏 Dock 圖示 (gh-56，僅 macOS) ──────────────────────────
const hideDockIconFeedback = useFeedbackMessage();
// 切換後短暫鎖住開關，避免快速連按造成 UI 與實際 Dock 狀態脫節
// （原為 Tao 一秒守衛而設；gh-82 起改走啟用策略，鎖定保留作防連按）
const isHideDockIconPending = ref(false);
let hideDockIconPendingTimeoutId: ReturnType<typeof setTimeout> | undefined;

async function handleToggleHideDockIcon(newValue: boolean) {
  isHideDockIconPending.value = true;
  try {
    await settingsStore.saveHideDockIcon(newValue);
    hideDockIconFeedback.show(
      "success",
      newValue
        ? t("settings.app.hideDockIconEnabled")
        : t("settings.app.hideDockIconDisabled"),
    );
  } catch (err) {
    hideDockIconFeedback.show("error", extractErrorMessage(err));
  } finally {
    hideDockIconPendingTimeoutId = setTimeout(() => {
      isHideDockIconPending.value = false;
    }, 1200);
  }
}

// ── 啟動時隱藏主視窗 (gh-76) ──────────────────────────
const startHiddenFeedback = useFeedbackMessage();

async function handleToggleStartHidden(newValue: boolean) {
  try {
    await settingsStore.saveStartHidden(newValue);
    startHiddenFeedback.show(
      "success",
      newValue
        ? t("settings.app.startHiddenEnabled")
        : t("settings.app.startHiddenDisabled"),
    );
  } catch (err) {
    startHiddenFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 轉錄文字是否複製到剪貼簿 (gh-35) ──────────────────────────
const copyTranscriptionToClipboardFeedback = useFeedbackMessage();

async function handleToggleCopyTranscriptionToClipboard(newValue: boolean) {
  try {
    await settingsStore.saveCopyTranscriptionToClipboard(newValue);
    copyTranscriptionToClipboardFeedback.show(
      "success",
      newValue
        ? t("settings.app.copyTranscriptionToClipboard.enabled")
        : t("settings.app.copyTranscriptionToClipboard.disabled"),
    );
  } catch (err) {
    copyTranscriptionToClipboardFeedback.show(
      "error",
      extractErrorMessage(err),
    );
  }
}

// ── 介面語言 ──────────────────────────────────────────────
const localeFeedback = useFeedbackMessage();

// ── 佈景主題 ──────────────────────────────────────────────
const themeFeedback = useFeedbackMessage();

async function handleThemeChange(mode: ThemeMode) {
  try {
    await settingsStore.saveTheme(mode);
    themeFeedback.show("success", t("settings.app.themeUpdated"));
  } catch (err) {
    themeFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLocaleChange(newLocale: SupportedLocale) {
  try {
    await settingsStore.saveLocale(newLocale);
    localeFeedback.show("success", t("settings.app.languageUpdated"));
  } catch (err) {
    localeFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 轉錄語言 ──────────────────────────────────────────────
const transcriptionLocaleFeedback = useFeedbackMessage();

async function handleTranscriptionLocaleChange(newLocale: TranscriptionLocale) {
  try {
    await settingsStore.saveTranscriptionLocale(newLocale);
    transcriptionLocaleFeedback.show("success", t("settings.app.transcriptionLanguageUpdated"));
  } catch (err) {
    transcriptionLocaleFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 智慧字典學習 ────────────────────────────────────────────
const smartDictionaryFeedback = useFeedbackMessage();

async function handleToggleSmartDictionary(newValue: boolean) {
  try {
    await settingsStore.saveSmartDictionaryEnabled(newValue);
    smartDictionaryFeedback.show("success", t("common.save"));
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 上下文感知 ──────────────────────────────────────────────
const inputContextFeedback = useFeedbackMessage();

async function handleToggleInputContext(newValue: boolean) {
  try {
    await settingsStore.saveInputContextEnabled(newValue);
    inputContextFeedback.show("success", t("common.save"));
  } catch (err) {
    inputContextFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音儲存管理 ──────────────────────────────────────────
const recordingCleanupFeedback = useFeedbackMessage();
const recordingAutoCleanupEnabled = ref(false);
const recordingAutoCleanupDays = ref(7);
const isDeletingRecordings = ref(false);

async function handleToggleRecordingAutoCleanup() {
  recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingCleanupFeedback.show(
      "success",
      recordingAutoCleanupEnabled.value
        ? t("settings.recording.autoCleanupEnabled")
        : t("settings.recording.autoCleanupDisabled"),
    );
  } catch (err) {
    recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveCleanupDays() {
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
    recordingCleanupFeedback.show("success", t("settings.recording.daysSaved"));
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAllRecordings() {
  try {
    isDeletingRecordings.value = true;
    const deletedCount = await historyStore.deleteAllRecordingFiles();

    recordingCleanupFeedback.show(
      "success",
      t("settings.recording.deleteSuccess", { count: deletedCount }),
    );
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  } finally {
    isDeletingRecordings.value = false;
  }
}

// ── 進階：除錯記錄（Debug Log）────────────────────────────────
const debugLogFeedback = useFeedbackMessage();
const debugLogEnabled = ref(false);

async function handleToggleDebugLog() {
  debugLogEnabled.value = !debugLogEnabled.value;
  try {
    await settingsStore.saveDebugLog(debugLogEnabled.value);
    debugLogFeedback.show(
      "success",
      debugLogEnabled.value
        ? t("settings.debugLog.enabledMessage")
        : t("settings.debugLog.disabledMessage"),
    );
  } catch (err) {
    // 以 store 為準：關閉時「已停寫、但清檔失敗」也算已關閉，不能把開關假裝彈回開啟
    debugLogEnabled.value = settingsStore.isDebugLogEnabled;
    debugLogFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleOpenLogFolder() {
  try {
    await settingsStore.openDebugLogFolder();
  } catch (err) {
    debugLogFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 應用程式 ────────────────────────────────────────────────
const autoStartFeedback = useFeedbackMessage();
const isTogglingAutoStart = ref(false);

async function handleToggleAutoStart() {
  try {
    isTogglingAutoStart.value = true;
    await settingsStore.toggleAutoStart();
    autoStartFeedback.show(
      "success",
      settingsStore.isAutoStartEnabled ? t("settings.app.autoStartEnabled") : t("settings.app.autoStartDisabled"),
    );
  } catch (err) {
    autoStartFeedback.show("error", extractErrorMessage(err));
  } finally {
    isTogglingAutoStart.value = false;
  }
}

// ── 輸入裝置 ──────────────────────────────────────────────
const audioInputDeviceList = ref<AudioInputDeviceInfo[]>([]);
const defaultInputDeviceName = ref<string | null>(null);
const isRefreshingDeviceList = ref(false);
const audioInputFeedback = useFeedbackMessage();
const { previewLevel, isPreviewActive, startPreview, stopPreview } =
  useAudioPreview();
const MIC_TEST_DURATION_SECONDS = 10;
const previewRemainingSeconds = ref(MIC_TEST_DURATION_SECONDS);
const isPreviewFailed = ref(false);
let previewAutoStopTimeoutId: ReturnType<typeof setTimeout> | undefined;
let previewCountdownIntervalId: ReturnType<typeof setInterval> | undefined;

function clearMicTestTimers() {
  clearTimeout(previewAutoStopTimeoutId);
  clearInterval(previewCountdownIntervalId);
}

async function startMicTest() {
  clearMicTestTimers();
  isPreviewFailed.value = false;
  previewRemainingSeconds.value = MIC_TEST_DURATION_SECONDS;

  const isStarted = await startPreview(
    settingsStore.selectedAudioInputDeviceName,
  );
  if (!isStarted) {
    isPreviewFailed.value = true;
    return;
  }

  previewCountdownIntervalId = setInterval(() => {
    if (previewRemainingSeconds.value > 1) {
      previewRemainingSeconds.value -= 1;
    }
  }, 1000);
  previewAutoStopTimeoutId = setTimeout(() => {
    stopMicTest();
  }, MIC_TEST_DURATION_SECONDS * 1000);
}

function stopMicTest() {
  clearMicTestTimers();
  void stopPreview();
}

async function handleToggleMicTest() {
  if (isPreviewActive.value) {
    stopMicTest();
    return;
  }
  await startMicTest();
}

async function restartMicTestIfActive() {
  if (isPreviewActive.value) await startMicTest();
}

async function openMicrophoneSettings() {
  try {
    await openExternalUrl(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  } catch (err) {
    console.error(
      "[SettingsView] Failed to open microphone settings:",
      extractErrorMessage(err),
    );
  }
}

async function loadAudioInputDeviceList() {
  try {
    audioInputDeviceList.value =
      await invoke<AudioInputDeviceInfo[]>("list_audio_input_devices");
    defaultInputDeviceName.value =
      await invoke<string | null>("get_default_input_device_name");
  } catch (err) {
    console.error(
      "[SettingsView] Failed to list audio input devices:",
      extractErrorMessage(err),
    );
  }
}

async function handleRefreshAudioInputDeviceList() {
  isRefreshingDeviceList.value = true;
  try {
    await loadAudioInputDeviceList();
    audioInputFeedback.show(
      "success",
      t("settings.audioInput.refreshed", {
        count: audioInputDeviceList.value.length,
      }),
    );
    await restartMicTestIfActive();
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  } finally {
    isRefreshingDeviceList.value = false;
  }
}

async function handleAudioInputDeviceChange(deviceName: string) {
  try {
    await settingsStore.saveAudioInputDevice(deviceName);
    audioInputFeedback.show("success", t("settings.audioInput.updated"));
    await restartMicTestIfActive();
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  }
}

onMounted(async () => {
  // 麥克風只在按下「測試麥克風」時才開啟，避免一進設定頁就佔用裝置
  void loadAudioInputDeviceList();

  if (settingsStore.hasApiKey) {
    apiKeyInput.value = settingsStore.getApiKey();
  }
  if (settingsStore.selectedSttProviderId === "apple") {
    await refreshAppleAuthStatus();
  }
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  recordingAutoCleanupEnabled.value =
    settingsStore.isRecordingAutoCleanupEnabled;
  recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
  debugLogEnabled.value = settingsStore.isDebugLogEnabled;
  await settingsStore.loadAutoStartStatus();

  // Detect if current key is custom or combo
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  if (currentKey && isRecordedTriggerKey(currentKey)) {
    isCustomMode.value = true;
  }
});

onBeforeUnmount(() => {
  clearMicTestTimers();
  void stopPreview();
  stopKeyRecording();
  hotkeyFeedback.clearTimer();
  reportFeedback.clearTimer();
  apiKeyFeedback.clearTimer();
  enhancementThresholdFeedback.clearTimer();
  whisperModelFeedback.clearTimer();
  llmModelFeedback.clearTimer();
  muteOnRecordingFeedback.clearTimer();
  soundFeedbackFeedback.clearTimer();
  hideDockIconFeedback.clearTimer();
  startHiddenFeedback.clearTimer();
  copyTranscriptionToClipboardFeedback.clearTimer();
  debugLogFeedback.clearTimer();
  localeFeedback.clearTimer();
  themeFeedback.clearTimer();
  transcriptionLocaleFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  smartDictionaryFeedback.clearTimer();
  inputContextFeedback.clearTimer();
  sttProviderFeedback.clearTimer();
  byteplusKeyFeedback.clearTimer();
  appleAuthFeedback.clearTimer();
  recordingCleanupFeedback.clearTimer();
  providerFeedback.clearTimer();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(hideDockIconPendingTimeoutId);
});
</script>

<template>
  <div class="p-6 space-y-6 text-foreground">
    <!-- 介面語言：放最上面，讓使用者第一眼就能選 -->
    <Card>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <Label for="locale-select">{{ $t("settings.app.language") }}</Label>
          <Select
            :model-value="settingsStore.selectedLocale"
            @update:model-value="handleLocaleChange($event as SupportedLocale)"
          >
            <SelectTrigger id="locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="localeFeedback.message.value !== ''"
            class="text-sm"
            :class="
              localeFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ localeFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 關於 TypeK -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.about.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-1">
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.about.description") }}
          </p>
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.about.author") }}<a href="https://github.com/kekukeku" target="_blank" rel="noopener noreferrer" class="font-medium text-foreground hover:text-primary transition-colors">Kevin Kuo</a>
          </p>
        </div>

        <Separator />

        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <a href="https://github.com/kekukeku/TypeK" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Github class="size-4" />
            <span>{{ $t("settings.about.sourceCode") }}</span>
          </a>
          <a href="https://github.com/kekukeku/TypeK/issues" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <CircleAlert class="size-4" />
            <span>{{ $t("settings.about.reportIssue") }}</span>
          </a>
        </div>
      </CardContent>
    </Card>

    <!-- 快捷鍵設定 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.hotkey.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 簡易 / 自訂 模式切換 -->
        <div class="flex items-center justify-between">
          <Label>{{ $t("settings.hotkey.triggerKeyMode") }}</Label>
          <div class="flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1">
            <Button
              size="sm"
              :variant="!isCustomMode ? 'default' : 'ghost'"
              class="rounded-full px-4"
              @click="switchToPreset"
            >
              {{ $t("settings.hotkey.preset") }}
            </Button>
            <Button
              size="sm"
              :variant="isCustomMode ? 'default' : 'ghost'"
              class="rounded-full px-4"
              @click="switchToCustom"
            >
              {{ $t("settings.hotkey.custom") }}
            </Button>
          </div>
        </div>

        <!-- 簡易模式：Select 下拉 -->
        <div v-if="!isCustomMode" class="flex items-center justify-between">
          <Label for="trigger-key">{{ $t("settings.hotkey.triggerKey") }}</Label>
          <Select
            :model-value="currentPresetKey"
            @update:model-value="handleTriggerKeyChange($event as PresetTriggerKey)"
          >
            <SelectTrigger id="trigger-key" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in triggerKeyOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 自訂模式：錄製按鍵 -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <Label>{{ $t("settings.hotkey.customTriggerKey") }}</Label>
            <div class="flex items-center gap-3">
              <span v-if="hasCustomKey" class="badge-jelly px-3.5 py-1.5 font-mono text-xs font-bold tracking-wider">
                {{ currentCustomKeyDisplay }}
              </span>
              <span v-else class="text-sm text-muted-foreground">{{ $t("settings.hotkey.notSet") }}</span>
              <Button
                :variant="isRecording ? 'destructive' : 'outline'"
                size="sm"
                class="rounded-full"
                :class="{ 'animate-pulse': isRecording }"
                @click="isRecording ? stopKeyRecording() : startRecording()"
              >
                {{ isRecording ? $t('settings.hotkey.pressKey') : $t('settings.hotkey.record') }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.hotkey.systemKeyHint") }}
          </p>
          <!-- gh-30：錄製從空集合起算，錄製前就按住的鍵不算 -->
          <p v-if="isRecording" class="text-xs text-muted-foreground">
            {{ $t("settings.hotkey.releaseAllHint") }}
          </p>

          <!-- 警告訊息（黃色） -->
          <p v-if="recordingWarning" class="text-sm text-destructive">
            {{ recordingWarning }}
          </p>

          <!-- 提示訊息（藍色） -->
          <p v-if="recordingHint" class="text-sm text-muted-foreground">
            {{ recordingHint }}
          </p>

          <!-- gh-30：錄製失敗一鍵回報 -->
          <div v-if="recordingFailure" class="space-y-2 rounded-md border border-border p-3">
            <p class="text-sm text-foreground">{{ $t("settings.hotkey.report.prompt") }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" @click="handleReportToGitHub">
                {{ $t("settings.hotkey.report.github") }}
              </Button>
              <Button variant="outline" size="sm" @click="handleCopyDiagnostics">
                {{ $t("settings.hotkey.report.copy") }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ $t("settings.hotkey.report.note") }}</p>
            <Transition name="fade">
              <p
                v-if="reportFeedback.message.value !== ''"
                class="text-sm"
                :class="reportFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
              >
                {{ reportFeedback.message.value }}
              </p>
            </Transition>
          </div>
        </div>

        <!-- 觸發模式 -->
        <div class="flex items-center justify-between">
          <Label for="trigger-mode">{{ $t("settings.hotkey.triggerMode") }}</Label>
          <div class="flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1">
            <Button
              size="sm"
              :variant="settingsStore.triggerMode === 'hold' ? 'default' : 'ghost'"
              class="rounded-full px-4"
              @click="handleTriggerModeChange('hold')"
            >
              Hold
            </Button>
            <Button
              size="sm"
              :variant="settingsStore.triggerMode === 'toggle' ? 'default' : 'ghost'"
              class="rounded-full px-4"
              @click="handleTriggerModeChange('toggle')"
            >
              Toggle
            </Button>
          </div>
        </div>

        <p class="text-sm text-muted-foreground leading-relaxed">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.holdDescription")
              : $t("settings.hotkey.toggleDescription")
          }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="hotkeyFeedback.message.value !== ''"
            class="text-sm"
            :class="
              hotkeyFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ hotkeyFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 語音轉錄：金鑰 → 模型｜語言 → 測試連線（設計 A，金鑰跟著功能走） -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.stt.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5">
        <!-- 轉錄服務選擇（沿用文字整理卡 provider RadioGroup 樣式） -->
        <div class="space-y-3">
          <Label>{{ $t("settings.stt.providerTitle") }}</Label>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.stt.providerDescription") }}
          </p>
          <RadioGroup
            :model-value="settingsStore.selectedSttProviderId"
            :class="isMac ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3'"
            @update:model-value="(v: unknown) => handleSttProviderChange(v as SttProviderId)"
          >
            <Label
              v-for="provider in sttProviderList"
              :key="provider.id"
              :for="`stt-provider-${provider.id}`"
              class="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius)] p-3 transition-all"
              :class="settingsStore.selectedSttProviderId === provider.id
                ? 'border-2 border-primary bg-gradient-to-br from-card to-accent font-bold text-primary shadow-jelly'
                : 'border border-border bg-card hover:border-primary/50 hover:scale-[1.02]'"
            >
              <RadioGroupItem :id="`stt-provider-${provider.id}`" :value="provider.id" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">{{ $t(`settings.stt.provider.${provider.id}`) }}</span>
                <span class="text-xs font-normal text-muted-foreground">{{ $t(`settings.stt.providerHint.${provider.id}`) }}</span>
              </span>
            </Label>
          </RadioGroup>
        </div>

        <Separator />

        <!-- Groq API Key -->
        <div v-if="settingsStore.selectedSttProviderId === 'groq'" class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Label for="groq-api-key">{{ $t("settings.apiKey.title") }}</Label>
              <Badge
                :class="apiKeyStatusClass"
                class="border-0"
              >
                {{ apiKeyStatusLabel }}
              </Badge>
            </div>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              class="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {{ $t("settings.apiKey.goToConsole") }} &rarr;
            </a>
          </div>

          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ $t("settings.apiKey.instruction") }}
          </p>

          <p
            v-if="shouldShowOnboardingHint"
            class="rounded-[var(--radius)] border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground"
          >
            {{ $t("settings.apiKey.onboarding") }}
          </p>

          <div class="flex gap-2">
            <div class="flex flex-1 gap-2">
              <Input
                id="groq-api-key"
                v-model="apiKeyInput"
                :type="isApiKeyVisible ? 'text' : 'password'"
                placeholder="gsk_..."
                autocomplete="off"
                class="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                @click="toggleApiKeyVisibility"
              >
                {{ isApiKeyVisible ? $t("settings.apiKey.hide") : $t("settings.apiKey.show") }}
              </Button>
            </div>
            <Button
              :disabled="isSubmittingApiKey"
              @click="handleSaveApiKey"
            >
              {{ $t("common.save") }}
            </Button>
          </div>

          <div class="flex items-center justify-between">
            <transition name="feedback-fade">
              <p
                v-if="apiKeyFeedback.message.value !== ''"
                class="text-sm"
                :class="
                  apiKeyFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'
                "
              >
                {{ apiKeyFeedback.message.value }}
              </p>
            </transition>

            <Button
              v-if="settingsStore.hasApiKey"
              variant="outline"
              :class="
                isConfirmingDeleteApiKey
                  ? 'bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90'
                  : 'text-destructive border-destructive hover:bg-destructive/10'
              "
              :disabled="isSubmittingApiKey"
              @click="requestDeleteApiKey"
            >
              {{ isConfirmingDeleteApiKey ? $t('settings.apiKey.confirmDelete') : $t('settings.apiKey.delete') }}
            </Button>
          </div>
        </div>

        <!-- BytePlus Seed Speech API Key -->
        <div v-else-if="settingsStore.selectedSttProviderId === 'byteplus'" class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Label for="byteplus-api-key">{{ $t("settings.stt.byteplusApiKey.title") }}</Label>
              <Badge :class="byteplusApiKeyStatusClass" class="border-0">
                {{ byteplusApiKeyStatusLabel }}
              </Badge>
            </div>
            <a
              href="https://console.byteplus.com/voice/new/setting/apikeys"
              target="_blank"
              rel="noreferrer"
              class="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {{ $t("settings.stt.byteplusApiKey.goToConsole") }} &rarr;
            </a>
          </div>

          <p class="text-sm text-muted-foreground leading-relaxed">
            {{ $t("settings.stt.byteplusApiKey.instruction") }}
          </p>

          <div v-if="settingsStore.byteplusApiKey" class="flex items-center gap-2">
            <Input
              id="byteplus-api-key"
              :model-value="
                isByteplusApiKeyVisible
                  ? settingsStore.byteplusApiKey
                  : '••••••••••'
              "
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              @click="isByteplusApiKeyVisible = !isByteplusApiKeyVisible"
            >
              {{ isByteplusApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive"
              :disabled="isSubmittingByteplusApiKey"
              @click="handleDeleteByteplusApiKey"
            >
              {{ $t('settings.stt.byteplusApiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="byteplus-api-key"
              v-model="byteplusApiKeyInput"
              type="password"
              placeholder="..."
              autocomplete="off"
              class="flex-1 font-mono text-xs"
            />
            <Button
              size="sm"
              :disabled="isSubmittingByteplusApiKey || !byteplusApiKeyInput.trim()"
              @click="handleSaveByteplusApiKey"
            >
              {{ $t('common.save') }}
            </Button>
          </div>

          <transition name="feedback-fade">
            <p
              v-if="byteplusKeyFeedback.message.value !== ''"
              class="text-sm"
              :class="
                byteplusKeyFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'
              "
            >
              {{ byteplusKeyFeedback.message.value }}
            </p>
          </transition>

          <p class="text-xs text-muted-foreground">
            {{ $t("settings.stt.byteplusApiKey.privacyNote") }}
          </p>
        </div>

        <!-- macOS 內建語音辨識 -->
        <div v-else class="space-y-4">
          <div class="flex items-center gap-2">
            <Label>{{ $t("settings.stt.appleAuth.label") }}</Label>
            <Badge :class="appleAuthStatusClass" class="border-0">
              {{ appleAuthStatusLabel }}
            </Badge>
          </div>

          <template v-if="appleAuthStatus === 3">
            <p class="text-sm text-muted-foreground">
              {{ $t("settings.stt.appleAuth.authorizedHint") }}
            </p>
          </template>
          <template v-else-if="appleAuthStatus === 1 || appleAuthStatus === 2">
            <p class="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
              {{
                appleAuthStatus === 1
                  ? $t("settings.stt.appleAuth.deniedWarning")
                  : $t("settings.stt.appleAuth.restrictedWarning")
              }}
            </p>
            <Button variant="outline" size="sm" @click="handleOpenSpeechSettings">
              {{ $t("settings.stt.appleAuth.openSettings") }}
            </Button>
          </template>
          <template v-else>
            <Button size="sm" @click="handleRequestAppleAuth">
              {{ $t("settings.stt.appleAuth.request") }}
            </Button>
          </template>

          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ $t("settings.stt.appleAuth.description") }}
          </p>

          <transition name="feedback-fade">
            <p
              v-if="appleAuthFeedback.message.value !== ''"
              class="text-sm"
              :class="
                appleAuthFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'
              "
            >
              {{ appleAuthFeedback.message.value }}
            </p>
          </transition>
        </div>

        <Separator />

        <!-- 模型｜語言 並排 -->
        <div class="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <div class="space-y-2">
            <template v-if="settingsStore.selectedSttProviderId === 'groq'">
              <Label for="whisper-model">{{ $t("settings.model.whisperLabel") }}</Label>
              <Select
                :model-value="settingsStore.selectedWhisperModelId"
                @update:model-value="handleWhisperModelChange($event as WhisperModelId)"
              >
                <SelectTrigger id="whisper-model" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="model in WHISPER_MODEL_LIST"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.displayName }}
                    <template v-if="model.isDefault" #extra>
                      <Badge variant="secondary" class="ml-2 text-xs">{{ $t("settings.model.default") }}</Badge>
                    </template>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">{{ whisperModelDescription }}</p>
            </template>
            <template v-else>
              <span class="text-sm font-medium">{{ $t("settings.model.whisperLabel") }}</span>
              <div class="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {{
                  settingsStore.selectedSttProviderId === "byteplus"
                    ? $t("settings.stt.byteplusModel")
                    : $t("settings.stt.appleModel")
                }}
              </div>
            </template>
          </div>

          <div class="space-y-2">
            <Label for="transcription-locale-select">{{ $t("settings.app.transcriptionLanguage") }}</Label>
            <Select
              :model-value="settingsStore.selectedTranscriptionLocale"
              @update:model-value="handleTranscriptionLocaleChange($event as TranscriptionLocale)"
            >
              <SelectTrigger id="transcription-locale-select" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in TRANSCRIPTION_LANGUAGE_OPTIONS"
                  :key="opt.locale"
                  :value="opt.locale"
                >
                  {{ opt.locale === 'auto' ? $t('settings.app.autoDetect') : opt.displayName }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">{{ $t("settings.app.transcriptionLanguageDescription") }}</p>
          </div>
        </div>

        <ConnectionTestButton
          :on-test="handleWhisperTest"
          :disabled="!settingsStore.hasSttCredential"
        />

        <transition name="feedback-fade">
          <p
            v-if="sttProviderFeedback.message.value !== ''"
            class="text-sm"
            :class="sttProviderFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ sttProviderFeedback.message.value }}
          </p>
        </transition>

        <transition name="feedback-fade">
          <p
            v-if="whisperModelFeedback.message.value !== ''"
            class="text-sm"
            :class="whisperModelFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ whisperModelFeedback.message.value }}
          </p>
        </transition>

        <transition name="feedback-fade">
          <p
            v-if="transcriptionLocaleFeedback.message.value !== ''"
            class="text-sm"
            :class="
              transcriptionLocaleFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ transcriptionLocaleFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 文字整理：服務 → 金鑰 → 測試連線 → 模型 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.llm.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5">
        <!-- LLM Provider 選擇 -->
        <div class="space-y-3">
          <Label>{{ $t("settings.provider.title") }}</Label>
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.description") }}</p>
          <RadioGroup
            :model-value="settingsStore.selectedLlmProviderId"
            class="grid grid-cols-2 gap-3 sm:grid-cols-4"
            @update:model-value="(v: unknown) => handleProviderChange(v as LlmProviderId)"
          >
            <Label
              v-for="provider in LLM_PROVIDER_LIST"
              :key="provider.id"
              :for="`provider-${provider.id}`"
              class="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius)] p-3 transition-all"
              :class="settingsStore.selectedLlmProviderId === provider.id
                ? 'border-2 border-primary bg-gradient-to-br from-card to-accent font-bold text-primary shadow-jelly'
                : 'border border-border bg-card hover:border-primary/50 hover:scale-[1.02]'"
            >
              <RadioGroupItem :id="`provider-${provider.id}`" :value="provider.id" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">{{ $t(`settings.provider.${provider.id}`) }}</span>
            </Label>
          </RadioGroup>
        </div>

        <!-- Provider-specific API Key -->
        <div v-if="settingsStore.selectedLlmProviderId === 'groq'" class="space-y-3">
          <div
            v-if="settingsStore.selectedSttProviderId === 'groq'"
            class="rounded-[var(--radius)] bg-secondary/50 p-3"
          >
            <p class="text-xs text-muted-foreground">
              {{ settingsStore.hasApiKey ? $t("settings.provider.groqNote") : $t("settings.provider.groqNoteNotSet") }}
            </p>
          </div>

          <!-- 轉錄用別的服務時，文字整理需要自己的 Groq 金鑰欄 -->
          <template v-else>
            <div class="flex items-center gap-2">
              <Label for="llm-groq-api-key">{{ $t("settings.apiKey.title") }}</Label>
              <Badge :class="apiKeyStatusClass" class="border-0">
                {{ apiKeyStatusLabel }}
              </Badge>
            </div>
            <div class="flex gap-2">
              <div class="flex flex-1 gap-2">
                <Input
                  id="llm-groq-api-key"
                  v-model="apiKeyInput"
                  :type="isApiKeyVisible ? 'text' : 'password'"
                  placeholder="gsk_..."
                  autocomplete="off"
                  class="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  class="shrink-0"
                  @click="toggleApiKeyVisibility"
                >
                  {{ isApiKeyVisible ? $t("settings.apiKey.hide") : $t("settings.apiKey.show") }}
                </Button>
              </div>
              <Button :disabled="isSubmittingApiKey" @click="handleSaveApiKey">
                {{ $t("common.save") }}
              </Button>
            </div>
            <div class="flex items-center justify-between">
              <transition name="feedback-fade">
                <p
                  v-if="apiKeyFeedback.message.value !== ''"
                  class="text-sm"
                  :class="
                    apiKeyFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'
                  "
                >
                  {{ apiKeyFeedback.message.value }}
                </p>
              </transition>
              <Button
                v-if="settingsStore.hasApiKey"
                variant="outline"
                :class="
                  isConfirmingDeleteApiKey
                    ? 'bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90'
                    : 'text-destructive border-destructive hover:bg-destructive/10'
                "
                :disabled="isSubmittingApiKey"
                @click="requestDeleteApiKey"
              >
                {{ isConfirmingDeleteApiKey ? $t('settings.apiKey.confirmDelete') : $t('settings.apiKey.delete') }}
              </Button>
            </div>
          </template>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'openai'" class="space-y-2">
          <Label for="openai-api-key">{{ $t("settings.providerApiKey.openaiTitle") }}</Label>
          <div v-if="settingsStore.openaiApiKey" class="flex items-center gap-2">
            <Input
              id="openai-api-key"
              :model-value="isOpenaiApiKeyVisible ? settingsStore.openaiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isOpenaiApiKeyVisible = !isOpenaiApiKeyVisible">
              {{ isOpenaiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteOpenaiApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="openai-api-key"
              v-model="openaiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('openai')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!openaiApiKeyInput.trim()" @click="handleSaveOpenaiApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.openaiInstruction") }}
            ·
            <a :href="findProviderConfig('openai')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToOpenai") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'anthropic'" class="space-y-2">
          <Label for="anthropic-api-key">{{ $t("settings.providerApiKey.anthropicTitle") }}</Label>
          <div v-if="settingsStore.anthropicApiKey" class="flex items-center gap-2">
            <Input
              id="anthropic-api-key"
              :model-value="isAnthropicApiKeyVisible ? settingsStore.anthropicApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isAnthropicApiKeyVisible = !isAnthropicApiKeyVisible">
              {{ isAnthropicApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteAnthropicApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="anthropic-api-key"
              v-model="anthropicApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('anthropic')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!anthropicApiKeyInput.trim()" @click="handleSaveAnthropicApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.anthropicInstruction") }}
            ·
            <a :href="findProviderConfig('anthropic')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToAnthropic") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'gemini'" class="space-y-2">
          <Label for="gemini-api-key">{{ $t("settings.providerApiKey.geminiTitle") }}</Label>
          <div v-if="settingsStore.geminiApiKey" class="flex items-center gap-2">
            <Input
              id="gemini-api-key"
              :model-value="isGeminiApiKeyVisible ? settingsStore.geminiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isGeminiApiKeyVisible = !isGeminiApiKeyVisible">
              {{ isGeminiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteGeminiApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="gemini-api-key"
              v-model="geminiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('gemini')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!geminiApiKeyInput.trim()" @click="handleSaveGeminiApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.geminiInstruction") }}
            ·
            <a :href="findProviderConfig('gemini')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToGemini") }}</a>
          </p>
        </div>

        <ConnectionTestButton
          :on-test="() => testLlmConnection(settingsStore.selectedLlmModelId, settingsStore.getLlmApiKey())"
          :disabled="!settingsStore.hasLlmApiKey"
        />

        <transition name="feedback-fade">
          <p
            v-if="providerFeedback.message.value !== ''"
            class="text-sm"
            :class="providerFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ providerFeedback.message.value }}
          </p>
        </transition>

        <template v-if="settingsStore.selectedLlmProviderId === 'groq' || settingsStore.hasLlmApiKey">
          <Separator />

          <!-- LLM 模型 -->
          <div class="space-y-2">
            <Label for="llm-model">{{ $t("settings.model.llmLabel") }}</Label>
            <Select
              :model-value="settingsStore.selectedLlmModelId"
              @update:model-value="handleLlmModelChange($event as LlmModelId)"
            >
              <SelectTrigger id="llm-model" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in providerModelList"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.displayName }}
                  <template #extra>
                    <Badge variant="secondary" class="ml-2 text-xs">{{ $t(model.badgeKey) }}</Badge>
                    <Badge
                      v-if="model.providerId === 'groq' && estimateDailyEnhancementCount(model) > 0"
                      variant="outline"
                      class="ml-1 text-xs"
                    >
                      {{ $t("settings.model.dailyQuotaBadge", { count: estimateDailyEnhancementCount(model) }) }}
                    </Badge>
                    <Badge v-if="model.freeTier !== 'full'" variant="outline" class="ml-1 text-xs">
                      {{ model.freeTier === 'none' ? $t("settings.modelBadge.paidOnly") : $t("settings.modelBadge.limitedFree") }}
                    </Badge>
                  </template>
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">{{ llmModelDescription }}</p>
          </div>
        </template>

        <transition name="feedback-fade">
          <p
            v-if="llmModelFeedback.message.value !== ''"
            class="text-sm"
            :class="llmModelFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ llmModelFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 短文字門檻 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.threshold.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.threshold.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="threshold-toggle">{{ thresholdEnabled ? $t('settings.threshold.enabled') : $t('settings.threshold.disabled') }}</Label>
          <Switch
            id="threshold-toggle"
            :model-value="thresholdEnabled"
            @update:model-value="handleToggleEnhancementThreshold"
          />
        </div>

        <div v-if="thresholdEnabled" class="flex items-center gap-3">
          <Label for="threshold-char-count">{{ $t("settings.threshold.charCount") }}</Label>
          <Input
            id="threshold-char-count"
            v-model.number="thresholdCharCount"
            type="number"
            min="1"
            class="w-24"
          />
          <Button
            size="sm"
            @click="handleSaveThresholdCharCount"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="enhancementThresholdFeedback.message.value !== ''"
            class="text-sm"
            :class="
              enhancementThresholdFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ enhancementThresholdFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 智慧字典學習（macOS: AXUIElement；Windows: UI Automation） -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.smartDictionary.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.smartDictionary.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="smart-dictionary-toggle">{{ $t("settings.smartDictionary.title") }}</Label>
          <Switch
            id="smart-dictionary-toggle"
            :model-value="settingsStore.isSmartDictionaryEnabled"
            @update:model-value="handleToggleSmartDictionary"
          />
        </div>

        <p class="rounded-[var(--radius)] border border-border bg-secondary/50 p-3.5 text-xs leading-relaxed text-foreground">
          {{ $t("settings.smartDictionary.privacyNote") }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="smartDictionaryFeedback.message.value !== ''"
            class="text-sm"
            :class="
              smartDictionaryFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ smartDictionaryFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 上下文感知（macOS: AXUIElement；Windows 尚未支援，不顯示免得開了沒效果） -->
    <Card v-if="isMac">
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.inputContext.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.inputContext.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="input-context-toggle">{{ $t("settings.inputContext.title") }}</Label>
          <Switch
            id="input-context-toggle"
            :model-value="settingsStore.isInputContextEnabled"
            @update:model-value="handleToggleInputContext"
          />
        </div>

        <p class="rounded-[var(--radius)] border border-border bg-secondary/50 p-3.5 text-xs leading-relaxed text-foreground">
          {{ $t("settings.inputContext.privacyNote") }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="inputContextFeedback.message.value !== ''"
            class="text-sm"
            :class="
              inputContextFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ inputContextFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 輸入裝置 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.audioInput.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.audioInput.description") }}
        </p>
        <div class="space-y-2">
          <Label for="audio-input-device">{{ $t("settings.audioInput.deviceLabel") }}</Label>
          <div class="flex items-center gap-2">
            <Select
              :model-value="settingsStore.selectedAudioInputDeviceName || '_default'"
              @update:model-value="handleAudioInputDeviceChange($event === '_default' ? '' : ($event as string))"
            >
              <SelectTrigger id="audio-input-device" class="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {{
                    defaultInputDeviceName
                      ? $t("settings.audioInput.systemDefaultWithDevice", {
                        device: defaultInputDeviceName,
                      })
                      : $t("settings.audioInput.systemDefault")
                  }}
                </SelectItem>
                <SelectItem
                  v-for="device in audioInputDeviceList"
                  :key="device.name"
                  :value="device.name"
                >
                  {{ device.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              :disabled="isRefreshingDeviceList"
              @click="handleRefreshAudioInputDeviceList"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshingDeviceList }" />
            </Button>
          </div>
        </div>
        <div>
          <Button variant="outline" size="sm" @click="handleToggleMicTest">
            <Mic class="h-4 w-4" />
            {{
              isPreviewActive
                ? $t("settings.audioInput.stopTest", {
                  seconds: previewRemainingSeconds,
                })
                : $t("settings.audioInput.testMic")
            }}
          </Button>
        </div>
        <div
          v-if="isPreviewActive"
          role="meter"
          :aria-valuenow="Math.round(previewLevel * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="$t('settings.audioInput.volumePreview')"
          class="flex items-center gap-2 h-5"
        >
          <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div class="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-primary to-chart-4 transition-[width] duration-75"
              :style="{ width: `${Math.round(previewLevel * 100)}%` }"
            />
          </div>
        </div>
        <transition name="feedback-fade">
          <div v-if="isPreviewFailed" class="space-y-2">
            <p class="flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlert class="mt-0.5 h-4 w-4 flex-shrink-0" />
              {{ $t("settings.audioInput.testFailed") }}
            </p>
            <Button
              v-if="isMac"
              variant="outline"
              size="sm"
              @click="openMicrophoneSettings"
            >
              {{ $t("settings.audioInput.openSystemSettings") }}
            </Button>
          </div>
        </transition>
        <transition name="feedback-fade">
          <p
            v-if="audioInputFeedback.message.value !== ''"
            class="text-sm"
            :class="audioInputFeedback.type.value === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ audioInputFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 錄音儲存管理 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.recording.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.recording.description") }}
        </p>

        <div class="flex items-center justify-between">
          <div>
            <Label for="recording-auto-cleanup">{{ $t("settings.recording.autoCleanup") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.recording.autoCleanupDescription") }}</p>
          </div>
          <Switch
            id="recording-auto-cleanup"
            :model-value="recordingAutoCleanupEnabled"
            @update:model-value="handleToggleRecordingAutoCleanup"
          />
        </div>

        <div v-if="recordingAutoCleanupEnabled" class="flex items-center gap-3">
          <Label for="cleanup-days">{{ $t("settings.recording.retentionDays") }}</Label>
          <Input
            id="cleanup-days"
            v-model.number="recordingAutoCleanupDays"
            type="number"
            min="1"
            class="w-24"
          />
          <span class="text-sm text-muted-foreground">{{ $t("settings.recording.daysUnit") }}</span>
          <Button
            size="sm"
            @click="handleSaveCleanupDays"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <div class="border-t border-border" />

        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button
              variant="destructive"
              :disabled="isDeletingRecordings"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              {{ $t("settings.recording.deleteAll") }}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ $t("settings.recording.deleteConfirmTitle") }}</AlertDialogTitle>
              <AlertDialogDescription>
                {{ $t("settings.recording.deleteConfirmDescription") }}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ $t("common.cancel") }}</AlertDialogCancel>
              <AlertDialogAction @click="handleDeleteAllRecordings">
                {{ $t("common.delete") }}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <transition name="feedback-fade">
          <p
            v-if="recordingCleanupFeedback.message.value !== ''"
            class="text-sm"
            :class="
              recordingCleanupFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ recordingCleanupFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 應用程式 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.app.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 佈景主題 -->
        <div class="flex items-center justify-between">
          <Label for="theme-select">{{ $t("settings.app.theme") }}</Label>
          <Select
            :model-value="settingsStore.themeMode"
            @update:model-value="handleThemeChange($event as ThemeMode)"
          >
            <SelectTrigger id="theme-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="mode in THEME_MODE_VALUES"
                :key="mode"
                :value="mode"
              >
                {{ $t(`settings.app.theme_${mode}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="themeFeedback.message.value !== ''"
            class="text-sm"
            :class="
              themeFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ themeFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="mute-on-recording">{{ $t("settings.app.muteOnRecording") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.muteDescription") }}</p>
          </div>
          <Switch
            id="mute-on-recording"
            :model-value="settingsStore.isMuteOnRecordingEnabled"
            @update:model-value="handleToggleMuteOnRecording"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="muteOnRecordingFeedback.message.value !== ''"
            class="text-sm"
            :class="
              muteOnRecordingFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ muteOnRecordingFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div class="pr-4">
            <Label for="copy-transcription-to-clipboard">{{
              $t("settings.app.copyTranscriptionToClipboard.label")
            }}</Label>
            <p class="text-sm text-muted-foreground">
              {{
                settingsStore.isCopyTranscriptionToClipboardEnabled
                  ? $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOn",
                  )
                  : $t(
                    "settings.app.copyTranscriptionToClipboard.descriptionOff",
                  )
              }}
            </p>
          </div>
          <Switch
            id="copy-transcription-to-clipboard"
            :model-value="settingsStore.isCopyTranscriptionToClipboardEnabled"
            @update:model-value="handleToggleCopyTranscriptionToClipboard"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="copyTranscriptionToClipboardFeedback.message.value !== ''"
            class="text-sm"
            :class="
              copyTranscriptionToClipboardFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ copyTranscriptionToClipboardFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="sound-feedback">{{ $t("settings.app.soundFeedback") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.soundFeedbackDescription") }}</p>
          </div>
          <Switch
            id="sound-feedback"
            :model-value="settingsStore.isSoundEffectsEnabled"
            @update:model-value="handleToggleSoundFeedback"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="soundFeedbackFeedback.message.value !== ''"
            class="text-sm"
            :class="
              soundFeedbackFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ soundFeedbackFeedback.message.value }}
          </p>
        </transition>

        <template v-if="isMac">
          <div class="border-t border-border" />

          <div class="flex items-center justify-between">
            <div>
              <Label for="hide-dock-icon">{{ $t("settings.app.hideDockIcon") }}</Label>
              <p class="text-sm text-muted-foreground">{{ $t("settings.app.hideDockIconDescription") }}</p>
            </div>
            <Switch
              id="hide-dock-icon"
              :model-value="settingsStore.isHideDockIconEnabled"
              :disabled="isHideDockIconPending"
              @update:model-value="handleToggleHideDockIcon"
            />
          </div>

          <transition name="feedback-fade">
            <p
              v-if="hideDockIconFeedback.message.value !== ''"
              class="text-sm"
              :class="
                hideDockIconFeedback.type.value === 'success'
                  ? 'text-success'
                  : 'text-destructive'
              "
            >
              {{ hideDockIconFeedback.message.value }}
            </p>
          </transition>
        </template>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="auto-start">{{ $t("settings.app.autoStart") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.autoStartDescription") }}</p>
          </div>
          <Switch
            id="auto-start"
            :model-value="settingsStore.isAutoStartEnabled"
            :disabled="isTogglingAutoStart"
            @update:model-value="handleToggleAutoStart"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="autoStartFeedback.message.value !== ''"
            class="text-sm"
            :class="
              autoStartFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ autoStartFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="start-hidden">{{ $t("settings.app.startHidden") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.startHiddenDescription") }}</p>
          </div>
          <Switch
            id="start-hidden"
            :model-value="settingsStore.isStartHiddenEnabled"
            @update:model-value="handleToggleStartHidden"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="startHiddenFeedback.message.value !== ''"
            class="text-sm"
            :class="
              startHiddenFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ startHiddenFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 進階：除錯記錄（Debug Log）-->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base flex items-center gap-2">
          <Bug class="h-4 w-4" />
          {{ $t("settings.debugLog.title") }}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.debugLog.description") }}
        </p>

        <div class="flex items-center justify-between">
          <div>
            <Label for="debug-log-enabled">{{ $t("settings.debugLog.enable") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.debugLog.enableDescription") }}</p>
          </div>
          <Switch
            id="debug-log-enabled"
            :model-value="debugLogEnabled"
            @update:model-value="handleToggleDebugLog"
          />
        </div>

        <div class="border-t border-border" />

        <Button variant="outline" @click="handleOpenLogFolder">
          <FolderOpen class="h-4 w-4 mr-2" />
          {{ $t("settings.debugLog.openFolder") }}
        </Button>

        <transition name="feedback-fade">
          <p
            v-if="debugLogFeedback.message.value !== ''"
            class="text-sm"
            :class="
              debugLogFeedback.type.value === 'success'
                ? 'text-success'
                : 'text-destructive'
            "
          >
            {{ debugLogFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
