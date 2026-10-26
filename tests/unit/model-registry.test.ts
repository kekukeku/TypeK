import { describe, expect, it } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_LLM_PROVIDER_ID,
  findLlmModelConfig,
  estimateDailyEnhancementCount,
  getDefaultModelIdForProvider,
  getEffectiveLlmModelId,
  LLM_MODEL_LIST,
} from "../../src/lib/modelRegistry";

describe("modelRegistry — 預設模型（docs/plan-input-context.md）", () => {
  it("[P0] 預設為 Gemini 3.1 Flash-Lite，且與預設 provider 一致", () => {
    expect(DEFAULT_LLM_PROVIDER_ID).toBe("gemini");
    expect(DEFAULT_LLM_MODEL_ID).toBe("gemini-3.1-flash-lite");
    expect(findLlmModelConfig(DEFAULT_LLM_MODEL_ID)?.providerId).toBe(
      DEFAULT_LLM_PROVIDER_ID,
    );
    expect(getDefaultModelIdForProvider(DEFAULT_LLM_PROVIDER_ID)).toBe(
      DEFAULT_LLM_MODEL_ID,
    );
  });

  it("[P0] 預設模型必須是免費專案可日常使用的（freeTier full）", () => {
    expect(findLlmModelConfig(DEFAULT_LLM_MODEL_ID)?.freeTier).toBe("full");
  });

  it("[P1] 每個 provider 恰好一個 isDefault", () => {
    const providerIdList = [...new Set(LLM_MODEL_LIST.map((m) => m.providerId))];
    for (const providerId of providerIdList) {
      const defaultCount = LLM_MODEL_LIST.filter(
        (m) => m.providerId === providerId && m.isDefault,
      ).length;
      expect(defaultCount, providerId).toBe(1);
    }
  });
});

describe("modelRegistry — 免費專案可用性標示（gh-71）", () => {
  // 逐模型斷言：全部標 full 也不會意外變綠
  const expected: Record<string, "full" | "limited" | "none"> = {
    "qwen/qwen3.8-27b": "full",
    "openai/gpt-oss-120b": "full",
    "openai/gpt-oss-20b": "full",
    "gemini-3.5-flash": "limited",
    "gemini-3.1-flash-lite": "full",
    "gpt-5.6-luna": "none",
    "gpt-5.4-nano": "none",
    "claude-haiku-4-5-20251001": "none",
  };

  it("[P1] 每個模型的 freeTier 都符合查證後的分類", () => {
    expect(LLM_MODEL_LIST.map((m) => m.id).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const model of LLM_MODEL_LIST) {
      expect(model.freeTier, model.id).toBe(expected[model.id]);
    }
  });

  it("[P1] 標 none 的模型 freeQuotaRpd 必為 0；Groq 全部 full", () => {
    for (const model of LLM_MODEL_LIST) {
      if (model.freeTier === "none") expect(model.freeQuotaRpd, model.id).toBe(0);
      if (model.providerId === "groq") expect(model.freeTier, model.id).toBe("full");
    }
  });
});

