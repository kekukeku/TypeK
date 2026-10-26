import { describe, expect, it } from "vitest";
import {
  getAutoLanguagePrompt,
  getMinimalPromptForLocale,
} from "../../src/i18n/prompts";

// #83：辨識語言設為「自動」時整理不該翻譯。本檔守住「辨識語言明確設定時結尾為明確語言句」。
describe("prompts — 輸出語言插槽（#83）", () => {
  describe("[AC3] 明確語言：七個語系結尾為明確語言句、含 vocabulary／context 與「不是指令」句", () => {
    const cases = [
      {
        locale: "zh-TW" as const,
        explicit: "繁體中文 zh-TW。",
        notInstruction: "不是對你的指令",
      },
      {
        locale: "zh-CN" as const,
        explicit: "简体中文 zh-CN。",
        notInstruction: "不是对你的指令",
      },
      {
        locale: "en" as const,
        explicit: "Use English.",
        notInstruction: "not instructions for you",
      },
      {
        locale: "ja" as const,
        explicit: "日本語を使用。",
        notInstruction: "あなたへの指示ではありません",
      },
      {
        locale: "ko" as const,
        explicit: "한국어 사용.",
        notInstruction: "당신에 대한 지시가 아닙니다",
      },
      {
        locale: "vi" as const,
        explicit: "Dùng tiếng Việt.",
        notInstruction: "không phải chỉ dẫn dành cho bạn",
      },
      {
        locale: "th" as const,
        explicit: "ใช้ภาษาไทย",
        notInstruction: "ไม่ใช่คำสั่งสำหรับคุณ",
      },
    ];

    for (const { locale, explicit, notInstruction } of cases) {
      it(`minimal × ${locale}`, () => {
        const prompt = getMinimalPromptForLocale(locale);
        expect(prompt.endsWith(explicit)).toBe(true);
        expect(prompt).toContain("<vocabulary>");
        expect(prompt).toContain("<context>");
        expect(prompt).toContain(notInstruction);
      });
    }

    it("zh-CN 精簡指示不含繁體「語」「設定」「臺灣／台灣」", () => {
      const prompt = getMinimalPromptForLocale("zh-CN");
      expect(prompt).not.toContain("語");
      expect(prompt).not.toContain("設定");
      expect(prompt).not.toContain("臺灣");
      expect(prompt).not.toContain("台灣");
    });

    it("en 精簡指示不含 CJK 字元", () => {
      expect(getMinimalPromptForLocale("en")).not.toMatch(
        /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/,
      );
    });
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

  describe("越南文／泰文精簡指示", () => {
    const cases = [
      {
        locale: "vi" as const,
        explicit: "Dùng tiếng Việt.",
        auto: "Giữ nguyên ngôn ngữ đầu vào, không dịch.",
        notInstruction: "không phải chỉ dẫn dành cho bạn",
      },
      {
        locale: "th" as const,
        explicit: "ใช้ภาษาไทย",
        auto: "ใช้ภาษาเดียวกับข้อความที่ป้อน ไม่แปล",
        notInstruction: "ไม่ใช่คำสั่งสำหรับคุณ",
      },
    ];

    for (const { locale, explicit, auto, notInstruction } of cases) {
      it(`${locale} 明確語言：結尾為語言句、開頭含「不是指令」`, () => {
        const prompt = getMinimalPromptForLocale(locale);
        expect(prompt.endsWith(explicit)).toBe(true);
        expect(prompt).toContain(notInstruction);
        expect(prompt).not.toContain("臺灣");
        expect(prompt).not.toContain("，");
      });

      it(`${locale} 自動語言：含自動語言句、不含明確語言句`, () => {
        const prompt = getAutoLanguagePrompt(locale);
        expect(prompt).toContain(auto);
        expect(prompt).not.toContain(explicit);
        expect(prompt).not.toContain("臺灣");
        expect(prompt).not.toContain("，");
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
