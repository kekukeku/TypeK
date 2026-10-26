import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { logInfoLine, logErrorLine } from "../lib/logger";
import { enhanceText } from "../lib/enhancer";
import { buildWhisperPrompt } from "../lib/whisperPrompt";
import { getProviderIdForModel } from "../lib/llmProvider";
import { analyzeCorrections } from "../lib/vocabularyAnalyzer";
import { applyTranscriptTextTransforms as applySharedTranscriptTextTransforms } from "../lib/transcriptTextTransforms";
import i18n from "../i18n";
import { useVocabularyStore } from "./useVocabularyStore";
import { useHistoryStore } from "./useHistoryStore";
import type {
  TranscriptionRecord,
  ChatUsageData,
  ApiUsageRecord,
  InputContextDto,
} from "../types/transcription";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../lib/apiPricing";
import type { StopRecordingResult, TranscriptionResult } from "../types/audio";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_MODE_TOGGLE,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
  CORRECTION_MONITOR_RESULT,
  VOCABULARY_LEARNED,
  ESCAPE_PRESSED,
  emitEvent,
  listenToEvent,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
  type CorrectionMonitorResultPayload,
  type VocabularyLearnedPayload,
} from "../types/events";
import {
  detectHallucination,
  detectEnhancementAnomaly,
  detectSemanticDrift,
} from "../lib/hallucinationDetector";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const MAX_ENHANCEMENT_RETRY_COUNT = 3;
const ERROR_WITH_RETRY_DISPLAY_DURATION_MS = 6000;
const START_SOUND_DURATION_MS = 400;
const CANCELLED_DISPLAY_DURATION_MS = 1000;

/**
 * 判斷轉錄結果是否為空（無內容可貼上）。
 *
 * 設計決策：只攔截「完全沒有文字」的情況。
 * Whisper 幻聽（如「谢谢大家」、重複片語）不攔截，直接貼上讓使用者自行判斷。
 * 理由：攔截 + 顯示「未偵測到語音」會讓使用者以為麥克風或系統有問題；
 * 直接貼上則讓使用者看到是模型的輸出品質問題，可自行 Cmd+Z 重來。
 */
function isEmptyTranscription(rawText: string): boolean {
  return !rawText || !rawText.trim();
}
function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

/**
 * 轉錄原文落地前的文字轉換。
 * 解析有效轉譯語言（auto 回退到介面語言）後，委派給共用的 applyTranscriptTextTransforms。
 * 目前只做：繁中（zh-TW）時把 Whisper 的簡體輸出轉成繁體（#39）。
 */
function applyTranscriptTextTransforms(rawText: string): string {
  if (!rawText) return rawText;
  return applySharedTranscriptTextTransforms(
    rawText,
    getEffectiveTranscriptLocale(),
  );
}

/** 有效轉譯語言：auto 回退到介面語言。原文轉換與整理結果轉換（#83）共用。 */
function getEffectiveTranscriptLocale(): string {
  const settingsStore = useSettingsStore();
  const transcriptionLocale = settingsStore.selectedTranscriptionLocale;
  return transcriptionLocale === "auto"
    ? settingsStore.selectedLocale
    : transcriptionLocale;
}

