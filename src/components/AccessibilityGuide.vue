<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Button } from "@/components/ui/button";

const PERMISSION_CHECK_INTERVAL_MS = 2000;

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDivElement | null>(null);
const primaryButtonRef = ref<InstanceType<typeof Button> | null>(null);
const isReinitializing = ref(false);
const reinitializeError = ref<string | null>(null);

let pollingTimer: ReturnType<typeof setInterval> | null = null;

function startPermissionPolling() {
  stopPermissionPolling();
  pollingTimer = setInterval(async () => {
    if (isReinitializing.value) return;
    try {
      const hasPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      if (hasPermission) {
        stopPermissionPolling();
        await handlePermissionGranted();
      }
    } catch (error) {
      console.error("[accessibility-guide] Permission check failed:", error);
    }
  }, PERMISSION_CHECK_INTERVAL_MS);
}

function stopPermissionPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function handlePermissionGranted() {
  isReinitializing.value = true;
  reinitializeError.value = null;
  try {
    await invoke("reinitialize_hotkey_listener");
    emit("close");
  } catch (error) {
    console.error("[accessibility-guide] Reinitialize failed:", error);
    reinitializeError.value = "快捷鍵重新初始化失敗，請重新啟動應用程式。";
  } finally {
    isReinitializing.value = false;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      reinitializeError.value = null;
      nextTick(() => {
        const el = primaryButtonRef.value?.$el as HTMLElement | undefined;
        el?.focus();
      });
      startPermissionPolling();
    } else {
      stopPermissionPolling();
    }
  },
);

onBeforeUnmount(() => {
  stopPermissionPolling();
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
    return;
  }

  if (event.key === "Tab" && dialogRef.value) {
    const focusableList =
      dialogRef.value.querySelectorAll<HTMLElement>("button");
    if (focusableList.length === 0) return;

    const firstElement = focusableList[0];
    const lastElement = focusableList[focusableList.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}

async function handleOpenAccessibilitySettings() {
  try {
    await invoke("open_accessibility_settings");
  } catch (error) {
    console.error("[accessibility-guide] Failed to open settings:", error);
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="dialogRef"
    role="dialog"
    aria-modal="true"
    aria-labelledby="accessibility-guide-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @keydown="handleKeydown"
  >
    <div class="mx-4 w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
      <h2
        id="accessibility-guide-title"
        class="text-xl font-semibold text-card-foreground"
      >
        需要輔助使用權限
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
        SayIt 需要「輔助使用」權限來監聽全域快捷鍵。若未授權，快捷鍵功能將無法使用。
      </p>
      <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>點擊下方按鈕開啟系統設定。</li>
        <li>在清單中找到 SayIt 並勾選。</li>
        <li>回到 App，系統將自動偵測並啟用。</li>
      </ol>

      <p v-if="isReinitializing" class="mt-3 text-sm text-primary">
        偵測到權限已授予，正在啟用快捷鍵...
      </p>
      <p v-if="reinitializeError" class="mt-3 text-sm text-destructive">
        {{ reinitializeError }}
      </p>

      <div class="mt-6 flex gap-3">
        <Button
          ref="primaryButtonRef"
          :disabled="isReinitializing"
          @click="handleOpenAccessibilitySettings"
        >
          開啟系統設定
        </Button>
        <Button
          variant="outline"
          :disabled="isReinitializing"
          @click="emit('close')"
        >
          稍後設定
        </Button>
      </div>
    </div>
  </div>
</template>
