<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  BookOpen,
  Download,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Settings,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeedbackMessage } from "./composables/useFeedbackMessage";
import {
  listenToEvent,
  VOCABULARY_CHANGED,
  VOICE_FLOW_STATE_CHANGED,
} from "./composables/useTauriEvents";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { captureError } from "./lib/sentry";
import { getDatabaseInitError } from "./lib/database";
import {
  canStartAutoCheck,
  canStartInstall,
  createAutoFailureGate,
  getUpdateInstallLocation,
  isVoiceFlowBusy,
  UPDATE_DOWNLOAD_URL,
  type UpdateUiState,
} from "./lib/updateGuard";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { HudStatus } from "./types";
import type { VoiceFlowStateChangedPayload } from "./types/events";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;
const { t } = useI18n();

const navItems = computed(() => [
  { path: "/dashboard", label: t("mainApp.nav.dashboard"), icon: markRaw(LayoutDashboard) },
  { path: "/history", label: t("mainApp.nav.history"), icon: markRaw(FileText) },
  { path: "/dictionary", label: t("mainApp.nav.dictionary"), icon: markRaw(BookOpen) },
  { path: "/settings", label: t("mainApp.nav.settings"), icon: markRaw(Settings) },
  { path: "/guide", label: t("mainApp.nav.guide"), icon: markRaw(Lightbulb) },
]);

const route = useRoute();
const currentPageTitle = computed(() => {
  const item = navItems.value.find((n) => route.path.startsWith(n.path));
  return item?.label ?? "TypeK";
});

// 必須在 app.mount() 後讀取 — setDatabaseInitError 在 bootstrap catch 中已設定
const databaseError = ref(getDatabaseInitError());
const showAccessibilityGuide = ref(false);
const isMacOS = navigator.userAgent.includes("Macintosh");

// ── 更新相關狀態 ──
const updateState = ref<UpdateUiState>("idle");
const availableVersion = ref("");
const updateFeedback = useFeedbackMessage();
const reportAutoFailureOnce = createAutoFailureGate();
// 自動檢查／下載失敗：每次執行只出現一次，但不自動消失，留到使用者關掉或下一次檢查成功
const showAutoUpdateFailure = ref(false);
const voiceFlowStatus = ref<HudStatus>("idle");
const isInstallBlocked = computed(() => isVoiceFlowBusy(voiceFlowStatus.value));
const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
const AUTO_CHECK_INTERVAL_MS = 15 * 60_000; // 15 分鐘
let autoCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
let autoCheckIntervalId: ReturnType<typeof setInterval> | null = null;

// AlertDialog 控制
const showManualUpdateDialog = ref(false);
const showAutoInstallDialog = ref(false);
const showInstallLocationDialog = ref(false);
let autoInstallPromptPending = false;

// 任一個全域對話框開著時，不要再疊「更新已就緒」（會蓋住、按不到）
const hasGlobalDialogOpen = computed(
  () =>
    showUpgradeNoticeDialog.value ||
    showAccessibilityGuide.value ||
    showManualUpdateDialog.value ||
    showAutoInstallDialog.value ||
    showInstallLocationDialog.value,
);

// 升級提示（watch 而非 onMounted，因為 loadSettings 在 mount 之後才執行）
const settingsStore = useSettingsStore();
const showUpgradeNoticeDialog = ref(false);
const upgradeNoticeItemCount = 1;
watch(() => settingsStore.showPromptUpgradeNotice, (shouldShow) => {
  if (shouldShow) {
    showUpgradeNoticeDialog.value = true;
    settingsStore.showPromptUpgradeNotice = false;
  }
});

async function openDownloadPage() {
  try {
    await openExternalUrl(UPDATE_DOWNLOAD_URL);
  } catch (err) {
    console.error("[main-window] Failed to open update download page:", err);
    captureError(err, { source: "updater", step: "open-download-page" });
  }
}

