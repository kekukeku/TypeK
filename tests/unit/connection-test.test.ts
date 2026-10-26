import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../src/lib/enhancer", () => ({
  enhanceText: vi.fn(),
}));

import { testWhisperConnection } from "../../src/lib/connectionTest";

describe("connectionTest — 轉錄服務", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
  });

  it("[P0] groq 帶 modelId", async () => {
    const result = await testWhisperConnection(
      "groq",
      "gsk_test",
      "whisper-large-v3-turbo",
      "zh-TW",
      "zh-TW",
    );

    expect(result.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("test_whisper_connection", {
      apiKey: "gsk_test",
      provider: "groq",
      transcriptionLocale: "zh-TW",
      interfaceLocale: "zh-TW",
      modelId: "whisper-large-v3-turbo",
    });
  });

  it("[P0] apple 不帶 modelId、金鑰可為空", async () => {
    const result = await testWhisperConnection(
      "apple",
      "",
      "whisper-large-v3",
      "auto",
      "zh-TW",
    );

    expect(result.ok).toBe(true);
    const args = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    expect(args.provider).toBe("apple");
    expect(args.apiKey).toBe("");
    expect(args).not.toHaveProperty("modelId");
  });

  it("[P0] byteplus 不帶 modelId、帶金鑰", async () => {
    const result = await testWhisperConnection(
      "byteplus",
      "bp_key",
      undefined,
      "zh-TW",
      "zh-TW",
    );

    expect(result.ok).toBe(true);
    const args = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    expect(args.provider).toBe("byteplus");
    expect(args.apiKey).toBe("bp_key");
    expect(args).not.toHaveProperty("modelId");
  });

  it("[P1] Apple 授權錯誤轉成七語系文案", async () => {
    mockInvoke.mockRejectedValue("Apple speech error (not_authorized)");
    const result = await testWhisperConnection("apple", "", undefined, "en", "en");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("語音辨識權限");
    }
  });
});
