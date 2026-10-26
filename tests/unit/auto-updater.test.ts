import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheck = vi.fn();
const mockInvoke = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

describe("autoUpdater.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheck.mockReset();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // 以下測試驗證「啟用後」的更新流程；TypeK 預設關閉（見最後一個測試）
    vi.stubEnv("VITE_AUTO_UPDATE_ENABLED", "true");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("[P0] 未設定 VITE_AUTO_UPDATE_ENABLED 時不檢查更新、回傳 error", async () => {
    vi.stubEnv("VITE_AUTO_UPDATE_ENABLED", "");

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result.status).toBe("error");
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("[P0] 無更新時應回傳 up-to-date", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "up-to-date" });
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("[P0] 有更新時應回傳 update-available 且不觸發下載", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("[P0] check 失敗應回傳 error 結果且不拋錯", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "error", error: "Network error" });
    expect(console.error).toHaveBeenCalledWith(
      "[autoUpdater] Update check failed:",
      "Network error",
    );
  });

  it("[P0] downloadUpdate 應只下載不安裝", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn();
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
      close: vi.fn().mockResolvedValue(undefined),
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadUpdate();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("[P0] installAndRelaunch 應安裝並重啟", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
      close: vi.fn().mockResolvedValue(undefined),
    });

    const { checkForAppUpdate, downloadUpdate, installAndRelaunch } =
      await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await downloadUpdate();
    await installAndRelaunch();

    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] downloadInstallAndRelaunch 應一鍵完成", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
      close: vi.fn().mockResolvedValue(undefined),
    });

    const { checkForAppUpdate, downloadInstallAndRelaunch } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadInstallAndRelaunch();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith("request_app_restart");
  });

  it("[P0] 無暫存更新時 downloadUpdate 應拋錯", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("No pending update");
  });

  it("[P0] 下載失敗時 downloadUpdate 應拋錯並釋放 Update", async () => {
    const mockDownload = vi
      .fn()
      .mockRejectedValue(new Error("Download failed"));
    const mockClose = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
      close: mockClose,
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("Download failed");
    expect(mockClose).toHaveBeenCalledOnce();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("[P0] 以新 Update 取代暫存時應 close() 舊的 Update", async () => {
    const oldClose = vi.fn().mockResolvedValue(undefined);
    const newClose = vi.fn().mockResolvedValue(undefined);
    mockCheck
      .mockResolvedValueOnce({
        version: "1.2.0",
        download: vi.fn(),
        install: vi.fn(),
        close: oldClose,
      })
      .mockResolvedValueOnce({
        version: "1.3.0",
        download: vi.fn(),
        install: vi.fn(),
        close: newClose,
      });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await checkForAppUpdate();

    expect(oldClose).toHaveBeenCalledOnce();
    expect(newClose).not.toHaveBeenCalled();
  });

  it("[P0] check 失敗時應 close() 既有的 Update", async () => {
    const mockClose = vi.fn().mockResolvedValue(undefined);
    mockCheck
      .mockResolvedValueOnce({
        version: "1.2.0",
        download: vi.fn(),
        install: vi.fn(),
        close: mockClose,
      })
      .mockRejectedValueOnce(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    const result = await checkForAppUpdate();

    expect(result.status).toBe("error");
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("[P0] check 與 download 應帶逾時設定", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadUpdate();

    expect(mockCheck).toHaveBeenCalledWith({ timeout: 30_000 });
    expect(mockDownload).toHaveBeenCalledWith(undefined, {
      timeout: 300_000,
    });
  });

  it("[P0] discardPendingUpdate 應 close() 並清空暫存", async () => {
    const mockClose = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: vi.fn(),
      install: vi.fn(),
      close: mockClose,
    });

    const { checkForAppUpdate, discardPendingUpdate, downloadUpdate } =
      await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await discardPendingUpdate();

    expect(mockClose).toHaveBeenCalledOnce();
    await expect(downloadUpdate()).rejects.toThrow("No pending update");
  });
});
