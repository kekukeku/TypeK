import { invoke } from "@tauri-apps/api/core";
import type { HudStatus } from "../types";

export type UpdateInstallReason =
  | "ok"
  | "translocated"
  | "read_only_volume"
  | "unsupported_location"
  | "not_writable";

export interface UpdateInstallLocation {
  ok: boolean;
  reason: UpdateInstallReason;
  bundlePath: string;
}

export type UpdateUiState =
  | "idle"
  | "checking"
  | "confirming"
  | "downloading"
  | "ready-to-install"
  | "installing";

export const UPDATE_DOWNLOAD_URL =
  "https://github.com/kekukeku/TypeK/releases/latest";

/** 一次只跑一筆更新交易：非 idle 時 timer 觸發的自動檢查直接跳過。 */
export function canStartAutoCheck(state: UpdateUiState): boolean {
  return state === "idle";
}

/** 錄音／轉錄／收尾狀態都不算 idle，期間不可安裝。 */
export function isVoiceFlowBusy(status: HudStatus): boolean {
  return status !== "idle";
}

export function canStartInstall(
  state: UpdateUiState,
  voiceFlowStatus: HudStatus,
): boolean {
  const installable = state === "ready-to-install" || state === "confirming";
  return installable && !isVoiceFlowBusy(voiceFlowStatus);
}

/** 每次 App 執行只回傳 true 一次，用來抑制重複的自動更新失敗提示。 */
export function createAutoFailureGate(): () => boolean {
  let reported = false;
  return () => {
    if (reported) return false;
    reported = true;
    return true;
  };
}

export async function getUpdateInstallLocation(): Promise<UpdateInstallLocation> {
  return invoke<UpdateInstallLocation>("get_update_install_location");
}