/** 下載前確認 App 是否位在可原地更新的位置；不 ok 時顯示修復說明。 */
async function ensureUpdateInstallLocation(): Promise<boolean> {
  try {
    const location = await getUpdateInstallLocation();
    if (location.ok && location.reason === "ok") return true;
    console.warn(
      `[main-window] Update blocked at ${location.bundlePath}: ${location.reason}`,
    );
    showInstallLocationDialog.value = true;
    return false;
  } catch (err) {
    console.error("[main-window] Failed to check update install location:", err);
    captureError(err, { source: "updater", step: "install-location" });
    showInstallLocationDialog.value = true;
    return false;
  }
}

async function discardStagedUpdate() {
  const { discardPendingUpdate } = await import("./lib/autoUpdater");
  await discardPendingUpdate();
}

function closeInstallLocationDialog() {
  showInstallLocationDialog.value = false;
}

async function openDownloadPageFromDialog() {
  showInstallLocationDialog.value = false;
  await openDownloadPage();
}

/** 顯示自動下載完成的安裝對話框（必要時先把 Dashboard 叫到前景）。 */
async function promptAutoInstall() {
  // gh-76：使用者開了「啟動時隱藏主視窗」就不主動跳出來，對話框留在視窗內、開啟時再看
  if (!settingsStore.isStartHiddenEnabled) {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.show();
      await currentWindow.setFocus();
    } catch (err) {
      console.error("[main-window] Failed to focus window for update:", err);
      captureError(err, { source: "updater", step: "show-window" });
    }
  }
  showAutoInstallDialog.value = true;
}

// 錄音／轉錄結束或既有對話框關閉後，補跳自動流程的安裝對話框。
watch([voiceFlowStatus, hasGlobalDialogOpen], ([status]) => {
  if (status !== "idle" || !autoInstallPromptPending) return;
  if (updateState.value !== "ready-to-install") return;
  if (hasGlobalDialogOpen.value) return;
  autoInstallPromptPending = false;
  void promptAutoInstall();
});

// ── 流程 1：自動偵測（靜默檢查 → 靜默下載 → 通知安裝） ──
async function autoCheckAndDownload() {
  if (!canStartAutoCheck(updateState.value)) return;

  updateState.value = "checking";
  try {
    const { checkForAppUpdate, downloadUpdate, discardPendingUpdate } =
      await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status === "error") {
      updateState.value = "idle";
      availableVersion.value = "";
      if (reportAutoFailureOnce()) {
        showAutoUpdateFailure.value = true;
      }
      return;
    }

    showAutoUpdateFailure.value = false;

    if (result.status !== "update-available" || !result.version) {
      updateState.value = "idle";
      return;
    }

    availableVersion.value = result.version;

    if (!(await ensureUpdateInstallLocation())) {
      await discardPendingUpdate();
      availableVersion.value = "";
      updateState.value = "idle";
      return;
    }

    updateState.value = "downloading";
    await downloadUpdate();
    updateState.value = "ready-to-install";

    if (isInstallBlocked.value || hasGlobalDialogOpen.value) {
      autoInstallPromptPending = true;
      return;
    }

    await promptAutoInstall();
  } catch (err) {
    console.error("[main-window] Auto update check/download failed:", err);
    captureError(err, { source: "updater", step: "auto-check" });
    updateState.value = "idle";
    availableVersion.value = "";
    if (reportAutoFailureOnce()) {
      showAutoUpdateFailure.value = true;
    }
  }
}

