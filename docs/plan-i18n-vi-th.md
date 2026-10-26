# 計畫：新增越南文、泰文，介面語言與說話語言分開選

> **狀態：審查中，尚未定稿、尚未實作。** 小A（`docs/小A_review_plan-i18n-vi-th.md`）、小B（`docs/小B_review_plan-i18n-vi-th.md`）已給建議，等小C 審查後整理成修訂版。

> 建立：2026-10-26。需求（Kevin）：App 支援英文、越南文、泰文、日文與韓文，使用者可在設定中分別選擇「他所說的語言」與「介面語言」。
> 審查：小C、小B、小A 對本計畫給建議後再定稿，之後交小D 實作。

## 現況

- 已有兩個獨立設定：介面語言 `selectedLocale`（`SupportedLocale` = zh-TW／zh-CN／en／ja／ko）與說話語言 `selectedTranscriptionLocale`（`TranscriptionLocale` = auto + 上述五種 + `yue` 廣東話），定義在 `src/i18n/languageConfig.ts`，設定頁已有兩個選單
- 英文、日文、韓文**已支援**；缺的是 **越南文（vi）與泰文（th）**
- 依語系各寫一份的地方：
  - 介面文字 `src/i18n/locales/*.json`（每檔約 490 行，五語系）
  - 整理指示 `src/i18n/prompts.ts`：精簡／積極／編輯模式模板、明確與自動的語言規則，全部是 `Record<SupportedLocale, …>`，**少一個語系就型別錯誤**
  - Whisper 前置稿 `src/lib/whisperPrompt.ts`：只有 zh-TW／zh-CN，其他語系回 `null`
  - 幻聽詞庫 `hallucination_terms`（`src/lib/database.ts:314`，依 locale）
  - 日期數字格式 `src/lib/formatUtils.ts`、`src/views/DictionaryView.vue:177`（走 `toLocaleString`）
  - 規則與發版：`.claude/rules/i18n.md`（「五語系同步」）、`typek-release` skill 的升級彈窗五語系

## 範圍

### 1. 語系設定

- `SupportedLocale` 加 `"vi" | "th"`；`LANGUAGE_OPTIONS` 加兩筆：
  - vi：`displayName: "Tiếng Việt"`、`whisperCode: "vi"`、`htmlLang: "vi"`、`navigatorPatternList: ["vi"]`
  - th：`displayName: "ไทย"`、`whisperCode: "th"`、`htmlLang: "th"`、`navigatorPatternList: ["th"]`
- 說話語言選單自動多出這兩項（`TRANSCRIPTION_LANGUAGE_OPTIONS` 由 `LANGUAGE_OPTIONS` 衍生）
- 首次啟動偵測系統語言：vi／th 系統直接落在對應語系

### 2. 介面文字

- 新增 `src/i18n/locales/vi.json`、`th.json`，key 與 `en.json` 完全一致；由小D 依 zh-TW 語意翻譯（i18n 規則：ja／ko 由 zh-TW 翻，不從 en 二次翻；vi／th 比照）
- 新增測試：七個 locale 檔的 key 集合完全相同、沒有空字串
- `.claude/rules/i18n.md` 與 `typek-release` skill：「五語系」改「七語系」

### 3. AI 整理指示

- `prompts.ts` 為 vi、th 補：精簡、積極、編輯模式模板，明確與自動語言規則，舊預設清單不需要（新語系沒有舊版）
- 規則重點：保留英文詞與專有名詞、補標點、去口頭停頓（vi：ờ, à, thì là；th：เอ่อ, อ่า, แบบว่า）、不翻譯、不回答逐字稿
- 泰文**不加詞間空格**、不加句號；越南文保留聲調符號、不轉成無聲調

### 4. 語音辨識

- Whisper `language` 傳 `vi`／`th`（現有機制）
- `whisperPrompt.ts` 是否為 vi／th 加口語前置句：**待審查意見**（目前其他語系回 `null` 走 `Important Vocabulary:`）
- 幻聽詞庫：為 vi、th 補常見 Whisper 幻聽句（例如影片結尾的訂閱、感謝收看）

### 5. 格式與排版

- 日期：泰文 `th` 的 `toLocaleDateString` 預設佛曆，改用 `th-TH-u-ca-gregory`（或依審查意見保留佛曆）
- 字型：系統字型堆疊補 Thai／Vietnamese 可用字型（macOS 內建 Thonburi、`-apple-system` 已含越南文字形）；泰文行高需較大，HUD 文字要測不被截
- 字串長度：越南文通常比中文長 1.5–2 倍，檢查設定頁、側邊欄、HUD 不爆版

### 6. 守衛

- 語意飄移守衛用字元 bigram（`src/lib/hallucinationDetector.ts`）：泰文無空格、有組合字元（上下標母音），需確認門檻在泰文不會誤判；必要時改用 `Intl.Segmenter` 以「字素」切分

## 不做

- 越南文、泰文的人工母語校對（列為上線前 Kevin 找母語者確認的項目）
- 其他新語系、RTL 語系

## 實作順序

1. 等「繽紛少女風」套版完成後再動（兩者都會改設定頁，避免衝突）
2. 語系設定 + 型別 → `vue-tsc` 會列出所有缺 vi／th 的 `Record`
3. 介面文字 vi／th + key 一致性測試
4. 整理指示 vi／th
5. 幻聽詞庫、日期格式、字型
6. 守衛在泰文上的測試案例

## 驗收

- `vue-tsc`、eslint、Vitest 全綠；七語系 key 一致性測試
- 設定頁兩個選單：介面語言 7 項、說話語言 9 項（auto + 7 + 粵語），切換介面語言即時生效、不影響說話語言
- 介面語言 vi／th 時各頁面截圖無爆版、無缺字
- 說話語言 vi／th 時，Whisper 請求帶 `language=vi`／`th`，整理指示用對應語系

## 想請審查回答

1. vi／th 要不要像 zh-TW 一樣加 Whisper 口語前置句？用什麼句子？
2. 泰文日期該用佛曆還是西元？
3. bigram 飄移守衛在泰文、越南文上的風險，要不要改 `Intl.Segmenter`？
4. 翻譯品質：沒有母語者的情況下，用什麼方式降低機翻錯誤（例如 glossary、回譯檢查）？
5. 還漏了哪些依語系的地方？
