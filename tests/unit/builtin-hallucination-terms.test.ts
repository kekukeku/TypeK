import { describe, it, expect } from "vitest";
import {
  BUILTIN_HALLUCINATION_TERMS,
  getBuiltinTermListForLocale,
} from "../../src/lib/builtinHallucinationTerms";

describe("builtinHallucinationTerms.ts", () => {
  describe("BUILTIN_HALLUCINATION_TERMS 結構驗證", () => {
    it("[P0] 應包含 zh、en、ja、ko 四種語言", () => {
      expect(BUILTIN_HALLUCINATION_TERMS).toHaveProperty("zh");
      expect(BUILTIN_HALLUCINATION_TERMS).toHaveProperty("en");
      expect(BUILTIN_HALLUCINATION_TERMS).toHaveProperty("ja");
      expect(BUILTIN_HALLUCINATION_TERMS).toHaveProperty("ko");
    });

    it("[P0] 每種語言至少有 3 個詞", () => {
      expect(BUILTIN_HALLUCINATION_TERMS.zh.length).toBeGreaterThanOrEqual(3);
      expect(BUILTIN_HALLUCINATION_TERMS.en.length).toBeGreaterThanOrEqual(3);
      expect(BUILTIN_HALLUCINATION_TERMS.ja.length).toBeGreaterThanOrEqual(3);
      expect(BUILTIN_HALLUCINATION_TERMS.ko.length).toBeGreaterThanOrEqual(3);
    });

    it("[P0] zh 應包含常見中文幻覺詞", () => {
      expect(BUILTIN_HALLUCINATION_TERMS.zh).toContain("謝謝收看");
      expect(BUILTIN_HALLUCINATION_TERMS.zh).toContain("字幕組");
      expect(BUILTIN_HALLUCINATION_TERMS.zh).toContain("請訂閱");
    });

    it("[P0] en 應包含常見英文幻覺詞", () => {
      expect(BUILTIN_HALLUCINATION_TERMS.en).toContain(
        "Thank you for watching",
      );
      expect(BUILTIN_HALLUCINATION_TERMS.en).toContain("Subscribe");
    });
  });

  describe("getBuiltinTermListForLocale", () => {
    it("[P0] zh-TW → 回傳 zh 詞庫", () => {
      const termList = getBuiltinTermListForLocale("zh-TW");
      expect(termList).toEqual(BUILTIN_HALLUCINATION_TERMS.zh);
    });

    it("[P0] zh-CN → 回傳 zh 詞庫", () => {
      const termList = getBuiltinTermListForLocale("zh-CN");
      expect(termList).toEqual(BUILTIN_HALLUCINATION_TERMS.zh);
    });

    it("[P0] en → 回傳 en 詞庫", () => {
      const termList = getBuiltinTermListForLocale("en");
      expect(termList).toEqual(BUILTIN_HALLUCINATION_TERMS.en);
    });

    it("[P0] ja → 回傳 ja 詞庫", () => {
      const termList = getBuiltinTermListForLocale("ja");
      expect(termList).toEqual(BUILTIN_HALLUCINATION_TERMS.ja);
    });

    it("[P0] ko → 回傳 ko 詞庫", () => {
      const termList = getBuiltinTermListForLocale("ko");
      expect(termList).toEqual(BUILTIN_HALLUCINATION_TERMS.ko);
    });

    it("[P0] auto → 合併所有語言並去重", () => {
      const termList = getBuiltinTermListForLocale("auto");
      const allTermSet = new Set([
        ...BUILTIN_HALLUCINATION_TERMS.zh,
        ...BUILTIN_HALLUCINATION_TERMS.en,
        ...BUILTIN_HALLUCINATION_TERMS.ja,
        ...BUILTIN_HALLUCINATION_TERMS.ko,
      ]);

      expect(termList.length).toBe(allTermSet.size);
      // 確保包含所有語言的詞
      expect(termList).toContain("謝謝收看");
      expect(termList).toContain("Thank you for watching");
      expect(termList).toContain("ご視聴ありがとう");
      expect(termList).toContain("구독");
    });

    it("[P0] auto 回傳的清單不應有重複", () => {
      const termList = getBuiltinTermListForLocale("auto");
      const termSet = new Set(termList);
      expect(termList.length).toBe(termSet.size);
    });
  });
});