// 使用者在自動流程的 AlertDialog 中點「安裝並重啟」
async function handleAutoInstall() {
  if (!canStartInstall(updateState.value, voiceFlowStatus.value)) return;

  showAutoInstallDialog.value = false;
  updateState.value = "installing";
  try {
    const { installAndRelaunch } = await import("./lib/autoUpdater");
    await installAndRelaunch();
  } catch (err) {
    console.error("[main-window] Auto install failed:", err);
    captureError(err, { source: "updater", step: "auto-install" });
    updateFeedback.show("error", t("mainApp.update.installFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 使用者在自動流程的 AlertDialog 中點「稍後」
function handleAutoInstallLater() {
  showAutoInstallDialog.value = false;
  autoInstallPromptPending = false;
  // 保持 ready-to-install 狀態，sidebar 仍顯示「立即安裝」按鈕
}

// sidebar footer 的「立即安裝」按鈕（自動下載完成後顯示）
function handleSidebarInstall() {
  showAutoInstallDialog.value = true;
}

// ── 流程 2：手動檢查更新 ──
async function handleManualCheck() {
  // 更新摘要開著時先關掉，避免跟手動更新對話框疊在一起
  showUpgradeNoticeDialog.value = false;
  if (updateState.value === "ready-to-install") {
    showAutoInstallDialog.value = true;
    return;
  }
  if (updateState.value !== "idle") return;

  updateState.value = "checking";
  try {
    const { checkForAppUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status === "up-to-date") {
      showAutoUpdateFailure.value = false;
      updateFeedback.show("success", t("mainApp.update.upToDate"));
      updateState.value = "idle";
    } else if (result.status === "update-available") {
      showAutoUpdateFailure.value = false;
      availableVersion.value = result.version ?? "";
      updateState.value = "confirming";
      showManualUpdateDialog.value = true;
    } else {
      updateFeedback.show("error", t("mainApp.update.checkFailed"));
      updateState.value = "idle";
    }
  } catch (err) {
    console.error("[main-window] Manual update check failed:", err);
    captureError(err, { source: "updater", step: "manual-check" });
    updateFeedback.show("error", t("mainApp.update.checkError"));
    updateState.value = "idle";
  }
}

// 使用者在手動流程的 AlertDialog 中點「開始更新」
async function handleManualUpdate() {
  if (!canStartInstall(updateState.value, voiceFlowStatus.value)) return;
  // 任何 await 之前先鎖住交易，避免連點兩次對同一個 Update 安裝兩次
  updateState.value = "downloading";
  // 每個 await 之後確認交易還是這一筆（使用者可能已取消）
  const isStillThisTransaction = () =>
    updateState.value === "downloading" && showManualUpdateDialog.value;

  try {
    const { downloadInstallAndRelaunch, discardPendingUpdate } =
      await import("./lib/autoUpdater");
    if (!isStillThisTransaction()) return;

    const isLocationOk = await ensureUpdateInstallLocation();
    if (!isStillThisTransaction()) return;

    if (!isLocationOk) {
      showManualUpdateDialog.value = false;
      availableVersion.value = "";
      await discardPendingUpdate();
      updateState.value = "idle";
      return;
    }

    // 等待期間開始錄音的話，留在確認框，不下載不安裝
    if (isVoiceFlowBusy(voiceFlowStatus.value)) {
      updateState.value = "confirming";
      return;
    }

    showManualUpdateDialog.value = false;
    await downloadInstallAndRelaunch();
  } catch (err) {
    console.error("[main-window] Manual update failed:", err);
    captureError(err, { source: "updater", step: "manual-update" });
    updateFeedback.show("error", t("mainApp.update.updateFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 手動確認框取消：放棄暫存的 Update，回到 idle。
async function handleManualUpdateCancel() {
  showManualUpdateDialog.value = false;
  availableVersion.value = "";
  try {
    await discardStagedUpdate();
  } catch (err) {
    console.error("[main-window] Failed to discard pending update:", err);
  }
  // 舊 Update 釋放後才回 idle，避免計時器在 close() 期間開始新一輪檢查
  updateState.value = "idle";
}

// ── Sidebar footer 顯示邏輯 ──
const updateButtonLabel = computed(() => {
  switch (updateState.value) {
    case "checking": return t("mainApp.update.checking");
    case "downloading": return t("mainApp.update.downloading");
    case "installing": return t("mainApp.update.installing");
    default: return t("mainApp.update.checkUpdate");
  }
});

const isUpdateBusy = computed(() =>
  updateState.value === "checking" ||
  updateState.value === "confirming" ||
  updateState.value === "downloading" ||
  updateState.value === "installing"
);


const vocabularyStore = useVocabularyStore();
let unlistenVocabularyChanged: UnlistenFn | null = null;
let unlistenVoiceFlowStateChanged: UnlistenFn | null = null;

onMounted(async () => {
  // 監聽詞彙變更（HUD 視窗 AI 新增詞彙時同步 Dashboard）
  unlistenVocabularyChanged = await listenToEvent(VOCABULARY_CHANGED, () => {
    console.log("[main-window] VOCABULARY_CHANGED received, refreshing termList");
    void vocabularyStore.fetchTermList();
  });

  // 錄音／轉錄期間不可安裝更新
  unlistenVoiceFlowStateChanged = await listenToEvent<VoiceFlowStateChangedPayload>(
    VOICE_FLOW_STATE_CHANGED,
    (event) => {
      voiceFlowStatus.value = event.payload.status;
    },
  );

  // macOS 無障礙權限檢查
  if (isMacOS) {
    try {
      const hasAccessibilityPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      showAccessibilityGuide.value = !hasAccessibilityPermission;
    } catch (error) {
      console.error(
        "[main-window] Failed to check accessibility permission:",
        error,
      );
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }

  // 自動檢查更新：啟動 5 秒後首次檢查，之後每 15 分鐘重查
  autoCheckTimeoutId = setTimeout(() => {
    autoCheckAndDownload();
    autoCheckIntervalId = setInterval(autoCheckAndDownload, AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_INITIAL_DELAY_MS);
});

onUnmounted(() => {
  unlistenVocabularyChanged?.();
  unlistenVoiceFlowStateChanged?.();
  if (autoCheckTimeoutId) clearTimeout(autoCheckTimeoutId);
  if (autoCheckIntervalId) clearInterval(autoCheckIntervalId);
});
</script>

<template>
  <!-- macOS Overlay 自訂標題列：fixed z-20 蓋住 Sidebar(z-10)，整條可拖動 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md"
  >
    <span data-tauri-drag-region class="text-xs font-bold tracking-wide text-foreground select-none">TypeK</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9">
    <Sidebar collapsible="offcanvas" class="border-r border-sidebar-border">
      <SidebarHeader class="flex-row h-14 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="@/assets/logo.png" alt="TypeK" class="h-8 w-8 shrink-0" />

        <span class="text-base font-extrabold text-sidebar-foreground tracking-wide">TypeK</span>
      </SidebarHeader>
      <SidebarContent class="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                  :class="[
                    'rounded-full transition-all duration-200 hover:translate-x-1',
                    route.path.startsWith(item.path)
                      ? 'border border-border shadow-sm font-bold data-[active=true]:bg-gradient-to-r data-[active=true]:from-card data-[active=true]:to-accent data-[active=true]:text-primary data-[active=true]:[&>svg]:text-primary'
                      : '',
                  ]"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-3 py-2">
        <div class="flex items-center justify-between rounded-full border border-sidebar-border bg-card/60 px-3 py-1">
          <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
          <!-- ready-to-install 時不顯示檢查按鈕，改顯示安裝提示 -->
          <Button
            v-if="updateState !== 'ready-to-install'"
            variant="link"
            class="h-auto rounded-full p-0 text-xs text-muted-foreground"
            :disabled="isUpdateBusy"
            @click="handleManualCheck"
          >
            {{ updateButtonLabel }}
          </Button>
        </div>
        <!-- 自動下載完成：顯示持久的安裝提示 -->
        <div v-if="updateState === 'ready-to-install'" class="mt-1.5 flex items-center justify-between rounded-full border border-primary/20 bg-primary/15 px-3 py-1">
          <span class="text-xs font-medium text-primary">v{{ availableVersion }} {{ $t("mainApp.update.ready") }}</span>
          <Button
            size="sm"
            class="h-6 gap-1 rounded-full px-2 text-xs"
            @click="handleSidebarInstall"
          >
            <Download class="h-3 w-3" />
            {{ $t("mainApp.update.installNow") }}
          </Button>
        </div>
        <div
          v-if="showAutoUpdateFailure"
          class="mt-1 flex flex-wrap items-center gap-1 text-xs"
        >
          <span class="text-destructive">{{ $t("mainApp.update.updateFailed") }}</span>
          <Button
            variant="link"
            class="h-auto p-0 text-xs text-primary"
            @click="openDownloadPage"
          >
            {{ $t("mainApp.update.openDownloadPage") }}
          </Button>
          <Button
            variant="link"
            class="h-auto p-0 text-xs text-muted-foreground"
            @click="showAutoUpdateFailure = false"
          >
            {{ $t("mainApp.update.dismissFailure") }}
          </Button>
        </div>
        <div
          v-if="updateFeedback.message.value"
          class="mt-1 flex items-center gap-1 text-xs"
        >
          <span :class="updateFeedback.type.value === 'success' ? 'text-primary' : 'text-destructive'">
            {{ updateFeedback.message.value }}
          </span>
          <Button
            v-if="updateFeedback.type.value === 'error'"
            variant="link"
            class="h-auto p-0 text-xs text-primary"
            @click="openDownloadPage"
          >
            {{ $t("mainApp.update.openDownloadPage") }}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="dreamy-aura-bg overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div
        v-if="databaseError"
        class="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p class="font-medium">{{ $t("errors.databaseInitFailed") }}</p>
        <p class="mt-1 text-xs text-destructive/80">{{ databaseError }}</p>
      </div>
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />

  <!-- 自動流程 AlertDialog：更新已下載，詢問是否安裝重啟 -->
  <AlertDialog :open="showAutoInstallDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.autoInstallTitle") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <p>{{ $t("mainApp.update.autoInstallDescription", { version: availableVersion }) }}</p>
          <p v-if="isMacOS" class="mt-2 text-xs text-muted-foreground">
            {{ $t("mainApp.update.macPermissionHint") }}
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <span v-if="isInstallBlocked" class="mr-auto text-xs text-muted-foreground">
          {{ $t("mainApp.update.installBlockedByVoiceFlow") }}
        </span>
        <AlertDialogCancel @click="handleAutoInstallLater">{{ $t("mainApp.update.later") }}</AlertDialogCancel>
        <AlertDialogAction :disabled="isInstallBlocked" @click="handleAutoInstall">{{ $t("mainApp.update.installRestart") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 安裝位置不符 AlertDialog -->
  <AlertDialog :open="showInstallLocationDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.installLocationTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.installLocationDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="closeInstallLocationDialog">{{ $t("mainApp.update.cancel") }}</AlertDialogCancel>
        <AlertDialogAction @click="openDownloadPageFromDialog">{{ $t("mainApp.update.openDownloadPage") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 升級提示 AlertDialog -->
  <AlertDialog :open="showUpgradeNoticeDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.upgradeNotice.title") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <ol class="mt-2 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
            <li v-for="i in upgradeNoticeItemCount" :key="i">
              {{ $t(`mainApp.upgradeNotice.item${i}`) }}
            </li>
          </ol>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="showUpgradeNoticeDialog = false">{{ $t("mainApp.upgradeNotice.dismiss") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 手動流程 AlertDialog：發現新版本，詢問是否開始更新 -->
  <AlertDialog :open="showManualUpdateDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.newVersionTitle") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <p>{{ $t("mainApp.update.newVersionDescription", { version: availableVersion }) }}</p>
          <p v-if="isMacOS" class="mt-2 text-xs text-muted-foreground">
            {{ $t("mainApp.update.macPermissionHint") }}
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <span v-if="isInstallBlocked" class="mr-auto text-xs text-muted-foreground">
          {{ $t("mainApp.update.installBlockedByVoiceFlow") }}
        </span>
        <AlertDialogCancel @click="handleManualUpdateCancel">{{ $t("mainApp.update.cancel") }}</AlertDialogCancel>
        <AlertDialogAction :disabled="isInstallBlocked" @click="handleManualUpdate">{{ $t("mainApp.update.startUpdate") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
