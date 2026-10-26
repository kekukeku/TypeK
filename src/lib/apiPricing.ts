import {
  findWhisperModelConfig,
  findLlmModelConfig,
  DEFAULT_WHISPER_MODEL_ID,
  DEFAULT_LLM_MODEL_ID,
} from "./modelRegistry";

const WHISPER_MIN_BILLING_MS = 10_000;

/** 本機／非 Groq 轉錄服務的用量 model id：免額度、成本 0、不套 10 秒地板。 */
const ZERO_COST_WHISPER_MODEL_ID_SET = new Set([
  "apple-speech",
  "seed-asr-fast",
]);

/**
 * 計算 Whisper API 費用上限。
 * Groq 最低計費 10 秒/次，不足 10 秒一律按 10 秒算。
 * 從 modelRegistry 查表取得對應模型的每小時費率。
 * Apple／BytePlus 走自己的服務，不列入 Groq 計費。
 */
export function calculateWhisperCostCeiling(
  audioDurationMs: number,
  modelId: string = DEFAULT_WHISPER_MODEL_ID,
): number {
  if (ZERO_COST_WHISPER_MODEL_ID_SET.has(modelId)) return 0;
  const config = findWhisperModelConfig(modelId);
  const costPerHour = config?.costPerHour ?? 0.111;
  const billedMs = Math.max(audioDurationMs, WHISPER_MIN_BILLING_MS);
  return (billedMs / 3_600_000) * costPerHour;
}

/**
 * 計算 Chat LLM API 費用上限。
 * 全部 token 按較貴的價格算（input vs output 取大），保證是上限。
 */
export function calculateChatCostCeiling(
  totalTokens: number,
  modelId: string = DEFAULT_LLM_MODEL_ID,
): number {
  const config = findLlmModelConfig(modelId);
  // fallback 取全 registry 最貴的 outputCostPerMillion（gemini-3.5-flash $9/M），
  // 維持「保證是上限」的不變量——查不到 config 時（如遺留的死 model id）不會低估
  const maxCostPerToken = config
    ? Math.max(config.inputCostPerMillion, config.outputCostPerMillion) /
      1_000_000
    : 0.000009;
  return totalTokens * maxCostPerToken;
}
