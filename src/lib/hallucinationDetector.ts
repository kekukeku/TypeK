/**
 * 幻覺偵測模組 — 純函式，不依賴 Vue/Pinia/Tauri。
 *
 * 三層偵測邏輯：
 *  Layer 1: 語速異常（物理定律級判斷）
 *  Layer 2+3: 高 noSpeechProbability + 幻覺詞庫命中
 *  雙弱可疑: noSpeechProbability 弱可疑 + 語速偏高組合
 */

// ── 常數 ──

/** Layer 1 錄音時長門檻（ms） */
export const SPEED_ANOMALY_MAX_DURATION_MS = 1000;
/** Layer 1 文字長度門檻 */
export const SPEED_ANOMALY_MIN_CHARS = 10;
/** Layer 2 強判定 noSpeechProbability 門檻 */
export const HIGH_NSP_THRESHOLD = 0.9;
/** 弱可疑 noSpeechProbability 門檻 */
export const WEAK_NSP_THRESHOLD = 0.7;
/** 弱可疑語速門檻（ms） */
export const WEAK_SPEED_MAX_DURATION_MS = 2000;
/** 弱可疑文字長度門檻 */
export const WEAK_SPEED_MIN_CHARS = 15;

// ── 型別 ──

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  noSpeechProbability: number;
  hallucinationTermList: string[];
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason:
    | "speed-anomaly"
    | "high-nsp-term-match"
    | "dual-weak-suspicious"
    | null;
  shouldAutoLearn: boolean;
  detectedText: string;
}

// ── 核心函式 ──

/**
 * 判斷轉錄文字是否命中幻覺詞庫。
 * 支援精確匹配（trim 後相等）與包含匹配（text.includes(term)）。
 */
export function matchesHallucinationTermList(
  text: string,
  termList: string[],
): boolean {
  const trimmedText = text.trim();
  return termList.some(
    (term) => trimmedText === term || trimmedText.includes(term),
  );
}

/**
 * 三層幻覺偵測邏輯。
 *
 * 優先級：Layer 1 > Layer 2+3 > 雙弱可疑 > 放行
 */
export function detectHallucination(
  params: HallucinationDetectionParams,
): HallucinationDetectionResult {
  const {
    rawText,
    recordingDurationMs,
    noSpeechProbability,
    hallucinationTermList,
  } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 語速異常（物理定律級判斷）
  if (
    recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS &&
    charCount > SPEED_ANOMALY_MIN_CHARS
  ) {
    return {
      isHallucination: true,
      reason: "speed-anomaly",
      shouldAutoLearn: true,
      detectedText: trimmedText,
    };
  }

  // Layer 2 + 3: 高 NSP + 詞庫命中
  if (
    noSpeechProbability > HIGH_NSP_THRESHOLD &&
    matchesHallucinationTermList(trimmedText, hallucinationTermList)
  ) {
    return {
      isHallucination: true,
      reason: "high-nsp-term-match",
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 雙弱可疑組合
  const isWeakNsp = noSpeechProbability > WEAK_NSP_THRESHOLD;
  const isWeakSpeed =
    recordingDurationMs < WEAK_SPEED_MAX_DURATION_MS &&
    charCount > WEAK_SPEED_MIN_CHARS;

  if (isWeakNsp && isWeakSpeed) {
    return {
      isHallucination: true,
      reason: "dual-weak-suspicious",
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    shouldAutoLearn: false,
    detectedText: trimmedText,
  };
}
