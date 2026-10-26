<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { HudStatus } from "../types";
import type { VocabularyLearnedPayload } from "../types/events";
import { useAudioWaveform } from "../composables/useAudioWaveform";
import {
  listenToEvent,
  VOCABULARY_LEARNED,
} from "../composables/useTauriEvents";
import { useI18n } from "vue-i18n";
import { BookOpen, Check, Heart, RotateCcw, Sparkles, X } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "../stores/useSettingsStore";

const { t } = useI18n();

type VisualMode =
  | "hidden"
  | "recording"
  | "morphing"
  | "transcribing"
  | "success"
  | "error"
  | "cancelled"
  | "collapsing"
  | "learned";

const props = defineProps<{
  status: HudStatus;
  recordingElapsedSeconds: number;
  message: string;
  canRetry: boolean;
}>();

defineEmits<{
  retry: [];
}>();

const visualMode = ref<VisualMode>("hidden");
let morphingTimer: ReturnType<typeof setTimeout> | null = null;
let collapsingTimer: ReturnType<typeof setTimeout> | null = null;
let learnedTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenVocabularyLearned: UnlistenFn | null = null;
const pendingLearnedTermList = ref<string[][]>([]);
const learnedDisplayText = ref("");
const COLLAPSE_ANIMATION_DURATION_MS = 400;
const LEARNED_DISPLAY_DURATION_MS = 2000;
const MAX_DISPLAY_TERM_COUNT = 3;

const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } =
  useAudioWaveform();

const WAVEFORM_ELEMENT_COUNT = 6;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 28;
const ERROR_WITH_MESSAGE_HEIGHT = 72;

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const DEFAULT_NOTCH_SHAPE: NotchShapeParams = {
  width: 420,
  height: 42,
  topRadius: 14,
  bottomRadius: 22,
};

