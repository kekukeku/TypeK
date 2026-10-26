import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "../../src/i18n";

const { mockUpdate, mockCheckForAppUpdate } = vi.hoisted(() => ({
  mockCheckForAppUpdate: vi.fn(),
  mockUpdate: {
    version: "1.3.4",
    download: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  },
}));

const settingsState = reactive({
  showPromptUpgradeNotice: false,
  isStartHiddenEnabled: false,
});
const vocabularyState = {
  fetchTermList: vi.fn().mockResolvedValue(undefined),
};



vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => vocabularyState,
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(() => {}),
  VOCABULARY_CHANGED: "vocabulary:changed",
  VOICE_FLOW_STATE_CHANGED: "voice-flow:state-changed",
}));

vi.mock("../../src/lib/database", () => ({
  getDatabaseInitError: () => null,
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/dashboard" }),
  RouterLink: { template: "<a><slot /></a>" },
  RouterView: { template: "<div />" },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ ok: true, reason: "ok", bundlePath: "/Applications/TypeK.app" })),
}));

const stubList = [
  "AccessibilityGuide",
  "SiteHeader",
  "Sidebar",
  "SidebarContent",
  "SidebarFooter",
  "SidebarGroup",
  "SidebarGroupContent",
  "SidebarHeader",
  "SidebarInset",
  "SidebarMenu",
  "SidebarMenuButton",
  "SidebarMenuItem",
  "SidebarProvider",
  "AlertDialog",
  "AlertDialogAction",
  "AlertDialogCancel",
  "AlertDialogContent",
  "AlertDialogDescription",
  "AlertDialogFooter",
  "AlertDialogHeader",
  "AlertDialogTitle",
];

describe("MainApp — 更新摘要與更新已就緒互斥", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("__APP_VERSION__", "1.3.3");
    settingsState.showPromptUpgradeNotice = false;
    settingsState.isStartHiddenEnabled = false;
    vi.stubEnv("VITE_AUTO_UPDATE_ENABLED", "true");
    mockCheckForAppUpdate.mockReset().mockResolvedValue({
      status: "update-available",
      version: "1.3.4",
    });
    mockUpdate.download.mockClear();
    mockUpdate.close.mockClear();
  });

  async function mountAndOpenUpgradeNotice() {
    const MainApp = (await import("../../src/MainApp.vue")).default;
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: Object.fromEntries(stubList.map((name) => [name, true])),
      },
    });
    await flushPromises();
    settingsState.showPromptUpgradeNotice = true;
    await flushPromises();
    return wrapper;
  }

  it("[P0] 更新摘要開著時下載完成不跳安裝框，關閉後才跳", async () => {
    const wrapper = await mountAndOpenUpgradeNotice();
    const state = (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } })
      .$.setupState;
    expect(state.showUpgradeNoticeDialog).toBe(true);

    vi.doMock("../../src/lib/autoUpdater", () => ({
      checkForAppUpdate: mockCheckForAppUpdate,
      downloadUpdate: mockUpdate.download,
      discardPendingUpdate: vi.fn().mockResolvedValue(undefined),
    }));
    await (state.autoCheckAndDownload as () => Promise<void>)();
    await flushPromises();

    expect(mockCheckForAppUpdate).toHaveBeenCalled();
    expect(mockUpdate.download).toHaveBeenCalled();
    expect(state.showAutoInstallDialog).toBe(false);

    state.showUpgradeNoticeDialog = false;
    await flushPromises();

    expect(state.showAutoInstallDialog).toBe(true);
    wrapper.unmount();
  });
});