const MONITOR_POLL_INTERVAL_MS = 250;

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  const isRecording = ref<boolean>(false);
  const recordingElapsedSeconds = ref<number>(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
  const COLLAPSE_HIDE_DELAY_MS = 400;
  const lastWasModified = ref<boolean | null>(null);
  let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
  let delayedMuteTimer: ReturnType<typeof setTimeout> | null = null;
  let learnedHideTimer: ReturnType<typeof setTimeout> | null = null;
  const LEARNED_NOTIFICATION_TOTAL_DURATION_MS = 2800; // 2000 display + 400 collapse + 400 buffer
  const lastFailedTranscriptionId = ref<string | null>(null);
  const lastFailedAudioFilePath = ref<string | null>(null);
  const lastFailedRecordingDurationMs = ref<number>(0);
  const lastFailedPeakEnergyLevel = ref<number>(0);
  const lastFailedRmsEnergyLevel = ref<number>(0);
  const isAborted = ref<boolean>(false);
  let abortController: AbortController | null = null;
  // 錄音世代編號：非同步回呼可能在「下一輪錄音已開始」後才落地——
  // 寫入前必須比對世代，過期回呼直接失效（含 ESC 取消 / 雙擊靜默取消後立刻重錄）
  let recordingEpoch = 0;
  // 輸入上下文（App、視窗、游標前後文字）：錄音開始時趁焦點還在目標 App 讀，
  // AI 整理前取用；每輪錄音開始或取消時清掉，不會跨錄音沿用
  let inputContextProbe: Promise<InputContextDto | null> | null = null;
  // 錄音期間通常早已讀完；這裡只是 AX 卡住時的上限，逾時就不帶上下文
  const INPUT_CONTEXT_WAIT_MS = 300;
  const isRetryAttempt = ref<boolean>(false);
  const canRetry = computed<boolean>(
    () =>
      status.value === "error" &&
      lastFailedAudioFilePath.value !== null &&
      !isRetryAttempt.value,
  );

  // Double-tap mode toggle state
  let recordingStartTimestamp = 0;
  let doubleTapResolve: ((isDoubleTap: boolean) => void) | null = null;
  let doubleTapDelayTimer: ReturnType<typeof setTimeout> | null = null;

  let lastMonitorKey = "";
  let isRepositioning = false;

  function getAppWindow() {
    if (!cachedAppWindow) cachedAppWindow = getCurrentWindow();
    return cachedAppWindow;
  }

  function writeInfoLog(logMessage: string) {
    logInfoLine(logMessage);
  }

  function writeErrorLog(logMessage: string) {
    logErrorLine(logMessage);
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function clearCollapseHideTimer() {
    if (collapseHideTimer) {
      clearTimeout(collapseHideTimer);
      collapseHideTimer = null;
    }
  }

  function startElapsedTimer() {
    recordingElapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => {
      recordingElapsedSeconds.value += 1;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    recordingElapsedSeconds.value = 0;
  }

  function emitVoiceFlowStateChanged(
    nextStatus: HudStatus,
    nextMessage = "",
  ): void {
    const payload: VoiceFlowStateChangedPayload = {
      status: nextStatus,
      message: nextMessage,
    };
    void emitEvent(VOICE_FLOW_STATE_CHANGED, payload);
  }

  async function repositionHudToCurrentMonitor() {
    if (isRepositioning) return;
    isRepositioning = true;
    try {
      const position = await invoke<HudTargetPosition>(
        "get_hud_target_position",
      );
      if (position.monitorKey !== lastMonitorKey) {
        lastMonitorKey = position.monitorKey;
        await getAppWindow().setPosition(
          new LogicalPosition(position.x, position.y),
        );
      }
    } catch {
      // 螢幕監控重定位失敗為低優先級，不 log 避免洗版
    } finally {
      isRepositioning = false;
    }
  }

  function startMonitorPolling() {
    stopMonitorPolling();
    monitorPollTimer = setInterval(() => {
      void repositionHudToCurrentMonitor();
    }, MONITOR_POLL_INTERVAL_MS);
  }

  function stopMonitorPolling() {
    if (monitorPollTimer) {
      clearInterval(monitorPollTimer);
      monitorPollTimer = null;
    }
    lastMonitorKey = "";
    isRepositioning = false;
  }

  async function showHud() {
    clearLearnedHideTimer();
    const window = getAppWindow();
    lastMonitorKey = "";
    await repositionHudToCurrentMonitor();
    await window.show();
    await window.setIgnoreCursorEvents(true);
    startMonitorPolling();
  }

  async function hideHud() {
    await getAppWindow().hide();
  }

  function clearDelayedMuteTimer() {
    if (delayedMuteTimer) {
      clearTimeout(delayedMuteTimer);
      delayedMuteTimer = null;
    }
  }

  function clearLearnedHideTimer() {
    if (learnedHideTimer) {
      clearTimeout(learnedHideTimer);
      learnedHideTimer = null;
    }
  }

  async function muteSystemAudioIfEnabled() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isMuteOnRecordingEnabled) return;
    try {
      await invoke("mute_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "mute-audio" });
    }
  }

  async function restoreSystemAudio() {
    try {
      await invoke("restore_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "restore-audio" });
    }
  }

  function startQualityMonitorAfterPaste() {
    void invoke("start_quality_monitor").catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });
  }

  async function saveTranscriptionRecord(
    record: TranscriptionRecord,
  ): Promise<void> {
    const historyStore = useHistoryStore();
    try {
      await historyStore.addTranscription(record);
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "save-transcription" });
    }
  }

  function buildTranscriptionRecord(params: {
    id: string;
    rawText: string;
    processedText: string | null;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
    audioFilePath: string | null;
    status: "success" | "failed";
  }): TranscriptionRecord {
    const settingsStore = useSettingsStore();
    return {
      id: params.id,
      timestamp: Date.now(),
      rawText: params.rawText,
      processedText: params.processedText,
      recordingDurationMs: Math.round(params.recordingDurationMs),
      transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
      enhancementDurationMs:
        params.enhancementDurationMs !== null
          ? Math.round(params.enhancementDurationMs)
          : null,
      charCount: params.rawText.length,
      triggerMode: settingsStore.triggerMode,
      wasEnhanced: params.wasEnhanced,
      wasModified: null,
      createdAt: "",
      audioFilePath: params.audioFilePath,
      status: params.status,
      // 編輯模式已移除：新紀錄一律一般聽寫；舊資料的欄位保留給歷史頁守衛
      isEditMode: false,
      editSourceText: null,
    };
  }

  function transitionTo(nextStatus: HudStatus, nextMessage = "") {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    status.value = nextStatus;
    message.value = nextMessage;
    emitVoiceFlowStateChanged(nextStatus, nextMessage);

    if (nextStatus === "idle") {
      stopMonitorPolling();
      collapseHideTimer = setTimeout(() => {
        hideHud().catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, { source: "voice-flow", step: "hideHud" });
        });
      }, COLLAPSE_HIDE_DELAY_MS);
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "cancelled") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, CANCELLED_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud()
        .then(async () => {
          await getAppWindow().setIgnoreCursorEvents(false);
        })
        .catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, {
            source: "voice-flow",
            step: "showHud-enableCursor",
          });
        });
      const errorDuration = canRetry.value
        ? ERROR_WITH_RETRY_DISPLAY_DURATION_MS
        : ERROR_DISPLAY_DURATION_MS;
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, errorDuration);
    }
  }

  function failRecordingFlow(
    errorMessage: string,
    logMessage: string,
    error?: unknown,
  ) {
    clearDelayedMuteTimer();
    restoreSystemAudio();
    isRecording.value = false;
    transitionTo("error", errorMessage);
    playSoundIfEnabled("play_error_sound");
    writeErrorLog(logMessage);
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
    }
  }

  function playSoundIfEnabled(command: string) {
    if (useSettingsStore().isSoundEffectsEnabled) {
      void invoke(command).catch(() => {});
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function updateVocabularyWeightsAfterPaste(finalText: string) {
    void (async () => {
      try {
        const vocabularyStore = useVocabularyStore();
        const matchedIdList: string[] = [];

        for (const entry of vocabularyStore.termList) {
          const isEnglish = /^[a-zA-Z]/.test(entry.term);
          if (isEnglish) {
            const regex = new RegExp(
              "\\b" + escapeRegex(entry.term) + "\\b",
              "i",
            );
            if (regex.test(finalText)) {
              matchedIdList.push(entry.id);
            }
          } else {
            if (finalText.includes(entry.term)) {
              matchedIdList.push(entry.id);
            }
          }
        }

        if (matchedIdList.length > 0) {
          await vocabularyStore.batchIncrementWeights(matchedIdList);
          writeInfoLog(
            `useVoiceFlowStore: vocabulary weights updated for ${matchedIdList.length} terms`,
          );
        }
      } catch (err) {
        writeErrorLog(
          `useVoiceFlowStore: vocabulary weight update failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "vocabulary-weight-update",
        });
      }
    })();
  }

  const SNAPSHOT_POLL_INTERVAL_MS = 500;
  let correctionSnapshotTimer: ReturnType<typeof setInterval> | null = null;
  let correctionMonitorUnlisten: UnlistenFn | null = null;

  function stopCorrectionSnapshotPolling() {
    if (correctionSnapshotTimer) {
      clearInterval(correctionSnapshotTimer);
      correctionSnapshotTimer = null;
    }
  }

  function cleanupCorrectionMonitorListener() {
    if (correctionMonitorUnlisten) {
      correctionMonitorUnlisten();
      correctionMonitorUnlisten = null;
    }
  }

  function startCorrectionDetectionFlow(
    pastedText: string,
    transcriptionId: string,
    apiKey: string,
  ) {
    void (async () => {
      try {
        const settingsStore = useSettingsStore();
        if (!settingsStore.isSmartDictionaryEnabled) return;

        // 清除前一次的 listener，避免重複累積
        cleanupCorrectionMonitorListener();

        // 啟動修正監控
        await invoke("start_correction_monitor");

        // Phase 2 snapshot polling
        let latestSnapshot: string | null = null;
        stopCorrectionSnapshotPolling();

        correctionSnapshotTimer = setInterval(() => {
          void (async () => {
            try {
              const text = await invoke<string | null>(
                "read_focused_text_field",
              );
              if (text) {
                latestSnapshot = text;
              }
            } catch {
              // AX 讀取失敗靜默處理
            }
          })();
        }, SNAPSHOT_POLL_INTERVAL_MS);

        // 一次性監聽 correction-monitor:result
        correctionMonitorUnlisten =
          await listenToEvent<CorrectionMonitorResultPayload>(
            CORRECTION_MONITOR_RESULT,
            (event) => {
              cleanupCorrectionMonitorListener();
              stopCorrectionSnapshotPolling();

              void (async () => {
                try {
                  const result = event.payload;

                  if (!result.anyKeyPressed) {
                    writeInfoLog(
                      "[correction] no key pressed — skipping analysis",
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] keys detected (enter=${result.enterPressed}) — reading field text`,
                  );

                  let fieldText: string | null = null;

                  if (result.enterPressed) {
                    // Enter 觸發：先嘗試即時讀取（IME 確認後文字可能已更新）
                    // 讀不到（如 LINE 按 Enter 送出後已清空）才 fallback 到 snapshot
                    try {
                      const freshText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                      if (freshText && freshText.trim()) {
                        fieldText = freshText;
                      } else {
                        fieldText = latestSnapshot;
                      }
                    } catch {
                      fieldText = latestSnapshot;
                    }
                  } else {
                    // Idle timeout 或硬上限：做最後一次讀取
                    try {
                      fieldText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                    } catch {
                      // fallback to snapshot
                      fieldText = latestSnapshot;
                    }
                  }

                  if (!fieldText || !fieldText.trim()) {
                    writeInfoLog(
                      "[correction] field text is null or empty — skipping analysis",
                    );
                    return;
                  }
                  // fieldText 為游標附近的「excerpt」（非整欄文字），故需雙向比對：
                  // 整欄仍含 pasted（短輸入）→ includes；或 excerpt 是 pasted 的子字串（長輸入未改）→ 反向 includes。
                  const trimmedField = fieldText.trim();
                  if (
                    fieldText.includes(pastedText) ||
                    pastedText.includes(trimmedField)
                  ) {
                    writeInfoLog(
                      "[correction] text unchanged — skipping analysis",
                    );
                    return;
                  }

                  // 相似度檢查：以 excerpt 為基準（excerpt 多數字元應來自 pasted 區域）。
                  // 若 excerpt 與 pasted 幾乎無關（AX/UIA 讀到錯的欄位），跳過。
                  const overlapCharCount = [...trimmedField].filter((ch) =>
                    pastedText.includes(ch),
                  ).length;
                  const overlapRatio =
                    trimmedField.length > 0
                      ? overlapCharCount / trimmedField.length
                      : 0;
                  if (overlapRatio < 0.3) {
                    writeInfoLog(
                      `[correction] field text unrelated to original (overlap=${Math.round(overlapRatio * 100)}%) — skipping analysis`,
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] text modified (overlap=${Math.round(overlapRatio * 100)}%) — sending to AI analysis\n  original:  ${pastedText.slice(0, 80)}\n  corrected: ${fieldText.slice(0, 80)}`,
                  );

                  const analysisResult = await analyzeCorrections(
                    pastedText,
                    fieldText,
                    apiKey,
                    {
                      modelId: settingsStore.selectedLlmModelId,
                    },
                  );

                  writeInfoLog(
                    `[correction] AI raw: ${analysisResult.rawResponse}`,
                  );
                  writeInfoLog(
                    `[correction] AI result: ${JSON.stringify(analysisResult.suggestedTermList)} (tokens: ${analysisResult.usage?.totalTokens ?? "??"})`,
                  );

                  if (analysisResult.suggestedTermList.length === 0) return;

                  const vocabularyStore = useVocabularyStore();
                  const newTermList: string[] = [];

                  for (const term of analysisResult.suggestedTermList) {
                    if (vocabularyStore.isDuplicateTerm(term)) {
                      // 已存在的詞 weight +1
                      const existingEntry = vocabularyStore.termList.find(
                        (e) =>
                          e.term.trim().toLowerCase() ===
                          term.trim().toLowerCase(),
                      );
                      if (existingEntry) {
                        void vocabularyStore
                          .batchIncrementWeights([existingEntry.id])
                          .catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: batchIncrementWeights failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                      }
                    } else {
                      await vocabularyStore.addAiSuggestedTerm(term);
                      newTermList.push(term);
                    }
                  }

                  // 記錄 API 用量
                  if (analysisResult.usage) {
                    const historyStore = useHistoryStore();
                    void historyStore
                      .addApiUsage({
                        id: crypto.randomUUID(),
                        transcriptionId,
                        apiType: "vocabulary_analysis",
                        model: settingsStore.selectedLlmModelId,
                        promptTokens: analysisResult.usage.promptTokens,
                        completionTokens: analysisResult.usage.completionTokens,
                        totalTokens: analysisResult.usage.totalTokens,
                        promptTimeMs: analysisResult.usage.promptTimeMs ?? null,
                        completionTimeMs: analysisResult.usage.completionTimeMs ?? null,
                        totalTimeMs: analysisResult.usage.totalTimeMs ?? null,
                        audioDurationMs: null,
                        estimatedCostCeiling: calculateChatCostCeiling(
                          analysisResult.usage.totalTokens,
                          settingsStore.selectedLlmModelId,
                        ),
                      })
                      .catch((err) =>
                        writeErrorLog(
                          `useVoiceFlowStore: addApiUsage(vocabulary_analysis) failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                  }

                  // 通知 HUD 新學習的詞（只包含新增的，不包含已存在的）
                  if (newTermList.length > 0) {
                    writeInfoLog(
                      `useVoiceFlowStore: emitting VOCABULARY_LEARNED: ${newTermList.join(", ")}`,
                    );
                    try {
                      await emitEvent(VOCABULARY_LEARNED, {
                        termList: newTermList,
                      } satisfies VocabularyLearnedPayload);
                      writeInfoLog(
                        "useVoiceFlowStore: VOCABULARY_LEARNED emitted successfully",
                      );

                      // HUD 視窗在 idle 後已被 hideHud() 隱藏，需重新顯示才看得到通知
                      clearLearnedHideTimer();
                      const appWindow = getAppWindow();
                      await appWindow.show();
                      await appWindow.setIgnoreCursorEvents(true);
                      learnedHideTimer = setTimeout(() => {
                        learnedHideTimer = null;
                        if (status.value === "idle") {
                          hideHud().catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: learned hideHud failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                        }
                      }, LEARNED_NOTIFICATION_TOTAL_DURATION_MS);
                    } catch (emitErr) {
                      writeErrorLog(
                        `useVoiceFlowStore: VOCABULARY_LEARNED emit failed: ${extractErrorMessage(emitErr)}`,
                      );
                    }
                  }
                } catch (err) {
                  writeErrorLog(
                    `useVoiceFlowStore: correction analysis failed: ${extractErrorMessage(err)}`,
                  );
                  captureError(err, {
                    source: "voice-flow",
                    step: "correction-analysis",
                  });
                }
              })();
            },
          );
      } catch (err) {
        stopCorrectionSnapshotPolling();
        cleanupCorrectionMonitorListener();
        writeErrorLog(
          `useVoiceFlowStore: correction detection failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "correction-detection",
        });
      }
    })();
  }

  async function completePasteFlow(params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
    skipRecordSaving?: boolean;
  }) {
    try {
      const settingsStore = useSettingsStore();
      await invoke("paste_text", {
        text: params.text,
        restoreClipboard: !settingsStore.isCopyTranscriptionToClipboardEnabled,
      });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      // api_usage FK 依賴 transcriptions — 必須等 transcription 寫入後才存 usage
      // retry 路徑使用 updateTranscriptionOnRetrySuccess，不走 INSERT
      if (!params.skipRecordSaving) {
        void saveTranscriptionRecord(params.record).then(() => {
          saveApiUsageRecordList(params.record, params.chatUsage);
        });
      }

      // 權重更新（fire-and-forget）
      const finalText = params.record.processedText ?? params.record.rawText;
      updateVocabularyWeightsAfterPaste(finalText);

      // 修正偵測（fire-and-forget，需 LLM API key）
      const llmApiKey = settingsStore.getLlmApiKey();
      if (llmApiKey) {
        startCorrectionDetectionFlow(params.text, params.record.id, llmApiKey);
      }
    } catch (pasteError) {
      isRecording.value = false;
      failRecordingFlow(
        t("voiceFlow.pasteFailed"),
        `useVoiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
        pasteError,
      );
    }
  }

  function saveApiUsageRecordList(
    record: TranscriptionRecord,
    chatUsage: ChatUsageData | null,
  ) {
    const historyStore = useHistoryStore();
    const settingsStore = useSettingsStore();
    const roundedAudioMs = record.recordingDurationMs;

    function fireAndForget(usageRecord: ApiUsageRecord) {
      historyStore
        .addApiUsage(usageRecord)
        .catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: addApiUsage(${usageRecord.apiType}) failed: ${extractErrorMessage(err)}`,
          ),
        );
    }

    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "whisper",
      model: settingsStore.selectedWhisperModelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        roundedAudioMs,
        settingsStore.selectedWhisperModelId,
      ),
    });

    if (chatUsage) {
      fireAndForget({
        id: crypto.randomUUID(),
        transcriptionId: record.id,
        apiType: "chat",
        model: settingsStore.selectedLlmModelId,
        promptTokens: chatUsage.promptTokens,
        completionTokens: chatUsage.completionTokens,
        totalTokens: chatUsage.totalTokens,
        promptTimeMs: chatUsage.promptTimeMs ?? null,
        completionTimeMs: chatUsage.completionTimeMs ?? null,
        totalTimeMs: chatUsage.totalTimeMs ?? null,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(
          chatUsage.totalTokens,
          settingsStore.selectedLlmModelId,
        ),
      });
    }
  }

  function clearDoubleTapTimer() {
    if (doubleTapDelayTimer) {
      clearTimeout(doubleTapDelayTimer);
      doubleTapDelayTimer = null;
    }
  }

  /**
   * Wait for double-tap resolution: returns true if mode-toggle event arrives
   * within 400ms, false if timer expires (not a double-tap).
   */
  function waitForDoubleTapResolution(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      doubleTapResolve = resolve;
      clearDoubleTapTimer();
      doubleTapDelayTimer = setTimeout(() => {
        doubleTapDelayTimer = null;
        doubleTapResolve = null;
        resolve(false);
      }, 400);
    });
  }

  function handleDoubleTapModeToggle() {
    if (doubleTapResolve) {
      // Hold 模式連按兩下：只讓等待中的流程知道「這是連按」
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(true);
    }
    // Toggle 長按：模式切換已移除，no-op（Rust 仍會吞掉這次 toggle）
  }

  /** 連按兩下確認：靜默取消這輪錄音，不切模式、HUD 不顯示模式名。 */
  function cancelDoubleTapRecording() {
    isRecording.value = false;
    // 世代 +1：這輪錄音被雙擊靜默取消，途中的非同步回呼全部失效
    recordingEpoch += 1;
    inputContextProbe = null;
    transitionTo("idle");
  }

  function handleEscapeAbort() {
    const currentStatus = status.value;
    if (
      currentStatus === "idle" ||
      currentStatus === "success" ||
      currentStatus === "error" ||
      currentStatus === "cancelled"
    )
      return;

    writeInfoLog(`useVoiceFlowStore: ESC abort from ${currentStatus}`);
    isAborted.value = true;
    abortController?.abort();

    // 無條件重置 isRecording，避免永久鎖死
    isRecording.value = false;

    if (currentStatus === "recording") {
      void invoke("stop_recording").catch(() => {});
      stopElapsedTimer();
    }

    // Resolve pending double-tap Promise (prevents handleStopRecording from hanging)
    if (doubleTapResolve) {
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(false);
    }

    // 完整清理所有進行中的資源
    clearDelayedMuteTimer();
    stopMonitorPolling();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();
    void restoreSystemAudio();
    // 世代 +1：讓仍在途的非同步回呼全部過期失效
    recordingEpoch += 1;
    inputContextProbe = null;

    // 重置 toggle 模式狀態
    void invoke("reset_hotkey_state").catch(() => {});

    transitionTo("cancelled", t("voiceFlow.cancelled"));
  }

  /** 取用本輪錄音的輸入上下文（取用即清空），最多等 INPUT_CONTEXT_WAIT_MS。 */
  async function takeInputContext(): Promise<InputContextDto | null> {
    const probe = inputContextProbe;
    inputContextProbe = null;
    if (!probe) return null;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), INPUT_CONTEXT_WAIT_MS);
    });
    try {
      return await Promise.race([probe, timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    recordingStartTimestamp = performance.now();
    isAborted.value = false;
    abortController = new AbortController();
    lastWasModified.value = null;

    // 重置重送狀態（新錄音開始時清除上次失敗的重送資訊）
    lastFailedTranscriptionId.value = null;
    lastFailedAudioFilePath.value = null;
    lastFailedRecordingDurationMs.value = 0;
    lastFailedPeakEnergyLevel.value = 0;
    lastFailedRmsEnergyLevel.value = 0;
    isRetryAttempt.value = false;

    // 捕獲當前前景視窗（Windows: HUD show 前記住目標，貼上前恢復焦點）
    void invoke("capture_target_window").catch(() => {});

    // 新一代錄音：讓上一輪仍在途的非同步回呼過期失效
    recordingEpoch += 1;

    // 輸入上下文（非阻塞）：錄音開始時趁焦點還在目標 App 讀
    inputContextProbe = useSettingsStore().isInputContextEnabled
      ? invoke<InputContextDto>("read_input_context").catch(() => null)
      : null;

    try {
      playSoundIfEnabled("play_start_sound");
      delayedMuteTimer = setTimeout(() => {
        delayedMuteTimer = null;
        void muteSystemAudioIfEnabled();
      }, START_SOUND_DURATION_MS);
      await invoke("start_recording", {
        deviceName: useSettingsStore().selectedAudioInputDeviceName,
      });
      if (isAborted.value) return;
      startElapsedTimer();
      transitionTo("recording", t("voiceFlow.recording"));
      writeInfoLog("useVoiceFlowStore: recording started");
    } catch (error) {
      const errorMessage = getMicrophoneErrorMessage(error);
      const technicalErrorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${technicalErrorMessage}`,
        error,
      );
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;
    if (isAborted.value) return;

    // Pre-estimate duration for double-tap detection (before any async work).
    // Use precise timestamp — recordingElapsedSeconds has 1s resolution, too coarse for 300ms threshold.
    // Rust double-tap max hold is 300ms; 350ms here adds 50ms buffer for IPC latency.
    const estimatedDurationMs = performance.now() - recordingStartTimestamp;
    if (estimatedDurationMs < 350) {
      const isDoubleTap = await waitForDoubleTapResolution();
      if (isAborted.value) return;
      if (isDoubleTap) {
        // Double-tap confirmed: silently cancel, no mode change / HUD flash
        stopElapsedTimer();
        clearDelayedMuteTimer();
        void restoreSystemAudio();
        void invoke("stop_recording").catch(() => {});
        cancelDoubleTapRecording();
        return;
      }
      // Not a double-tap — fall through to normal stop flow
    }

    clearDelayedMuteTimer();
    await restoreSystemAudio();
    playSoundIfEnabled("play_stop_sound");
    stopElapsedTimer();

    // 生成 transcriptionId 貫穿整個流程
    const transcriptionId = crypto.randomUUID();
    // 提升到 try 外層，讓 catch 也能存取（AC2: API 錯誤時仍寫入 failed 記錄）
    let audioFilePath: string | null = null;
    let recordingDurationMs = 0;
    let peakEnergyLevel = 0;
    let rmsEnergyLevel = 0;

    try {
      const stopResult = await invoke<StopRecordingResult>("stop_recording");
      if (isAborted.value) return;
      recordingDurationMs = stopResult.recordingDurationMs;
      peakEnergyLevel = stopResult.peakEnergyLevel;
      rmsEnergyLevel = stopResult.rmsEnergyLevel;

      // 錄音檔儲存（不阻斷主流程）
      try {
        audioFilePath = await invoke<string>("save_recording_file", {
          id: transcriptionId,
        });
        writeInfoLog(`useVoiceFlowStore: recording saved: ${audioFilePath}`);
      } catch (saveErr) {
        writeErrorLog(
          `useVoiceFlowStore: save_recording_file failed (non-blocking): ${extractErrorMessage(saveErr)}`,
        );
        captureError(saveErr, {
          source: "voice-flow",
          step: "save-recording-file",
        });
      }

      const MINIMUM_RECORDING_DURATION_MS = 300;
      if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
        // 錄音太短 → 寫入 failed 記錄，保留錄音檔
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        failRecordingFlow(
          t("voiceFlow.recordingTooShort"),
          `useVoiceFlowStore: recording too short (${Math.round(recordingDurationMs)}ms)`,
        );
        return;
      }

      transitionTo("transcribing", t("voiceFlow.transcribing"));
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        failRecordingFlow(
          t("errors.apiKeyMissing"),
          "useVoiceFlowStore: missing API key while transcribing",
        );
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      const result = await invoke<TranscriptionResult>("transcribe_audio", {
        apiKey,
        vocabularyTermList: hasVocabulary ? whisperTermList : null,
        whisperPrompt: buildWhisperPrompt(
          whisperTermList,
          getEffectiveTranscriptLocale(),
        ),
        modelId: settingsStore.selectedWhisperModelId,
        language: settingsStore.getWhisperLanguageCode(),
      });
      if (isAborted.value) return;

      // #39：轉譯語言為繁中時，把 Whisper 的簡體輸出轉成繁體（落地前一次到位）
      result.rawText = applyTranscriptTextTransforms(result.rawText);

      writeInfoLog(`轉錄原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 空轉錄 → 寫入 failed 記錄，保留錄音檔
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText || "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態（空轉錄：主要重送目標）
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: empty transcription (noSpeechProb=${result.noSpeechProbability.toFixed(3)})`,
        );
        return;
      }

      // ── 幻覺偵測（純物理信號：語速異常 + 無人聲）──
      writeInfoLog(
        `useVoiceFlowStore: hallucination detection input: peakEnergy=${peakEnergyLevel.toFixed(4)}, rmsEnergy=${rmsEnergyLevel.toFixed(4)}, nsp=${result.noSpeechProbability.toFixed(3)}, rawText="${result.rawText}", durationMs=${Math.round(recordingDurationMs)}`,
      );

      const hallucinationDetectionResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel,
        rmsEnergyLevel,
        noSpeechProbability: result.noSpeechProbability,
      });

      writeInfoLog(
        `useVoiceFlowStore: hallucination detection result: isHallucination=${hallucinationDetectionResult.isHallucination}, reason=${hallucinationDetectionResult.reason}`,
      );

      if (hallucinationDetectionResult.isHallucination) {
        // 寫入 failed 記錄
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: hallucination intercepted (reason=${hallucinationDetectionResult.reason})`,
        );
        return;
      }

      // 選取文字再說話＝一般聽寫：不偵測選取、不模擬 Cmd+C，貼上會取代選取內容
      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        // 本輪世代：下面的等待期間若 ESC 取消後立刻重錄，世代會變，
        // 舊流程必須放棄，不能拿新一輪的 abortController 繼續處理舊逐字稿
        const enhanceEpoch = recordingEpoch;
        const isStaleFlow = () =>
          isAborted.value || enhanceEpoch !== recordingEpoch;
        // 缺 LLM key 時 HUD 要看得出原因（新安裝預設 Gemini，可能只填了 Groq key）
        let isLlmApiKeyMissing = false;

        try {
          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          // 取 probe 前同步檢查：過期流程不能把新一輪錄音的上下文取走
          if (isStaleFlow()) return;
          const inputContext = await takeInputContext();
          if (isStaleFlow()) return;
          writeInfoLog(
            `useVoiceFlowStore: input context ${inputContext ? `app=${inputContext.appName ?? "-"}, before=${inputContext.textBeforeCursor?.length ?? 0}, after=${inputContext.textAfterCursor?.length ?? 0}` : "none"}`,
          );

          // 所有等待結束後才取 key：refresh 之後同步讀出 key 與 model（中間沒有 await），
          // 確保兩者來自同一份設定，跨視窗切換 provider 不會讓 key 送錯平台
          await settingsStore.refreshLlmApiKey();
          if (isStaleFlow()) return;
          const llmApiKey = settingsStore.getLlmApiKey();
          const llmModelId = settingsStore.selectedLlmModelId;
          writeInfoLog(
            `useVoiceFlowStore: enhancement provider=${getProviderIdForModel(llmModelId)}, model=${llmModelId}, transcriptLocale=${getEffectiveTranscriptLocale()}, hasContext=${Boolean(inputContext)}`,
          );
          if (!llmApiKey) {
            isLlmApiKeyMissing = true;
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhanceOptions = {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: llmModelId,
            signal: abortController?.signal,
            transcriptLocale: getEffectiveTranscriptLocale(),
            inputContext,
          };

          let enhanceResult = await enhanceText(
            result.rawText,
            llmApiKey,
            enhanceOptions,
          );
          // 新一輪錄音會清掉 isAborted，只看它擋不住舊流程貼出上一輪的結果
          if (isStaleFlow()) return;

          // 增強後長度爆炸偵測（含重試機制）
          let retryCount = 0;
          while (
            retryCount < MAX_ENHANCEMENT_RETRY_COUNT &&
            detectEnhancementAnomaly({
              rawText: result.rawText,
              enhancedText: enhanceResult.text,
            }).isAnomaly
          ) {
            retryCount++;
            writeInfoLog(
              `useVoiceFlowStore: enhancement anomaly detected (attempt ${retryCount}/${MAX_ENHANCEMENT_RETRY_COUNT}), retrying`,
            );
            enhanceResult = await enhanceText(
              result.rawText,
              llmApiKey,
              enhanceOptions,
            );
            if (isStaleFlow()) return;
          }

          // 重試後仍異常（長度爆炸）或語意飄走（#43）→ fallback 到 rawText
          const finalAnomaly = detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          });
          const drift = detectSemanticDrift(
            result.rawText,
            enhanceResult.text,
          );
          const shouldFallbackToRaw = finalAnomaly.isAnomaly || drift.isDrift;
          if (shouldFallbackToRaw) {
            writeErrorLog(
              `useVoiceFlowStore: enhancement rejected (anomaly=${finalAnomaly.reason ?? "none"}, drift=${drift.isDrift}, overlap=${drift.overlapRatio.toFixed(2)}), falling back to raw text`,
            );
            enhanceResult = { ...enhanceResult, text: result.rawText };
          }

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: !shouldFallbackToRaw,
            audioFilePath,
            status: "success",
          });

          writeInfoLog(`AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
          });

          writeInfoLog(
            `useVoiceFlowStore: pasted enhanced text, recordingDurationMs=${Math.round(
              recordingDurationMs,
            )}, transcriptionDurationMs=${Math.round(
              result.transcriptionDurationMs,
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}${retryCount > 0 ? `, enhancementRetryCount=${retryCount}` : ""}`,
          );
        } catch (enhanceError) {
          // 舊 LLM 呼叫被新一輪的 abort 打斷時也走到這裡：不能把上一輪逐字稿貼出去
          if (isStaleFlow()) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
          writeErrorLog(
            `useVoiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: isLlmApiKeyMissing
              ? `${t("voiceFlow.pasteSuccessUnenhanced")} · ${t("errors.apiKeyMissing")}`
              : t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
          });
        }
      } else {
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
        });

        writeInfoLog(
          `useVoiceFlowStore: pasted text (skipped enhancement, length=${result.rawText.length}), recordingDurationMs=${Math.round(
            recordingDurationMs,
          )}, transcriptionDurationMs=${Math.round(result.transcriptionDurationMs)}`,
        );
      }
    } catch (error) {
      if (isAborted.value) return;
      // AC2: API 錯誤時仍寫入 failed 記錄（如果有 audioFilePath）
      if (audioFilePath) {
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態（API 錯誤：暫時性問題，重送有意義）
        lastFailedTranscriptionId.value = transcriptionId;
        lastFailedAudioFilePath.value = audioFilePath;
        lastFailedRecordingDurationMs.value = recordingDurationMs;
        lastFailedPeakEnergyLevel.value = peakEnergyLevel;
        lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
      }

      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
        error,
      );
    }
  }

  async function handleRetryTranscription() {
    if (!lastFailedAudioFilePath.value || !lastFailedTranscriptionId.value) {
      return;
    }

    isAborted.value = false;
    abortController = new AbortController();
    isRetryAttempt.value = true;
    clearAutoHideTimer();
    transitionTo("transcribing", t("voiceFlow.transcribing"));

    const filePath = lastFailedAudioFilePath.value;
    const transcriptionId = lastFailedTranscriptionId.value;
    const recordingDurationMs = lastFailedRecordingDurationMs.value;

    try {
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        transitionTo("error", t("errors.apiKeyMissing"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      const result = await invoke<TranscriptionResult>(
        "retranscribe_from_file",
        {
          filePath,
          apiKey,
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
          whisperPrompt: buildWhisperPrompt(
            whisperTermList,
            getEffectiveTranscriptLocale(),
          ),
          modelId: settingsStore.selectedWhisperModelId,
          language: settingsStore.getWhisperLanguageCode(),
        },
      );
      if (isAborted.value) return;

      // #39：同主路徑，重送轉錄後也套用簡→繁
      result.rawText = applyTranscriptTextTransforms(result.rawText);

      writeInfoLog(`重送轉錄原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 重送也失敗 → 不再提供重送
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // ── 重送也需幻覺偵測（使用原始錄音的 energy levels）──
      const retryHallucinationResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel: lastFailedPeakEnergyLevel.value,
        rmsEnergyLevel: lastFailedRmsEnergyLevel.value,
        noSpeechProbability: result.noSpeechProbability,
      });

      if (retryHallucinationResult.isHallucination) {
        writeInfoLog(
          `useVoiceFlowStore: retry hallucination detected (reason=${retryHallucinationResult.reason})`,
        );
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // 重送成功 → 進入 AI 整理 → 貼上流程
      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          await settingsStore.refreshLlmApiKey();
          const llmApiKey = settingsStore.getLlmApiKey();
          if (!llmApiKey) {
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          let enhanceResult = await enhanceText(result.rawText, llmApiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
            signal: abortController?.signal,
            transcriptLocale: getEffectiveTranscriptLocale(),
          });
          if (isAborted.value) return;

          // 重送路徑同樣套用守衛（長度爆炸 / 語意飄走 #43）→ fallback 到 rawText
          const resendAnomaly = detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          });
          const resendDrift = detectSemanticDrift(
            result.rawText,
            enhanceResult.text,
          );
          const shouldFallbackToRaw =
            resendAnomaly.isAnomaly || resendDrift.isDrift;
          if (shouldFallbackToRaw) {
            writeErrorLog(
              `useVoiceFlowStore: resend enhancement rejected (anomaly=${resendAnomaly.reason ?? "none"}, drift=${resendDrift.isDrift}, overlap=${resendDrift.overlapRatio.toFixed(2)}), falling back to raw text`,
            );
            enhanceResult = { ...enhanceResult, text: result.rawText };
          }

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: !shouldFallbackToRaw,
            audioFilePath: filePath,
            status: "success",
          });

          writeInfoLog(`重送 AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
            skipRecordSaving: true,
          });

          // 更新 DB status（UPDATE 而非 INSERT）→ 完成後記錄 API 用量（FK 依賴）
          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: enhanceResult.text,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(enhancementDurationMs),
              wasEnhanced: !shouldFallbackToRaw,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(record, enhanceResult.usage);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        } catch (enhanceError) {
          if (isAborted.value) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          writeErrorLog(
            `useVoiceFlowStore: retry AI enhancement failed: ${getEnhancementErrorMessage(enhanceError)}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "retry-enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath: filePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
            skipRecordSaving: true,
          });

          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: null,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(fallbackEnhancementDurationMs),
              wasEnhanced: false,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(fallbackRecord, null);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        }
      } else {
        // 不需要 AI 整理
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath: filePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
          skipRecordSaving: true,
        });

        const historyStore = useHistoryStore();
        void historyStore
          .updateTranscriptionOnRetrySuccess({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
            enhancementDurationMs: null,
            wasEnhanced: false,
            charCount: result.rawText.length,
          })
          .then(() => {
            saveApiUsageRecordList(record, null);
          })
          .catch((err) =>
            writeErrorLog(
              `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            ),
          );
      }

      // 重送成功 → 重置所有重送狀態
      lastFailedTranscriptionId.value = null;
      lastFailedAudioFilePath.value = null;
      lastFailedRecordingDurationMs.value = 0;
      isRetryAttempt.value = false;
    } catch (error) {
      if (isAborted.value) return;
      // 重送也失敗（API 錯誤等）→ 不再提供重送
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("play_error_sound");
      lastFailedAudioFilePath.value = null;
      isRetryAttempt.value = false;
      writeErrorLog(
        `useVoiceFlowStore: retry transcription failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, {
        source: "voice-flow",
        step: "retry-transcription",
      });
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

    const listeners = await Promise.all([
      listenToEvent(ESCAPE_PRESSED, () => {
        handleEscapeAbort();
      }),
      listenToEvent(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listenToEvent(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listenToEvent<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }

        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listenToEvent<QualityMonitorResultPayload>(
        QUALITY_MONITOR_RESULT,
        (event) => {
          lastWasModified.value = event.payload.wasModified;
          writeInfoLog(
            `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
          );
        },
      ),
      listenToEvent(HOTKEY_MODE_TOGGLE, () => {
        handleDoubleTapModeToggle();
      }),
      listenToEvent<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const hudMessage = getHotkeyErrorMessage(event.payload.error);
        if (
          event.payload.error === HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION
        ) {
          void (async () => {
            try {
              const mainWindow = await Window.getByLabel("main-window");
              if (!mainWindow) return;
              await mainWindow.show();
              await mainWindow.setFocus();
            } catch (err) {
              writeErrorLog(
                `useVoiceFlowStore: show/focus main-window failed: ${extractErrorMessage(err)}`,
              );
            }
          })();
        }
        transitionTo("error", hudMessage);
        playSoundIfEnabled("play_error_sound");
        writeErrorLog(
          `useVoiceFlowStore: hotkey error: ${event.payload.message}`,
        );
      }),
    ]);
    unlistenFunctions.push(...listeners);
  }

  function cleanup() {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    clearDelayedMuteTimer();
    clearLearnedHideTimer();
    clearDoubleTapTimer();
    stopMonitorPolling();
    stopElapsedTimer();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    recordingElapsedSeconds,
    lastWasModified,
    canRetry,
    initialize,
    cleanup,
    handleRetryTranscription,
    transitionTo,
  };
});
