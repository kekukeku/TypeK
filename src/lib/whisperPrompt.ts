/**
 * Whisper 的 `prompt` 會被當成「前一段逐字稿」延續風格，不是指令。
 * 這裡依辨識語言組成一段繁中／簡中前置稿；其他語系回 null，
 * 沿用 Rust 端既有的 `Important Vocabulary:` 行為。
 */
export const WHISPER_PROMPT_TERM_CHAR_BUDGET = 80;

const BASE_PROMPTS: Record<string, string> = {
  "zh-TW":
    "以下是台灣繁體中文的語音逐字稿，口語中英夾雜，英文專有名詞維持原文拼寫。",
  "zh-CN":
    "以下是简体中文的语音逐字稿，口语中英夹杂，英文专有名词保持原文拼写。",
};

/**
 * `termList` 依優先度由高到低。Whisper 只看尾端（最後 224 token），
 * 所以取完能放進 80 字元的名額後反轉，讓最高優先的詞落在尾端（#84）。
 */
export function buildWhisperPrompt(
  termList: string[],
  transcriptLocale: string,
): string | null {
  const basePrompt = BASE_PROMPTS[transcriptLocale];
  if (!basePrompt) return null;

  const pickedTermList: string[] = [];
  let joinedTerms = "";

  for (const term of termList) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) continue;

    const candidate =
      pickedTermList.length === 0
        ? trimmedTerm
        : `${joinedTerms}、${trimmedTerm}`;
    if (Array.from(candidate).length > WHISPER_PROMPT_TERM_CHAR_BUDGET) break;

    pickedTermList.push(trimmedTerm);
    joinedTerms = candidate;
  }

  if (pickedTermList.length === 0) return basePrompt;

  const termPrefix = transcriptLocale === "zh-TW" ? "剛才提到" : "刚才提到";
  return `${basePrompt}${termPrefix}${pickedTermList.reverse().join("、")}。`;
}