const NOTCH_SHAPE_OVERRIDES: Partial<Record<VisualMode, NotchShapeParams>> = {
  collapsing: { width: 200, height: 32, topRadius: 10, bottomRadius: 16 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

const hasErrorMessage = computed(
  () => visualMode.value === "error" && props.message !== "",
);

const isExpandedMode = computed(
  () => hasErrorMessage.value || visualMode.value === "learned",
);

const notchStyle = computed(() => {
  let params = NOTCH_SHAPE_OVERRIDES[visualMode.value] ?? DEFAULT_NOTCH_SHAPE;
  if (isExpandedMode.value) {
    params = { ...params, height: ERROR_WITH_MESSAGE_HEIGHT };
  }
  return {
    width: `${params.width}px`,
    height: `${params.height}px`,
    clipPath: buildNotchPath(params),
  };
});

const formattedElapsedTime = computed(() => {
  const totalSeconds = props.recordingElapsedSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const barStyleList = computed(() => {
  const styleList: Record<string, string>[] = [];
  for (let i = 0; i < WAVEFORM_ELEMENT_COUNT; i++) {
    if (visualMode.value === "recording") {
      const level = waveformLevelList.value[i] ?? 0;
      const height =
        MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      styleList.push({
        height: `${Math.round(height)}px`,
        width: "4px",
        borderRadius: "2px",
      });
    } else {
      styleList.push({});
    }
  }
  return styleList;
});

const waveformElementClass = computed(() => {
  switch (visualMode.value) {
    case "recording":
      return "waveform-bar";
    case "morphing":
      return "waveform-morphing";
    case "transcribing":
      return "waveform-dot";
    case "success":
      return "waveform-converge";
    case "error":
      return "waveform-scatter";
    default:
      return "";
  }
});

const notchHudClassList = computed(() => ({
  "notch-shake": visualMode.value === "error",
  "notch-collapsing": visualMode.value === "collapsing",
}));

const isHighPriorityMode = computed(() => {
  const mode = visualMode.value;
  return (
    mode === "recording" ||
    mode === "morphing" ||
    mode === "transcribing" ||
    mode === "success" ||
    mode === "error" ||
    mode === "cancelled"
  );
});

function clearMorphingTimer() {
  if (morphingTimer) {
    clearTimeout(morphingTimer);
    morphingTimer = null;
  }
}

function clearCollapsingTimer() {
  if (collapsingTimer) {
    clearTimeout(collapsingTimer);
    collapsingTimer = null;
  }
}

function clearLearnedTimer() {
  if (learnedTimer) {
    clearTimeout(learnedTimer);
    learnedTimer = null;
  }
}

function formatLearnedText(termList: string[]): string {
  if (termList.length <= MAX_DISPLAY_TERM_COUNT) {
    return t("voiceFlow.vocabularyLearned", {
      terms: termList.join(", "),
    });
  }
  const displayedTermList = termList.slice(0, MAX_DISPLAY_TERM_COUNT);
  return t("voiceFlow.vocabularyLearnedTruncated", {
    terms: displayedTermList.join(", "),
    count: termList.length - MAX_DISPLAY_TERM_COUNT,
  });
}

function showLearnedNotification(termList: string[]) {
  learnedDisplayText.value = formatLearnedText(termList);
  visualMode.value = "learned";
  if (useSettingsStore().isSoundEffectsEnabled) {
    void invoke("play_learned_sound").catch(() => {});
  }
  clearLearnedTimer();
  learnedTimer = setTimeout(() => {
    visualMode.value = "collapsing";
    collapsingTimer = setTimeout(() => {
      visualMode.value = "hidden";
      processNextLearnedNotification();
    }, COLLAPSE_ANIMATION_DURATION_MS);
  }, LEARNED_DISPLAY_DURATION_MS);
}

function processNextLearnedNotification() {
  if (pendingLearnedTermList.value.length === 0) return;
  if (isHighPriorityMode.value) return;
  const nextTermList = pendingLearnedTermList.value.shift()!;
  showLearnedNotification(nextTermList);
}

function handleVocabularyLearned(payload: VocabularyLearnedPayload) {
  console.log(
    `[NotchHud] VOCABULARY_LEARNED received: termList=${JSON.stringify(payload.termList)}, visualMode=${visualMode.value}, isHighPriority=${isHighPriorityMode.value}`,
  );
  if (!payload.termList || payload.termList.length === 0) return;

  if (isHighPriorityMode.value || visualMode.value === "learned") {
    console.log("[NotchHud] queued (high priority or already showing learned)");
    pendingLearnedTermList.value.push(payload.termList);
    return;
  }

  console.log("[NotchHud] showing learned notification now");
  showLearnedNotification(payload.termList);
}

watch(
  () => props.status,
  (nextStatus) => {
    clearMorphingTimer();
    clearCollapsingTimer();
    clearLearnedTimer();

    if (nextStatus === "idle") {
      stopWaveformAnimation();
      if (visualMode.value === "learned") return;
      if (visualMode.value === "hidden") {
        processNextLearnedNotification();
        return;
      }
      visualMode.value = "collapsing";
      collapsingTimer = setTimeout(() => {
        visualMode.value = "hidden";
        processNextLearnedNotification();
      }, COLLAPSE_ANIMATION_DURATION_MS);
      return;
    }

    if (nextStatus === "recording") {
      visualMode.value = "recording";
      startWaveformAnimation();
      return;
    }

    if (
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      stopWaveformAnimation();
      if (
        visualMode.value === "recording" ||
        visualMode.value === "morphing"
      ) {
        visualMode.value = "morphing";
        morphingTimer = setTimeout(() => {
          visualMode.value = "transcribing";
        }, 300);
      } else {
        visualMode.value = "transcribing";
      }
      return;
    }

    if (nextStatus === "success") {
      stopWaveformAnimation();
      visualMode.value = "success";
      return;
    }

    if (nextStatus === "error") {
      stopWaveformAnimation();
      visualMode.value = "error";
      return;
    }

    if (nextStatus === "cancelled") {
      stopWaveformAnimation();
      visualMode.value = "cancelled";
      return;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  unlistenVocabularyLearned = await listenToEvent<VocabularyLearnedPayload>(
    VOCABULARY_LEARNED,
    (event) => {
      handleVocabularyLearned(event.payload);
    },
  );
});

onUnmounted(() => {
  clearMorphingTimer();
  clearCollapsingTimer();
  clearLearnedTimer();
  stopWaveformAnimation();
  unlistenVocabularyLearned?.();
});
</script>

<template>
  <div
    v-if="visualMode !== 'hidden'"
    class="notch-wrapper"
    :class="{
      'notch-wrapper-success': visualMode === 'success',
      'notch-wrapper-learned': visualMode === 'learned',
    }"
  >
    <div
      class="notch-hud"
      :class="[notchHudClassList, { 'notch-hud-expanded': isExpandedMode }]"
      :style="notchStyle"
    >
      <Sparkles class="notch-star notch-star-left" :size="10" aria-hidden="true" />
      <div class="notch-content">
        <div class="notch-left">
          <!-- Cancelled: X icon -->
          <X
            v-if="visualMode === 'cancelled'"
            class="cancelled-icon-svg"
            :size="18"
            aria-hidden="true"
          />
          <!-- Learned: book icon -->
          <BookOpen
            v-else-if="visualMode === 'learned'"
            class="learned-icon-svg"
            :size="18"
            aria-hidden="true"
          />
          <!-- Other modes: waveform + state icon -->
          <template v-else>
            <Heart
              v-if="visualMode === 'recording'"
              class="heart-pulse"
              :size="16"
              aria-hidden="true"
            />
            <Sparkles
              v-else-if="visualMode === 'morphing' || visualMode === 'transcribing'"
              class="magic-star"
              :size="14"
              aria-hidden="true"
            />
            <div class="waveform-container">
              <span
                v-for="(style, index) in barStyleList"
                :key="index"
                class="waveform-element"
                :class="[
                  waveformElementClass,
                  visualMode === 'recording' ? 'wave-candy-bar' : '',
                  visualMode === 'recording' ? `wave-candy-${index + 1}` : '',
                ]"
                :style="style"
              />
            </div>
            <span v-if="visualMode === 'success'" class="success-medal">
              <Check :size="12" aria-hidden="true" />
            </span>
          </template>
        </div>

        <div class="notch-camera-gap" />

        <div class="notch-right">
          <span v-if="visualMode === 'cancelled'" class="cancelled-label">
            {{ $t('voiceFlow.cancelled') }}
          </span>
          <span v-else-if="visualMode === 'learned'" class="learned-label">
            {{ $t('voiceFlow.vocabularyLearnedLabel') }}
          </span>
          <template v-else-if="visualMode === 'recording'">
            <span class="elapsed-timer badge-jelly">
              {{ formattedElapsedTime }}
            </span>
          </template>
          <Button
            v-else-if="visualMode === 'error' && canRetry"
            variant="destructive"
            size="sm"
            class="retry-icon h-6 gap-1 rounded-full border border-destructive/40 bg-gradient-to-r from-destructive to-chart-1 px-2.5 text-xs font-bold shadow-sm"
            @click.stop="$emit('retry')"
          >
            <RotateCcw :size="12" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <!-- Learned: terms row below camera -->
      <div v-if="visualMode === 'learned'" class="learned-terms-row">
        <span class="learned-terms">{{ learnedDisplayText }}</span>
      </div>

      <div v-if="hasErrorMessage" class="error-message-row">
        <span class="error-message">{{ props.message }}</span>
      </div>
      <Sparkles class="notch-star notch-star-right" :size="10" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.notch-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  filter: drop-shadow(var(--notch-glow));
  animation: notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.notch-hud {
  position: relative;
  background: var(--notch-bg);
  border: 1px solid var(--notch-border);
  box-shadow: var(--notch-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    width 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    clip-path 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    background 0.3s ease;
}

/* ---- 裝飾星芒 ---- */
.notch-star {
  position: absolute;
  top: 50%;
  color: var(--notch-star);
  animation: twinkle 1.5s infinite ease-in-out alternate;
  pointer-events: none;
}
.notch-star-left { left: 14px; transform: translateY(-50%); }
.notch-star-right { right: 14px; transform: translateY(-50%); }

@keyframes twinkle {
  0% { opacity: 0.4; transform: translateY(-50%) scale(0.85); }
  100% { opacity: 1; transform: translateY(-50%) scale(1.15); }
}

@keyframes notchEnter {
  from {
    opacity: 0;
    transform: scaleX(0.6) scaleY(0.3);
  }
  to {
    opacity: 1;
    transform: scaleX(1) scaleY(1);
  }
}

.notch-content {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 40px;
}

.notch-left {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  position: relative;
}

.notch-camera-gap {
  width: 40px;
  flex-shrink: 0;
}

.notch-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* ---- Waveform Container ---- */
.waveform-container {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
}

/* ---- Shared Waveform Element ---- */
.waveform-element {
  background: var(--notch-fg);
  transition:
    height 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    width 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.3s ease,
    transform 0.3s ease;
}

/* Recording: dynamic candy bars */
.waveform-bar {
  /* height & width set via inline style */
}
.wave-candy-bar {
  border-radius: 9999px;
  animation: candyBounce 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}
.wave-candy-1 { background: var(--notch-wave-1); animation-delay: 0.1s; }
.wave-candy-2 { background: var(--notch-wave-2); animation-delay: 0.25s; }
.wave-candy-3 { background: var(--notch-wave-3); animation-delay: 0.4s; }
.wave-candy-4 { background: var(--notch-wave-4); animation-delay: 0.15s; }
.wave-candy-5 { background: var(--notch-wave-5); animation-delay: 0.3s; }
.wave-candy-6 { background: var(--notch-wave-6); animation-delay: 0.05s; }

@keyframes candyBounce {
  0% { transform: scaleY(0.35); opacity: 0.7; }
  100% { transform: scaleY(1.15); opacity: 1; }
}

/* ---- Recording: beating heart ---- */
.heart-pulse {
  color: var(--notch-wave-6);
  margin-right: 8px;
  animation: heartBeat 1s infinite;
}
@keyframes heartBeat {
  0%, 100% { transform: scale(1); }
  20% { transform: scale(1.3); }
  40% { transform: scale(0.95); }
}

/* ---- Gap 2: Morphing stagger delay ---- */
.waveform-morphing {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.waveform-morphing:nth-child(1) { transition-delay: 0ms; }
.waveform-morphing:nth-child(2) { transition-delay: 50ms; }
.waveform-morphing:nth-child(3) { transition-delay: 100ms; }
.waveform-morphing:nth-child(4) { transition-delay: 150ms; }
.waveform-morphing:nth-child(5) { transition-delay: 200ms; }
.waveform-morphing:nth-child(6) { transition-delay: 250ms; }

/* ---- Processing: magic sparkle ---- */
.magic-star {
  color: var(--notch-mode);
  margin-right: 8px;
  animation: spinMagic 2s linear infinite;
}
@keyframes spinMagic {
  100% { transform: rotate(360deg); }
}

/* ---- Gap 3: Transcribing dots sliding window ---- */
.waveform-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
  border: 1.5px solid var(--notch-fg-soft);
  animation: dotSlide 1.5s ease-in-out infinite;
}
.waveform-dot:nth-child(1) { animation-delay: 0s; }
.waveform-dot:nth-child(2) { animation-delay: 0.3s; }
.waveform-dot:nth-child(3) { animation-delay: 0.6s; }
.waveform-dot:nth-child(4) { animation-delay: 0.9s; }
.waveform-dot:nth-child(5) { animation-delay: 1.2s; }
.waveform-dot:nth-child(6) {
  display: none;
}

@keyframes dotSlide {
  0%     { background: var(--notch-fg); border-color: var(--notch-fg); }
  50%    { background: var(--notch-fg); border-color: var(--notch-fg); }
  50.01% { background: transparent; border-color: var(--notch-fg-soft); }
  100%   { background: transparent; border-color: var(--notch-fg-soft); }
}

/* ---- Success: converge + SVG checkmark ---- */
.waveform-converge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--notch-success-from);
  animation: dotConverge 0.35s ease-in forwards;
}
.waveform-converge:nth-child(1) { --converge-offset: -12px; }
.waveform-converge:nth-child(2) { --converge-offset: -7px; }
.waveform-converge:nth-child(3) { --converge-offset: -3px; }
.waveform-converge:nth-child(4) { --converge-offset: 3px; }
.waveform-converge:nth-child(5) { --converge-offset: 7px; }
.waveform-converge:nth-child(6) { --converge-offset: 12px; }

@keyframes dotConverge {
  from { transform: translateX(var(--converge-offset)) scale(1); opacity: 1; }
  to   { transform: translateX(0) scale(0); opacity: 0; }
}

/* Success: mint medal */
.success-medal {
  position: absolute;
  left: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  color: var(--primary-foreground);
  background: linear-gradient(135deg, var(--notch-success-from), var(--notch-success-to));
  box-shadow: 0 2px 6px var(--notch-success-glow);
  animation: medalPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s both;
}
@keyframes medalPop {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: scale(1); }
}

/* ---- Success: green glow from notch edge ---- */
.notch-wrapper-success {
  filter:
    drop-shadow(var(--notch-drop-base))
    drop-shadow(0 0 10px var(--notch-success-glow))
    drop-shadow(0 0 25px var(--notch-success-glow-soft));
  animation: successGlow 0.8s ease-out forwards;
}

@keyframes successGlow {
  0% {
    filter:
      drop-shadow(var(--notch-drop-base))
      drop-shadow(0 0 12px var(--notch-success-glow))
      drop-shadow(0 0 30px var(--notch-success-glow-soft));
  }
  100% {
    filter:
      drop-shadow(var(--notch-drop-base))
      drop-shadow(0 0 2px transparent);
  }
}


/* ---- Learned: blue glow + text ---- */
.notch-wrapper-learned {
  filter:
    drop-shadow(var(--notch-drop-base))
    drop-shadow(0 0 10px var(--notch-learned-glow))
    drop-shadow(0 0 25px var(--notch-learned-glow-soft));
  animation: learnedGlow 2s ease-out forwards;
}

@keyframes learnedGlow {
  0% {
    filter:
      drop-shadow(var(--notch-drop-base))
      drop-shadow(0 0 12px var(--notch-learned-glow))
      drop-shadow(0 0 30px var(--notch-learned-glow-soft));
  }
  100% {
    filter:
      drop-shadow(var(--notch-drop-base))
      drop-shadow(0 0 2px transparent);
  }
}

.learned-icon-svg {
  /* 用主題變數而非硬編碼色：HUD 永遠是深色外殼，粉紫學徒色須維持可見。 */
  stroke: var(--notch-learned);
  animation: learnedIconFadeIn 0.3s ease-out;
}

@keyframes learnedIconFadeIn {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}

.learned-label {
  color: var(--notch-learned);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  animation: learnedTextFadeIn 0.3s ease-out;
}

.learned-terms-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px 6px;
  animation: learnedTextFadeIn 0.3s ease-out 0.2s both;
}

