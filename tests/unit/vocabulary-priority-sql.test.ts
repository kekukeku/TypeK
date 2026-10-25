// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/database", () => ({ getDatabase: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));
vi.mock("../../src/i18n", () => ({
  default: { global: { locale: { value: "zh-TW" }, t: (key: string) => key } },
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

import {
  AI_TERM_LIST_SQL,
  MANUAL_TERM_LIST_SQL,
} from "../../src/stores/useVocabularyStore";

interface SeedRow {
  term: string;
  weight: number;
  source: "manual" | "ai";
  createdAt: string;
}

/** 用真 SQLite 跑 store 的排序 SQL（mock DB 看不出排序結果，#84） */
function runTermQuery(sql: string, rowList: SeedRow[], limit: number): string[] {
  const db = new DatabaseSync(":memory:");
  // 欄位對應 src/lib/database.ts 的 vocabulary 表（v3 起有 weight、source）
  db.exec(
    "CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, weight INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL)",
  );
  const insert = db.prepare(
    "INSERT INTO vocabulary (id, term, weight, source, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  rowList.forEach((row, index) =>
    insert.run(`id-${index}`, row.term, row.weight, row.source, row.createdAt),
  );
  // tauri-plugin-sql 的 $1 在 SQLite 是具名參數，這裡用具名方式綁定
  const result = db.prepare(sql).all({ $1: limit }) as {
    term: string;
  }[];
  db.close();
  return result.map((row) => row.term);
}

function minuteStamp(minute: number): string {
  return `2026-10-01 00:${String(minute).padStart(2, "0")}:00`;
}

describe("字典詞排序 SQL（真 SQLite）", () => {
  it("manual SQL 只回手動詞，依權重遞減再用建立時間新到舊", () => {
    const result = runTermQuery(
      MANUAL_TERM_LIST_SQL,
      [
        { term: "舊", weight: 2, source: "manual", createdAt: minuteStamp(1) },
        { term: "高權重", weight: 5, source: "manual", createdAt: minuteStamp(2) },
        { term: "最新", weight: 2, source: "manual", createdAt: minuteStamp(3) },
        { term: "AI", weight: 99, source: "ai", createdAt: minuteStamp(4) },
      ],
      50,
    );

    expect(result).toEqual(["高權重", "最新", "舊"]);
  });

  it("AI SQL 只回學到的詞，依權重遞減再用建立時間新到舊", () => {
    const result = runTermQuery(
      AI_TERM_LIST_SQL,
      [
        { term: "舊", weight: 2, source: "ai", createdAt: minuteStamp(1) },
        { term: "高權重", weight: 5, source: "ai", createdAt: minuteStamp(2) },
        { term: "最新", weight: 2, source: "ai", createdAt: minuteStamp(3) },
        { term: "手動", weight: 99, source: "manual", createdAt: minuteStamp(4) },
      ],
      50,
    );

    expect(result).toEqual(["高權重", "最新", "舊"]);
  });

  it("LIMIT 只取指定數量", () => {
    const rowList: SeedRow[] = Array.from({ length: 5 }, (_, i) => ({
      term: `Manual${i}`,
      weight: i,
      source: "manual" as const,
      createdAt: minuteStamp(i),
    }));

    expect(runTermQuery(MANUAL_TERM_LIST_SQL, rowList, 3)).toEqual([
      "Manual4",
      "Manual3",
      "Manual2",
    ]);
  });
});
