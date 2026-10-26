import {
  convertSimplifiedToTraditional,
  normalizeTaiwanTai,
} from "./simplifiedToTraditional";

export interface TranscriptTextTransformOptions {
  /** 是否做簡→繁（只有 Groq Whisper 會輸出簡體；預設 true） */
  convertScript?: boolean;
  /** 含「台」但要照原寫法保留的詞（字典裡的企業／品牌名稱） */
  preservedTerms?: readonly string[];
}

/**
 * 轉錄原文／整理結果落地前的文字轉換（共用）。
 *
 * 有效轉譯語言為繁中（zh-TW）時：
 * 1. 把 Whisper 的簡體輸出轉成繁體（#39；`convertScript: false` 時略過）
 * 2. 「台」一律寫作「臺」，字典裡含「台」的詞照原寫法
 *
 * 有效語言（auto 已解析為介面語言）由呼叫端（store）決定後傳入，
 * 以維持 `lib/` 不依賴 `stores/` 的分層規則。
 *
 * 即時轉錄（useVoiceFlowStore）、歷史「重新辨識」（useHistoryStore）與整理結果（enhancer）共用此函式。
 */
export function applyTranscriptTextTransforms(
  rawText: string,
  effectiveLocale: string,
  options: TranscriptTextTransformOptions = {},
): string {
  if (!rawText || effectiveLocale !== "zh-TW") return rawText;
  const traditionalText =
    options.convertScript === false
      ? rawText
      : convertSimplifiedToTraditional(rawText);
  return normalizeTaiwanTai(traditionalText, options.preservedTerms);
}
