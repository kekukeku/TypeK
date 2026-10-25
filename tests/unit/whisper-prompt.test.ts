import { describe, expect, it } from "vitest";
import {
  buildWhisperPrompt,
  WHISPER_PROMPT_TERM_CHAR_BUDGET,
} from "../../src/lib/whisperPrompt";

const ZH_TW_BASE =
  "以下是台灣繁體中文的語音逐字稿，口語中英夾雜，英文專有名詞維持原文拼寫。";
const ZH_CN_BASE =
  "以下是简体中文的语音逐字稿，口语中英夹杂，英文专有名词保持原文拼写。";

describe("buildWhisperPrompt", () => {
  it("[P0] 空字典時 zh-TW 仍回傳基本前置句", () => {
    expect(buildWhisperPrompt([], "zh-TW")).toBe(ZH_TW_BASE);
  });

  it("[P0] 空字典時 zh-CN 仍回傳基本前置句", () => {
    expect(buildWhisperPrompt([], "zh-CN")).toBe(ZH_CN_BASE);
  });

  it("[P0] 其他語系回傳 null", () => {
    expect(buildWhisperPrompt(["TypeK"], "en")).toBeNull();
    expect(buildWhisperPrompt(["TypeK"], "ja")).toBeNull();
    expect(buildWhisperPrompt([], "auto")).toBeNull();
  });

  it("[P0] zh-TW 有詞時接上剛才提到，最高優先詞落在尾端", () => {
    expect(buildWhisperPrompt(["TypeK", "Tauri", "Vue"], "zh-TW")).toBe(
      `${ZH_TW_BASE}剛才提到Vue、Tauri、TypeK。`,
    );
  });

  it("[P0] zh-CN 有詞時使用簡體前置句", () => {
    expect(buildWhisperPrompt(["TypeK", "Tauri"], "zh-CN")).toBe(
      `${ZH_CN_BASE}刚才提到Tauri、TypeK。`,
    );
  });

  it("[P0] 超過長度上限時截斷，且保留最高優先詞", () => {
    const longFirstTerm = "A".repeat(50);
    const termList = [longFirstTerm, "B".repeat(30)];

    const result = buildWhisperPrompt(termList, "zh-TW");

    expect(result).toBe(`${ZH_TW_BASE}剛才提到${longFirstTerm}。`);
    expect(result).not.toContain("B");
  });

  it("[P0] 詞與分隔號合計不超過 80 字元", () => {
    const terms = ["A".repeat(78), "B", "C"];
    const result = buildWhisperPrompt(terms, "zh-TW");

    // 78 + 「、」+ 1 = 80，剛好放得下第二個；第三個放不下
    expect(result).toBe(
      `${ZH_TW_BASE}剛才提到B、${"A".repeat(78)}。`,
    );
    const joinedTerms = result!
      .replace(ZH_TW_BASE, "")
      .replace(/^剛才提到/, "")
      .replace(/。$/, "");
    expect(Array.from(joinedTerms).length).toBe(
      WHISPER_PROMPT_TERM_CHAR_BUDGET,
    );
  });

  it("[P0] 依 Array.from 計算字元數（emoji 算一個）", () => {
    const terms = ["😀".repeat(79), "B"];
    const result = buildWhisperPrompt(terms, "zh-TW");

    expect(result).toBe(`${ZH_TW_BASE}剛才提到${"😀".repeat(79)}。`);
  });
});
