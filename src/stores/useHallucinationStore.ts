import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDatabase } from "../lib/database";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import {
  BUILTIN_HALLUCINATION_TERMS,
  getBuiltinTermListForLocale,
} from "../lib/builtinHallucinationTerms";
import type { TranscriptionLocale } from "../i18n/languageConfig";

// ── 型別 ──

export type HallucinationTermSource = "builtin" | "auto" | "manual";

export interface HallucinationTermEntry {
  id: string;
  term: string;
  source: HallucinationTermSource;
  locale: string;
  createdAt: string;
}

interface RawHallucinationTermRow {
  id: string;
  term: string;
  source: string;
  locale: string;
  created_at: string;
}

function mapRowToEntry(row: RawHallucinationTermRow): HallucinationTermEntry {
  return {
    id: row.id,
    term: row.term,
    source: row.source as HallucinationTermSource,
    locale: row.locale,
    createdAt: row.created_at,
  };
}

// ── SQL ──

const FETCH_ALL_SQL = `
  SELECT id, term, source, locale, created_at
  FROM hallucination_terms
  ORDER BY source ASC, created_at DESC
`;

const INSERT_TERM_SQL = `
  INSERT OR IGNORE INTO hallucination_terms (id, term, source, locale)
  VALUES ($1, $2, $3, $4)
`;

const DELETE_TERM_SQL = `
  DELETE FROM hallucination_terms WHERE id = $1 AND source != 'builtin'
`;

// ── Store ──

export const useHallucinationStore = defineStore("hallucination", () => {
  const termList = ref<HallucinationTermEntry[]>([]);
  const isLoading = ref(false);

  const termCount = computed(() => termList.value.length);

  async function fetchTermList(): Promise<void> {
    isLoading.value = true;
    try {
      const db = getDatabase();
      const rows = await db.select<RawHallucinationTermRow[]>(FETCH_ALL_SQL);
      termList.value = rows.map(mapRowToEntry);
    } catch (error) {
      console.error(
        `[hallucination-store] fetchTermList failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "hallucination", step: "fetch" });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function addTerm(
    term: string,
    source: "auto" | "manual",
    locale: string,
  ): Promise<void> {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    const id = crypto.randomUUID();
    try {
      const db = getDatabase();
      await db.execute(INSERT_TERM_SQL, [id, trimmedTerm, source, locale]);
      await fetchTermList();
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      // UNIQUE constraint → 靜默忽略（INSERT OR IGNORE 已處理，此處為防禦性捕獲）
      if (errorMessage.includes("UNIQUE")) return;
      console.error(`[hallucination-store] addTerm failed: ${errorMessage}`);
      captureError(error, { source: "hallucination", step: "add" });
      throw error;
    }
  }

  async function removeTerm(id: string): Promise<void> {
    try {
      const db = getDatabase();
      await db.execute(DELETE_TERM_SQL, [id]);
      await fetchTermList();
    } catch (error) {
      console.error(
        `[hallucination-store] removeTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "hallucination", step: "remove" });
      throw error;
    }
  }

  /**
   * 取得偵測用的幻覺詞清單（合併 DB 自訂詞 + 內建詞庫）。
   *
   * @param transcriptionLocale - 當前轉錄語言設定
   */
  async function getTermListForDetection(
    transcriptionLocale: TranscriptionLocale,
  ): Promise<string[]> {
    // 1. 取得內建詞庫（純函式，不依賴 DB）
    const builtinTermList = getBuiltinTermListForLocale(transcriptionLocale);

    // 2. 從 DB 查詢使用者自訂/自動學習的幻覺詞
    const whisperCodeList = resolveWhisperCodeList(transcriptionLocale);
    let dbTermList: string[] = [];

    try {
      const db = getDatabase();
      if (whisperCodeList.length > 0) {
        // 動態構建 IN 查詢（避免 SQL injection：使用參數化的多次查詢後合併）
        const allDbTermList: string[] = [];
        for (const code of whisperCodeList) {
          const rows = await db.select<{ term: string }[]>(
            "SELECT term FROM hallucination_terms WHERE locale = $1",
            [code],
          );
          allDbTermList.push(...rows.map((r) => r.term));
        }
        dbTermList = allDbTermList;
      }
    } catch (error) {
      console.error(
        `[hallucination-store] getTermListForDetection DB query failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, {
        source: "hallucination",
        step: "get-detection-list",
      });
      // DB 查詢失敗時仍回傳內建詞庫
    }

    // 3. 合併去重
    return [...new Set([...builtinTermList, ...dbTermList])];
  }

  /**
   * App 啟動時將內建幻覺詞寫入 DB。
   * 使用 INSERT OR IGNORE 確保冪等性。
   */
  async function initializeBuiltinTerms(): Promise<void> {
    try {
      const db = getDatabase();
      for (const [locale, termListForLocale] of Object.entries(
        BUILTIN_HALLUCINATION_TERMS,
      )) {
        for (const term of termListForLocale) {
          const id = crypto.randomUUID();
          await db.execute(INSERT_TERM_SQL, [id, term, "builtin", locale]);
        }
      }
      console.log("[hallucination-store] Builtin terms initialized");
    } catch (error) {
      console.error(
        `[hallucination-store] initializeBuiltinTerms failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, {
        source: "hallucination",
        step: "initialize-builtin",
      });
    }
  }

  function isDuplicateTerm(term: string): boolean {
    const normalizedInput = term.trim().toLowerCase();
    return termList.value.some(
      (entry) => entry.term.trim().toLowerCase() === normalizedInput,
    );
  }

  return {
    termList,
    isLoading,
    termCount,
    isDuplicateTerm,
    fetchTermList,
    addTerm,
    removeTerm,
    getTermListForDetection,
    initializeBuiltinTerms,
  };
});

// ── Helper ──

/**
 * 將 TranscriptionLocale 映射為 Whisper language code list。
 */
function resolveWhisperCodeList(
  transcriptionLocale: TranscriptionLocale,
): string[] {
  if (transcriptionLocale === "auto") {
    return ["zh", "en", "ja", "ko"];
  }

  const codeMap: Record<string, string[]> = {
    "zh-TW": ["zh"],
    "zh-CN": ["zh"],
    en: ["en"],
    ja: ["ja"],
    ko: ["ko"],
  };

  return codeMap[transcriptionLocale] ?? ["zh"];
}