.learned-terms {
  color: var(--notch-learned);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes learnedTextFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Cancelled: X icon + label ---- */
.cancelled-icon-svg {
  stroke: var(--notch-fg-soft);
  animation: cancelledIconFadeIn 0.3s ease-out;
}

@keyframes cancelledIconFadeIn {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}

.cancelled-label {
  color: var(--notch-fg-soft);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  animation: cancelledTextFadeIn 0.3s ease-out;
}

@keyframes cancelledTextFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Error: scatter + shake ---- */
.waveform-scatter {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--notch-wave-6);
  animation: dotScatter 0.4s ease-out forwards;
}
.waveform-scatter:nth-child(1) { --scatter-offset: -6; }
.waveform-scatter:nth-child(2) { --scatter-offset: -3; }
.waveform-scatter:nth-child(3) { --scatter-offset: 0; }
.waveform-scatter:nth-child(4) { --scatter-offset: 3; }
.waveform-scatter:nth-child(5) { --scatter-offset: 6; }
.waveform-scatter:nth-child(6) { --scatter-offset: 9; }

@keyframes dotScatter {
  from {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateX(calc(var(--scatter-offset) * 1px)) scale(0.8);
    opacity: 0.7;
  }
}

.notch-shake {
  animation: notchShake 0.4s ease-out 0.1s;
}

@keyframes notchShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}


/* ---- Gap 7: Timer font ---- */
.elapsed-timer {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ---- Error: expanded notch with message ---- */
.notch-hud-expanded {
  flex-direction: column;
  justify-content: flex-start;
}

.notch-hud-expanded .notch-content {
  height: 42px;
  flex-shrink: 0;
}

.error-message-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px 6px;
  animation: errorMessageFadeIn 0.3s ease-out 0.2s both;
}

.error-message {
  color: var(--notch-error-fg);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes errorMessageFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Retry Icon ---- */
.retry-icon {
  cursor: pointer;
}

/* ---- Collapsing: 內容淡出 ---- */
.notch-collapsing .notch-content,
.notch-collapsing .error-message-row,
.notch-collapsing .learned-terms-row {
  opacity: 0;
  transition: opacity 0.15s ease;
}
</style>
