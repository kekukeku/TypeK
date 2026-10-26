import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConvert = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/simplifiedToTraditional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/simplifiedToTraditional")>()),
  convertSimplifiedToTraditional: mockConvert,
}));

import { applyTranscriptTextTransforms } from "../../src/lib/transcriptTextTransforms";

describe("applyTranscriptTextTransforms", () => {
  beforeEach(() => {
    mockConvert.mockReset().mockImplementation((t: string) => `[繁]${t}`);
  });

  it("[P1] zh-TW → 委派 convertSimplifiedToTraditional", () => {
    const result = applyTranscriptTextTransforms("简体", "zh-TW");
    expect(mockConvert).toHaveBeenCalledWith("简体");
    expect(result).toBe("[繁]简体");
  });

  it("[P1] zh-TW → 「台」寫作「臺」，字典裡含「台」的詞照原寫法", () => {
    mockConvert.mockImplementation((t: string) => t);
    const result = applyTranscriptTextTransforms(
      "我在台北的台灣中油加油，平台很好用",
      "zh-TW",
      { preservedTerms: ["台灣中油", "TypeK"] },
    );
    expect(result).toBe("我在臺北的台灣中油加油，平臺很好用");
  });

  it("[P1] convertScript: false → 不簡轉繁，但仍把「台」寫作「臺」", () => {
    const result = applyTranscriptTextTransforms("台灣的软件", "zh-TW", {
      convertScript: false,
    });
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("臺灣的软件");
  });

  it("[P1] zh-CN／ja 不改「台」", () => {
    expect(applyTranscriptTextTransforms("台湾", "zh-CN")).toBe("台湾");
    expect(applyTranscriptTextTransforms("台湾", "ja")).toBe("台湾");
  });

  it("[P1] yue 不再簡轉繁（選項已移除）→ 原樣返回、不呼叫轉換", () => {
    const result = applyTranscriptTextTransforms("我们", "yue");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("我们");
  });

  it("[P1] 非 zh-TW（en）→ 原樣返回、不呼叫轉換", () => {
    const result = applyTranscriptTextTransforms("hello", "en");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("hello");
  });

  it("[P1] 非 zh-TW（zh-CN）→ 原樣返回、不轉換", () => {
    const result = applyTranscriptTextTransforms("简体内容", "zh-CN");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("简体内容");
  });

  it("[P2] 空字串 → 直接返回、不呼叫轉換", () => {
    const result = applyTranscriptTextTransforms("", "zh-TW");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("");
  });
});
