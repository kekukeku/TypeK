import { describe, expect, it } from "vitest";
import {
  getAutoLanguagePrompt,
  getMinimalPromptForLocale,
} from "../../src/i18n/prompts";
import { BUILTIN_PROMPTS_V0141 } from "../support/fixtures/builtin-prompts-v0.14.1";

// #83：辨識語言設為「自動」時整理不該翻譯。本檔守住「辨識語言明確設定的人什麼都沒變」。
describe("prompts — 輸出語言插槽（#83）", () => {
  describe("[AC3] 明確語言：除 2026-10 zh-TW 精簡改版外，與 v0.14.1 逐字相同", () => {
    for (const [locale, expected] of Object.entries(
      BUILTIN_PROMPTS_V0141.minimal,
    )) {
      it(`minimal × ${locale}`, () => {
        const actual = getMinimalPromptForLocale(
          locale as keyof typeof BUILTIN_PROMPTS_V0141.minimal,
        );
        if (locale === "zh-TW") {
          expect(actual).not.toBe(expected);
          expect(actual).toContain("修正語音辨識的同音錯字與誤聽");
          expect(actual).toContain("中文諧音若對應到英文技術名詞或產品名");
          return;
        }
        expect(actual).toBe(expected);
      });
    }
  });

  const count = (text: string, word: string) => text.split(word).length - 1;

  describe("[AC1] 自動＋英文介面：不再要求輸出英文", () => {
    it("en", () => {
      const prompt = getAutoLanguagePrompt("en");
      expect(prompt).not.toContain("Use English");
      expect(prompt).not.toContain("in English");
      expect(prompt).toMatch(/same language as the input|Keep the input language/);
    });
  });

  describe("[AC2] 自動＋中文介面：中文才統一繁簡，且只出現在條件句裡", () => {
    const cases = [
      { locale: "zh-TW", script: "繁體中文", condition: "若是中文，使用繁體中文" },
      { locale: "zh-CN", script: "简体中文", condition: "若是中文，使用简体中文" },
    ] as const;
    for (const { locale, script, condition } of cases) {
      it(locale, () => {
        const prompt = getAutoLanguagePrompt(locale);
        expect(count(prompt, script)).toBe(1);
        expect(prompt).toContain(condition);
      });
    }
  });

  describe("[AC5] 非中文介面沒有殘留的強制語言", () => {
    const languageNames = { en: "English", ja: "日本語", ko: "한국어" } as const;
    for (const [locale, name] of Object.entries(languageNames)) {
      it(`${locale} 不含「${name}」`, () => {
        expect(
          getAutoLanguagePrompt(locale as keyof typeof languageNames),
        ).not.toContain(name);
      });
    }
  });
});
