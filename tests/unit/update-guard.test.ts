import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import {
  canStartAutoCheck,
  canStartInstall,
  createAutoFailureGate,
  getUpdateInstallLocation,
  isVoiceFlowBusy,
  UPDATE_DOWNLOAD_URL,
  type UpdateInstallReason,
  type UpdateUiState,
} from "../../src/lib/updateGuard";
import type { HudStatus } from "../../src/types";

describe("updateGuard.ts", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("[P0] 安裝位置契約：translocated／/Volumes／不支援位置／OK", async () => {
    const cases: Array<{ reason: UpdateInstallReason; ok: boolean }> = [
      { reason: "translocated", ok: false },
      { reason: "read_only_volume", ok: false },
      { reason: "unsupported_location", ok: false },
      { reason: "not_writable", ok: false },
      { reason: "ok", ok: true },
    ];

    for (const testCase of cases) {
      mockInvoke.mockResolvedValueOnce({
        ok: testCase.ok,
        reason: testCase.reason,
        bundlePath: "/Applications/TypeK.app",
      });

      await expect(getUpdateInstallLocation()).resolves.toEqual({
        ok: testCase.ok,
        reason: testCase.reason,
        bundlePath: "/Applications/TypeK.app",
      });
    }

    expect(mockInvoke).toHaveBeenCalledWith("get_update_install_location");
  });

  it("[P0] 錄音或轉錄中不可安裝，idle 才可安裝", () => {
    expect(canStartInstall("ready-to-install", "idle")).toBe(true);
    expect(canStartInstall("confirming", "idle")).toBe(true);

    const busyStatuses: HudStatus[] = [
      "recording",
      "transcribing",
      "enhancing",
      "success",
      "error",
      "cancelled",
    ];
    for (const status of busyStatuses) {
      expect(canStartInstall("ready-to-install", status)).toBe(false);
      expect(isVoiceFlowBusy(status)).toBe(true);
    }

    expect(canStartInstall("downloading", "idle")).toBe(false);
    expect(canStartInstall("installing", "idle")).toBe(false);
    expect(canStartInstall("checking", "idle")).toBe(false);
    expect(isVoiceFlowBusy("idle")).toBe(false);
  });

  it("[P0] 自動檢查在非 idle 狀態應跳過", () => {
    expect(canStartAutoCheck("idle")).toBe(true);

    const busyStates: UpdateUiState[] = [
      "checking",
      "confirming",
      "downloading",
      "ready-to-install",
      "installing",
    ];
    for (const state of busyStates) {
      expect(canStartAutoCheck(state)).toBe(false);
    }
  });

  it("[P0] 每次執行只顯示一次自動失敗", () => {
    const gate = createAutoFailureGate();

    expect(gate()).toBe(true);
    expect(gate()).toBe(false);
    expect(gate()).toBe(false);
  });

  it("[P1] 下載頁網址指向 GitHub Releases latest", () => {
    expect(UPDATE_DOWNLOAD_URL).toBe(
      "https://github.com/kekukeku/TypeK/releases/latest",
    );
  });
});
