import { invoke } from "@tauri-apps/api/core";
import { enhanceText } from "./enhancer";
import {
  getEnhancementErrorMessage,
  getTranscriptionErrorMessage,
} from "./errorUtils";
import type {
  LlmModelId,
  SttProviderId,
  WhisperModelId,
} from "./modelRegistry";
import type { SupportedLocale, TranscriptionLocale } from "../i18n/languageConfig";

export interface TestSuccess {
  ok: true;
  durationMs: number;
}

export interface TestFailure {
  ok: false;
  durationMs: number;
  errorMessage: string;
}

export type TestResult = TestSuccess | TestFailure;

export async function testLlmConnection(
  modelId: LlmModelId,
  apiKey: string,
): Promise<TestResult> {
  const start = performance.now();
  try {
    await enhanceText("ping", apiKey, {
      modelId,
      systemPrompt: "Reply with the word OK only.",
      maxTokens: 50,
    });
    return { ok: true, durationMs: elapsed(start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: elapsed(start),
      errorMessage: getEnhancementErrorMessage(err),
    };
  }
}

export async function testWhisperConnection(
  provider: SttProviderId,
  apiKey: string,
  modelId?: WhisperModelId,
  transcriptionLocale?: TranscriptionLocale,
  interfaceLocale?: SupportedLocale,
): Promise<TestResult> {
  const start = performance.now();
  try {
    await invoke("test_whisper_connection", {
      apiKey,
      provider,
      transcriptionLocale,
      interfaceLocale,
      ...(provider === "groq" && modelId ? { modelId } : {}),
    });
    return { ok: true, durationMs: elapsed(start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: elapsed(start),
      errorMessage: getTranscriptionErrorMessage(err),
    };
  }
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
