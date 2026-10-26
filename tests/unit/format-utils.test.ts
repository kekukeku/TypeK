import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatCostCeiling,
  splitNumberSegments,
} from "../../src/lib/formatUtils";
import type { TranscriptionRecord } from "../../src/types/transcription";

describe("formatUtils.ts", () => {
  describe("formatTimestamp", () => {
    it("應格式化有效的 timestamp", () => {
      const result = formatTimestamp(1700000000000);
      expect(result).toBeTruthy();
      expect(result).not.toBe("-");
    });

    it("NaN 應回傳 '-'", () => {
      expect(formatTimestamp(NaN)).toBe("-");
    });

    it("Infinity 應回傳 '-'", () => {
      expect(formatTimestamp(Infinity)).toBe("-");
    });

    it("-Infinity 應回傳 '-'", () => {
      expect(formatTimestamp(-Infinity)).toBe("-");
    });

    it("0 應回傳 '-'", () => {
      expect(formatTimestamp(0)).toBe("-");
    });

    it("負數應回傳 '-'", () => {
      expect(formatTimestamp(-1)).toBe("-");
    });
  });

  describe("truncateText", () => {
    it("短文字不應截斷", () => {
      expect(truncateText("短文字")).toBe("短文字");
    });

    it("超過 maxLength 應截斷並加省略號", () => {
      const longText = "a".repeat(60);
      const result = truncateText(longText, 50);
      expect(result).toBe("a".repeat(50) + "...");
    });

    it("空字串應回傳空字串", () => {
      expect(truncateText("")).toBe("");
    });

    it("自訂 maxLength 應正確運作", () => {
      expect(truncateText("12345678", 5)).toBe("12345...");
    });

    it("恰好等於 maxLength 不應截斷", () => {
      expect(truncateText("12345", 5)).toBe("12345");
    });

    it("泰文字素：ก้ 視為一個字素、不截斷", () => {
      expect(truncateText("ก้", 1)).toBe("ก้");
    });

    it("泰文字素：ก้ข 超過 1 個字素 → 保留完整字素再加省略號", () => {
      expect(truncateText("ก้ข", 1)).toBe("ก้...");
    });

    it("越南文 NFD 組合字以字素計算", () => {
      const nfd = "Tôi muốn uống cà phê".normalize("NFD");
      expect(truncateText(nfd, 5)).toBe("Tôi m...".normalize("NFD"));
    });

    it("emoji（含 ZWJ 家族）以字素計算", () => {
      expect(truncateText("👨‍👩‍👧‍👦abc", 1)).toBe("👨‍👩‍👧‍👦...");
    });
  });

  describe("getDisplayText", () => {
    it("有 processedText 時應回傳 processedText", () => {
      const record = {
        rawText: "原始",
        processedText: "處理後",
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("處理後");
    });

    it("processedText 為 null 時應回傳 rawText", () => {
      const record = {
        rawText: "原始",
        processedText: null,
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("原始");
    });
  });

  describe("formatDurationFromMs", () => {
    it("0 毫秒應回傳 '0 分鐘'", () => {
      expect(formatDurationFromMs(0)).toBe("0 分鐘");
    });

    it("30 秒應回傳 '0 分鐘'", () => {
      expect(formatDurationFromMs(30000)).toBe("1 分鐘");
    });

    it("5 分鐘應回傳 '5 分鐘'", () => {
      expect(formatDurationFromMs(300000)).toBe("5 分鐘");
    });

    it("90 分鐘應回傳 '1 小時 30 分鐘'", () => {
      expect(formatDurationFromMs(5400000)).toBe("1 小時 30 分鐘");
    });

    it("120 分鐘應回傳 '2 小時'", () => {
      expect(formatDurationFromMs(7200000)).toBe("2 小時");
    });
  });

  describe("formatDuration", () => {
    it("500ms 應回傳 '1 秒'", () => {
      expect(formatDuration(500)).toBe("1 秒");
    });

    it("5000ms 應回傳 '5 秒'", () => {
      expect(formatDuration(5000)).toBe("5 秒");
    });

    it("90000ms 應回傳 '1:30'", () => {
      expect(formatDuration(90000)).toBe("1:30");
    });

    it("65000ms 應回傳 '1:05'", () => {
      expect(formatDuration(65000)).toBe("1:05");
    });
  });

  describe("formatDurationMs", () => {
    it("500ms 應回傳 '500 ms'", () => {
      expect(formatDurationMs(500)).toBe("500 ms");
    });

    it("1500ms 應回傳 '1.5 秒'", () => {
      expect(formatDurationMs(1500)).toBe("1.5 秒");
    });

    it("0ms 應回傳 '0 ms'", () => {
      expect(formatDurationMs(0)).toBe("0 ms");
    });

    it("999ms 應回傳 '999 ms'", () => {
      expect(formatDurationMs(999)).toBe("999 ms");
    });
  });

  describe("formatNumber", () => {
    it("0 應格式化為 '0'", () => {
      expect(formatNumber(0)).toBe("0");
    });

    it("小數字不應加分隔符", () => {
      expect(formatNumber(999)).toBe("999");
    });

    it("千位以上應加分隔符", () => {
      const result = formatNumber(1234567);
      expect(result).toContain("1");
      expect(result).toContain("234");
      expect(result).toContain("567");
      expect(result.length).toBeGreaterThan(7);
    });
  });

  describe("splitNumberSegments", () => {
    const expectRoundTrip = (input: string) => {
      const segments = splitNumberSegments(input);
      expect(segments.map((segment) => segment.text).join("")).toBe(input);
      return segments;
    };

    it("應拆分「0 分鐘」", () => {
      expect(expectRoundTrip("0 分鐘")).toEqual([
        { text: "0", isNumber: true },
        { text: " 分鐘", isNumber: false },
      ]);
    });

    it("應拆分「1 小時 5 分鐘」的兩個數字", () => {
      expect(expectRoundTrip("1 小時 5 分鐘")).toEqual([
        { text: "1", isNumber: true },
        { text: " 小時 ", isNumber: false },
        { text: "5", isNumber: true },
        { text: " 分鐘", isNumber: false },
      ]);
    });

    it("應拆分英文 '2 h 30 min'", () => {
      expect(expectRoundTrip("2 h 30 min")).toEqual([
        { text: "2", isNumber: true },
        { text: " h ", isNumber: false },
        { text: "30", isNumber: true },
        { text: " min", isNumber: false },
      ]);
    });

    it("應保留千分位逗號於同一數字段", () => {
      expect(expectRoundTrip("1,234 words")).toEqual([
        { text: "1,234", isNumber: true },
        { text: " words", isNumber: false },
      ]);
    });

    it("空字串應回傳空陣列", () => {
      expect(expectRoundTrip("")).toEqual([]);
    });

    it("無數字字串應回傳單一非數字段", () => {
      expect(expectRoundTrip("no digits here")).toEqual([
        { text: "no digits here", isNumber: false },
      ]);
    });
  });

  describe("formatCostCeiling", () => {
    it("費用為 0 時應回傳 '$0'", () => {
      expect(formatCostCeiling(0)).toBe("$0");
    });

    it("正數費用應回傳帶 ≤ 前綴的四位小數", () => {
      expect(formatCostCeiling(0.0042)).toBe("≤ $0.0042");
    });

    it("極小費用應正確顯示四位小數", () => {
      expect(formatCostCeiling(0.000308)).toBe("≤ $0.0003");
    });

    it("較大費用應正確顯示", () => {
      expect(formatCostCeiling(1.5)).toBe("≤ $1.5000");
    });
  });
});
