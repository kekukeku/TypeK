/**
 * 簡體 → 繁體（臺灣）轉換 — 純函式，供轉錄結果落地前套用。
 *
 * 背景（#39）：Whisper 對中文預設輸出簡體，而使用者若選繁中，會期待繁體輸出。
 * TypeK 過去沒有確定性的簡→繁轉換（只靠 AI 整理偶爾順手轉、不穩定）。
 * 這裡用 opencc-js 做字元級（Taiwan 標準）轉換，只在轉譯語言解析為 zh-TW 時套用。
 *
 * 用 `to: "tw"`（字元級臺灣正體）而非 `"twp"`（含詞彙/慣用語轉換）：
 * 只轉字、不改用詞，避免把使用者原本的措辭改掉。
 */
import { Converter } from "opencc-js";

let convert: ((text: string) => string) | null = null;

/** 惰性建立 converter（載入字典有成本，建立一次即可重用）。 */
function getConverter(): (text: string) => string {
  if (!convert) {
    convert = Converter({ from: "cn", to: "tw" });
  }
  return convert;
}

/** 把簡體中文轉成繁體（臺灣）。空字串原樣返回。 */
export function convertSimplifiedToTraditional(text: string): string {
  if (!text) return text;
  return getConverter()(text);
}

/**
 * 繁中一律用「臺」：把「台」換成「臺」（Kevin 2026-10-26 指定）。
 * `preservedTerms` 裡含「台」的詞（例如字典裡的「台灣中油」）照原寫法保留。
 */
export function normalizeTaiwanTai(
  text: string,
  preservedTerms: readonly string[] = [],
): string {
  if (!text || !text.includes("台")) return text;
  const protectedTerms = [...new Set(preservedTerms.filter((term) => term.includes("台")))]
    .sort((a, b) => b.length - a.length);
  if (protectedTerms.length === 0) return text.replaceAll("台", "臺");

  const pieces: string[] = [];
  let index = 0;
  while (index < text.length) {
    const term = protectedTerms.find((candidate) => text.startsWith(candidate, index));
    if (term) {
      pieces.push(term);
      index += term.length;
    } else {
      pieces.push(text[index] === "台" ? "臺" : text[index]);
      index += 1;
    }
  }
  return pieces.join("");
}
