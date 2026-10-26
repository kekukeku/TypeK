import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  status: "up-to-date" | "update-available" | "error";
  version?: string;
  error?: string;
}

const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

let pendingUpdate: Update | null = null;

/**
 * 自動更新開關：建置時 `VITE_AUTO_UPDATE_ENABLED=true` 才啟用。
 * `tauri.conf.json` 的 pubkey 已填入 Kevin 產生的 minisign 公鑰（公開值，勿清空）；
 * 啟用與金鑰步驟見 docs/deployment-guide.md §5.4。
 */
function isAutoUpdateEnabled(): boolean {
  return import.meta.env.VITE_AUTO_UPDATE_ENABLED === "true";
}

/** 釋放目前暫存的 Update（含 Rust 端已下載資源），避免換版或失敗後殘留。 */
async function releasePendingUpdate(): Promise<void> {
  const update = pendingUpdate;
  pendingUpdate = null;
  if (!update) return;
  try {
    await update.close();
  } catch (err) {
    console.error("[autoUpdater] Failed to close pending update:", err);
  }
}

/** 放棄目前暫存的 Update；供使用者取消確認框時呼叫。 */
export async function discardPendingUpdate(): Promise<void> {
  await releasePendingUpdate();
}

/**
 * 檢查 App 更新（僅檢查，不下載）。找到更新時暫存 Update 物件供後續操作；
 * 新結果會釋放舊的 Update，失敗時也清空。
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isAutoUpdateEnabled()) {
    return { status: "error", error: "Auto-update is not enabled in TypeK yet" };
  }
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    await releasePendingUpdate();
    if (!update) {
      console.log("[autoUpdater] No update available");
      return { status: "up-to-date" };
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);
    pendingUpdate = update;
    return { status: "update-available", version: update.version };
  } catch (err) {
    await releasePendingUpdate();
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autoUpdater] Update check failed:", message);
    return { status: "error", error: message };
  }
}

/**
 * 靜默下載暫存的更新（不安裝、不重啟）。
 * 用於自動更新流程：背景下載完成後再通知使用者。
 */
export async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  try {
    await pendingUpdate.download(undefined, { timeout: DOWNLOAD_TIMEOUT_MS });
  } catch (err) {
    await releasePendingUpdate();
    throw err;
  }
  console.log("[autoUpdater] Download complete");
}

/**
 * 安裝已下載的更新並重啟 App。
 * 必須在 downloadUpdate() 完成後呼叫。
 *
 * Windows：`install()` 會啟動 NSIS 安裝器後直接結束 App，安裝器負責重開；
 * 這裡後面的 `request_app_restart` 不會執行（延續既有行為，勿改成 JS 重啟）。
 */
export async function installAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update.");
  }

  console.log("[autoUpdater] Installing update...");
  try {
    await pendingUpdate.install();
    await invoke("request_app_restart");
  } catch (err) {
    await releasePendingUpdate();
    throw err;
  }
}

/**
 * 一鍵下載、安裝並重啟（手動更新流程用）。
 * Windows 的 `install()` 同樣會結束 App，重開由安裝器處理。
 */
export async function downloadInstallAndRelaunch(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No pending update. Call checkForAppUpdate() first.");
  }

  console.log("[autoUpdater] Downloading update...");
  try {
    await pendingUpdate.download(undefined, { timeout: DOWNLOAD_TIMEOUT_MS });
    console.log("[autoUpdater] Download complete, installing...");
    await pendingUpdate.install();
    await invoke("request_app_restart");
  } catch (err) {
    await releasePendingUpdate();
    throw err;
  }
}
