import { ref, onUnmounted } from "vue";
import { useRafFn } from "@vueuse/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listenToEvent, AUDIO_WAVEFORM } from "./useTauriEvents";
import type { WaveformPayload } from "../types/audio";

const WAVEFORM_BAR_COUNT = 6;
const LERP_SPEED = 0.25;

function lerp(current: number, target: number, speed: number): number {
  return current + (target - current) * speed;
}

export function useAudioWaveform() {
  const waveformLevelList = ref<number[]>(
    new Array(WAVEFORM_BAR_COUNT).fill(0),
  );

  const targetLevelList = ref<number[]>(new Array(WAVEFORM_BAR_COUNT).fill(0));

  let unlistenWaveform: UnlistenFn | null = null;
  let listenRequestId = 0;
  let isWaveformActive = false;

  const { pause, resume } = useRafFn(
    () => {
      const nextLevelList = [...waveformLevelList.value];
      for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        const target = targetLevelList.value[i] ?? 0;
        nextLevelList[i] = lerp(nextLevelList[i], target, LERP_SPEED);
      }
      waveformLevelList.value = nextLevelList;
    },
    { immediate: false },
  );

  async function startWaveformAnimation(): Promise<void> {
    isWaveformActive = true;
    const currentRequestId = ++listenRequestId;

    if (!unlistenWaveform) {
      const nextUnlistenWaveform = await listenToEvent<WaveformPayload>(
        AUDIO_WAVEFORM,
        (event) => {
          if (!isWaveformActive) return;
          targetLevelList.value = [...event.payload.levels];
        },
      );

      if (!isWaveformActive || currentRequestId !== listenRequestId) {
        nextUnlistenWaveform();
        return;
      }

      unlistenWaveform = nextUnlistenWaveform;
    }

    resume();
  }

  function stopWaveformAnimation(): void {
    isWaveformActive = false;
    listenRequestId += 1;

    if (unlistenWaveform) {
      unlistenWaveform();
      unlistenWaveform = null;
    }

    targetLevelList.value = new Array(WAVEFORM_BAR_COUNT).fill(0);
    waveformLevelList.value = new Array(WAVEFORM_BAR_COUNT).fill(0);
    pause();
  }

  onUnmounted(() => {
    stopWaveformAnimation();
  });

  return {
    waveformLevelList,
    startWaveformAnimation,
    stopWaveformAnimation,
  };
}
