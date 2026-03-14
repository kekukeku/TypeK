import { describe, it, expect } from "vitest";
import {
  detectHallucination,
  matchesHallucinationTermList,
  SPEED_ANOMALY_MAX_DURATION_MS,
  SPEED_ANOMALY_MIN_CHARS,
  HIGH_NSP_THRESHOLD,
  WEAK_NSP_THRESHOLD,
  WEAK_SPEED_MAX_DURATION_MS,
  WEAK_SPEED_MIN_CHARS,
} from "../../src/lib/hallucinationDetector";

describe("hallucinationDetector.ts", () => {
  describe("常數值驗證", () => {
    it("[P0] 常數應符合設計規格", () => {
      expect(SPEED_ANOMALY_MAX_DURATION_MS).toBe(1000);
      expect(SPEED_ANOMALY_MIN_CHARS).toBe(10);
      expect(HIGH_NSP_THRESHOLD).toBe(0.9);
      expect(WEAK_NSP_THRESHOLD).toBe(0.7);
      expect(WEAK_SPEED_MAX_DURATION_MS).toBe(2000);
      expect(WEAK_SPEED_MIN_CHARS).toBe(15);
    });
  });

  describe("Layer 1: 語速異常偵測（強判定）", () => {
    it("[P0] 錄音 < 1 秒且文字 > 10 字 → 幻覺 + 自動學習", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        noSpeechProbability: 0.1,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("speed-anomaly");
      expect(result.shouldAutoLearn).toBe(true);
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });

    it("[P0] 錄音恰好 1000ms 不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 1000,
        noSpeechProbability: 0.1,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 文字恰好 10 字不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十",
        recordingDurationMs: 500,
        noSpeechProbability: 0.1,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P1] 帶前後空白的文字應 trim 後計算字數", () => {
      const result = detectHallucination({
        rawText: "  謝謝收看請訂閱我的頻道感謝大家  ",
        recordingDurationMs: 500,
        noSpeechProbability: 0.1,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(true);
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });
  });

  describe("Layer 2 + 3: 高 NSP + 詞庫命中（強判定）", () => {
    it("[P0] noSpeechProbability > 0.9 且精確命中詞庫 → 幻覺", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 2000,
        noSpeechProbability: 0.95,
        hallucinationTermList: ["謝謝收看", "字幕組"],
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("high-nsp-term-match");
      expect(result.shouldAutoLearn).toBe(false);
    });

    it("[P0] noSpeechProbability > 0.9 且包含命中詞庫 → 幻覺", () => {
      const result = detectHallucination({
        rawText: "感謝大家的謝謝收看喔",
        recordingDurationMs: 2000,
        noSpeechProbability: 0.95,
        hallucinationTermList: ["謝謝收看"],
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("high-nsp-term-match");
    });

    it("[P0] noSpeechProbability 恰好 0.9 不應觸發 Layer 2+3", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 2000,
        noSpeechProbability: 0.9,
        hallucinationTermList: ["謝謝收看"],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] noSpeechProbability > 0.9 但不命中詞庫 → 放行", () => {
      const result = detectHallucination({
        rawText: "你好",
        recordingDurationMs: 2000,
        noSpeechProbability: 0.95,
        hallucinationTermList: ["謝謝收看", "字幕組"],
      });

      expect(result.isHallucination).toBe(false);
    });
  });

  describe("雙弱可疑組合判定", () => {
    it("[P0] NSP > 0.7 且錄音 < 2 秒且字數 > 15 → 幻覺", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十一二三四五六",
        recordingDurationMs: 1500,
        noSpeechProbability: 0.75,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("dual-weak-suspicious");
      expect(result.shouldAutoLearn).toBe(false);
    });

    it("[P0] 僅 NSP > 0.7（無語速問題）→ 放行", () => {
      const result = detectHallucination({
        rawText: "短文",
        recordingDurationMs: 3000,
        noSpeechProbability: 0.75,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 僅語速偏高（NSP 正常）→ 放行", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十一二三四五六",
        recordingDurationMs: 1500,
        noSpeechProbability: 0.5,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] NSP 恰好 0.7 不應觸發弱可疑", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十一二三四五六",
        recordingDurationMs: 1500,
        noSpeechProbability: 0.7,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 錄音恰好 2000ms 不應觸發弱可疑語速", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十一二三四五六",
        recordingDurationMs: 2000,
        noSpeechProbability: 0.75,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 字數恰好 15 不應觸發弱可疑語速", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十一二三四五",
        recordingDurationMs: 1500,
        noSpeechProbability: 0.75,
        hallucinationTermList: [],
      });

      expect(result.isHallucination).toBe(false);
    });
  });

  describe("正常放行", () => {
    it("[P0] 所有指標正常 → 放行", () => {
      const result = detectHallucination({
        rawText: "這是一段正常的語音轉錄文字",
        recordingDurationMs: 3000,
        noSpeechProbability: 0.1,
        hallucinationTermList: ["謝謝收看"],
      });

      expect(result.isHallucination).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.shouldAutoLearn).toBe(false);
    });
  });

  describe("Layer 優先級", () => {
    it("[P0] Layer 1 優先於 Layer 2+3（即使同時滿足）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        noSpeechProbability: 0.95,
        hallucinationTermList: ["謝謝收看"],
      });

      expect(result.reason).toBe("speed-anomaly");
      expect(result.shouldAutoLearn).toBe(true);
    });
  });

  describe("matchesHallucinationTermList", () => {
    it("[P0] 精確匹配（trimmed）", () => {
      expect(matchesHallucinationTermList("謝謝收看", ["謝謝收看"])).toBe(true);
    });

    it("[P0] 包含匹配", () => {
      expect(
        matchesHallucinationTermList("今天的謝謝收看節目", ["謝謝收看"]),
      ).toBe(true);
    });

    it("[P0] 不命中", () => {
      expect(matchesHallucinationTermList("今天天氣真好", ["謝謝收看"])).toBe(
        false,
      );
    });

    it("[P0] 空詞庫 → 不命中", () => {
      expect(matchesHallucinationTermList("謝謝收看", [])).toBe(false);
    });

    it("[P1] 英文包含匹配（不區分大小寫不在此函式，此函式使用原始比對）", () => {
      expect(
        matchesHallucinationTermList("Thank you for watching", [
          "Thank you for watching",
        ]),
      ).toBe(true);
    });
  });
});
