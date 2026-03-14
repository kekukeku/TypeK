/**
 * 多語言內建幻覺詞庫。
 *
 * Whisper 在無語音或短停頓時常產生的幻覺文字，
 * 大多來自 YouTube 字幕訓練資料的污染。
 */

import type { TranscriptionLocale } from "../i18n/languageConfig";

/** 以 Whisper language code 為 key 的內建幻覺詞庫 */
export const BUILTIN_HALLUCINATION_TERMS: Record<string, string[]> = {
  zh: [
    "謝謝收看",
    "字幕組",
    "請訂閱",
    "感謝觀看",
    "歡迎訂閱",
    "謝謝大家",
    "下期再見",
    "感謝收聽",
    "請點讚",
    "訂閱我的頻道",
    "字幕由Amara社區提供",
    "謝謝收聽",
    "感謝收看",
    "下次再見",
  ],
  en: [
    "Thank you for watching",
    "Subscribe",
    "Like and share",
    "Please subscribe",
    "Thanks for watching",
    "Don't forget to subscribe",
    "Hit the bell icon",
    "Like and subscribe",
    "See you next time",
    "Thanks for listening",
  ],
  ja: [
    "ご視聴ありがとう",
    "チャンネル登録",
    "ご視聴ありがとうございました",
    "チャンネル登録お願いします",
    "ご視聴いただきありがとうございます",
    "次回もお楽しみに",
  ],
  ko: [
    "시청해 주셔서 감사합니다",
    "구독",
    "좋아요",
    "구독과 좋아요",
    "다음 영상에서 만나요",
    "시청해주셔서 감사합니다",
  ],
};

/**
 * 根據 `TranscriptionLocale` 取得對應語言的內建幻覺詞清單。
 *
 * - `zh-TW` / `zh-CN` → `zh` 詞庫
 * - `en` / `ja` / `ko` → 各自的詞庫
 * - `auto` → 合併所有語言的詞庫並去重
 */
export function getBuiltinTermListForLocale(
  transcriptionLocale: TranscriptionLocale,
): string[] {
  if (transcriptionLocale === "auto") {
    const allTermList = Object.values(BUILTIN_HALLUCINATION_TERMS).flat();
    return [...new Set(allTermList)];
  }

  // zh-TW / zh-CN → zh
  const whisperCodeMap: Record<string, string> = {
    "zh-TW": "zh",
    "zh-CN": "zh",
    en: "en",
    ja: "ja",
    ko: "ko",
  };

  const whisperCode = whisperCodeMap[transcriptionLocale] ?? "zh";
  return BUILTIN_HALLUCINATION_TERMS[whisperCode] ?? [];
}
