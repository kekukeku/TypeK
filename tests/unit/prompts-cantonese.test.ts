import { describe, expect, it } from "vitest";
import { getMinimalPromptForLocale } from "../../src/i18n/prompts";

// gh-74：廣東話內建 prompt（不 mock，驗真實文案）
describe("prompts — 廣東話（yue）", () => {
  const cantoneseSentence =
    "輸入是廣東話口語，保留粵語用字與句式（我哋、嘅、唔、係、喺、咗、嘢、點解等），不要改寫成書面語或普通話說法";

  it("[P0] 精簡版：保留粵語用字，且不隨新版 zh-TW 文案變動", () => {
    const yuePrompt = getMinimalPromptForLocale("yue");
    expect(yuePrompt).not.toBe(getMinimalPromptForLocale("zh-TW"));
    expect(yuePrompt.endsWith(`繁體中文。${cantoneseSentence}。`)).toBe(true);
    expect(yuePrompt).toContain("逐段處理，每段獨立校對");
  });
});