describe("modelRegistry — 下架遷移", () => {
  it("[P0] 現存 registry id 應原樣通過", () => {
    for (const model of LLM_MODEL_LIST) {
      expect(getEffectiveLlmModelId(model.id)).toBe(model.id);
    }
  });

  it("[P0] Groq 預設模型為 qwen3.8 27B", () => {
    expect(getDefaultModelIdForProvider("groq")).toBe("qwen/qwen3.8-27b");
    expect(findLlmModelConfig("qwen/qwen3.8-27b")?.isDefault).toBe(true);
  });

  it("[P0] 舊版 Qwen 27B id 會遷移到 3.8", () => {
    // 舊版號拆開寫，避免舊版號字面值留在測試檔
    const legacyQwenId = "qwen/qwen3." + "6-27b";
    expect(getEffectiveLlmModelId(legacyQwenId)).toBe("qwen/qwen3.8-27b");
  });

  it("[P0] 遷移表每個舊 id 都必須解析到「存活於 registry」的模型", () => {
    // 防迴歸不變量：歷史上曾因單跳查找 + 舊 entry 指向「後來也下架」的模型，
    // 讓老使用者拿到 registry 查不到的死值（下游交叉驗證對 undefined 短路救不回）
    for (const oldId of Object.keys(DECOMMISSIONED_MODEL_MAP)) {
      const resolved = getEffectiveLlmModelId(oldId);
      expect(findLlmModelConfig(resolved), `${oldId} → ${resolved}`).toBeDefined();
    }
  });

  it("[P0] 遷移應保持同 provider（避免觸發 provider 交叉驗證重設）", () => {
    const legacyProvider: Record<string, string> = {
      "llama-3.3-70b-versatile": "groq",
      "qwen/qwen3-32b": "groq",
      "gemini-2.5-flash": "gemini",
      "gemini-2.5-flash-lite": "gemini",
      "gpt-5.4-mini": "openai",
      "claude-3-5-haiku-20241022": "anthropic",
    };
    for (const [oldId, provider] of Object.entries(legacyProvider)) {
      const resolved = getEffectiveLlmModelId(oldId);
      expect(findLlmModelConfig(resolved)?.providerId, oldId).toBe(provider);
    }
  });

  it("[P1] 連鎖 entry（舊 id 指向另一個舊 id）應迴圈解析到終點", () => {
    // "gpt-oss-120b"（無前綴短版）→ "openai/gpt-oss-120b"（registry 存活）
    expect(getEffectiveLlmModelId("gpt-oss-120b")).toBe("openai/gpt-oss-120b");
  });

  it("[P1] null 與未知 id 應 fallback 到預設", () => {
    expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
    expect(getEffectiveLlmModelId("no-such-model")).toBe(DEFAULT_LLM_MODEL_ID);
  });
});

describe("modelRegistry — STT provider", () => {
  it("[P0] 三家 provider、預設 groq、apple 只在 Mac", async () => {
    const {
      STT_PROVIDER_LIST,
      DEFAULT_STT_PROVIDER_ID,
      STT_PROVIDER_USAGE_MODEL_ID,
    } = await import("../../src/lib/modelRegistry");

    expect(STT_PROVIDER_LIST.map((provider) => provider.id)).toEqual([
      "groq",
      "apple",
      "byteplus",
    ]);
    expect(
      STT_PROVIDER_LIST.find((provider) => provider.id === "apple")?.macOnly,
    ).toBe(true);
    expect(DEFAULT_STT_PROVIDER_ID).toBe("groq");
    expect(STT_PROVIDER_USAGE_MODEL_ID.apple).toBe("apple-speech");
    expect(STT_PROVIDER_USAGE_MODEL_ID.byteplus).toBe("seed-asr-fast");
  });
});

describe("modelRegistry — Groq 免費額度估計", () => {
  it("[P1] Qwen 與 gpt-oss 的估計次數符合每日 token 額度", () => {
    const qwen = findLlmModelConfig("qwen/qwen3.8-27b");
    const gptOss = findLlmModelConfig("openai/gpt-oss-120b");
    expect(qwen).toBeDefined();
    expect(gptOss).toBeDefined();
    // 200,000 TPD ÷ (900 輸入 + 200 輸出)；gpt-oss 另加 300 推理 token
    expect(estimateDailyEnhancementCount(qwen!)).toBe(181);
    expect(estimateDailyEnhancementCount(gptOss!)).toBe(142);
  });

  it("[P1] 沒有 token 額度的模型估計為 0", () => {
    const paid = findLlmModelConfig("gpt-5.6-luna");
    expect(paid).toBeDefined();
    expect(estimateDailyEnhancementCount(paid!)).toBe(0);
  });
});
