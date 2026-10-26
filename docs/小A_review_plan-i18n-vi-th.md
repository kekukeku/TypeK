# 小A 對多語言計畫（越南文、泰文支援）獨立審查報告

> 審查者：小A（Antigravity / 峨嵋派三師姊）  
> 審查日期：2026-10-26  
> 審查標的：`docs/plan-i18n-vi-th.md`  
> 核心精神：Lazy Senior Dev（Ponytail 模式）— 能省則省、直擊痛點、拒絕無效繁瑣、把視覺排版與邊界死角抓乾淨！✨

---

## 漏掉的地方

計畫整體骨架清晰，但身為慵懶又有強迫症的資深工程師，一眼就抓到好幾處「寫下去一定會噴錯或撞牆」的死角。特別是有個地方根本是在跟幽靈打架（笑死）：

[HIGH] `src/lib/database.ts:314-366` — **呼叫已死亡的幽靈表格（不必要的項目）**。計畫書在第 14 行、44 行、67 行白紙黑字說要幫 vi、th 補 `hallucination_terms` 幻聽詞庫，還標註在 `src/lib/database.ts:314`。但只要往後翻到 `database.ts:359-366` 就會發現，在 Migration v6 → v7 時，早就執行了 `DROP TABLE IF EXISTS hallucination_terms;`！這個表格在現在的 TypeK 根本不存在，執行期也沒有任何程式碼在讀它。計畫書抓著歷史遺留的 migration 影子在開工，完全多此一舉，請直接整段砍掉，不要浪費時間建表或寫遷移！

[HIGH] `src/i18n/index.ts:3-19` — **漏掉 vue-i18n 訊息實體註冊**。計畫書第 2 節洋洋灑灑說要新增 `vi.json` 與 `th.json`，但完全沒提到 `src/i18n/index.ts`。該檔案目前是靜態 import `zhTW, en, ja, zhCN, ko` 並手動掛進 `messages` 物件中。如果小D 照著計畫做完，只加了 json 檔卻沒改 `index.ts`，vue-i18n 在切到 vi 或 th 時根本載不到字典，直接 fallback 回英文或整面噴出 raw key。

[HIGH] `src/lib/whisperPrompt.ts:36, 45-46` — **硬編碼中文標點與前綴污染外語 Whisper**。目前第 36 行硬編碼頓號 `、` 作為詞彙分隔符；第 45 行寫死 `const termPrefix = transcriptLocale === "zh-TW" ? "剛才提到" : "刚才提到";`，第 46 行組裝 `${basePrompt}${termPrefix}${pickedTermList.reverse().join("、")}。`。如果為 vi 或 th 加上了 `BASE_PROMPTS`，結尾卻硬塞中文「刚才提到 A、B。」，會直接把 Whisper 的語言空間帶偏，誘發模型在轉錄越語或泰語時噴出中文字或中文標點！

[HIGH] `src/lib/hallucinationDetector.ts:113` — **正規化把泰文與越南文標記全部當雜訊吃光**。`normalizeForOverlap` 寫著 `.replace(/[^\p{L}\p{N}]/gu, "")`。在 Unicode 中，泰文的上下標母音（如 `ิ, ี, ึ, ื, ุ, ู`）與聲調符號（如 `่, ้, ๊, ๋, ์`）全都屬於非間距標記 `\p{Mn}`，**根本不是 `\p{L}`**！這行正則會把泰文所有母音與聲調剝得一乾二淨，只剩光禿禿的子音；而越南文如果遇到 NFD 分解字元，聲調帽子也全被洗掉。這會讓 bigram 守衛抓到的泰文面目全非，甚至引發除以零或誤判。

[HIGH] `src/i18n/prompts.ts:8` — **TypeScript 型別未雨綢繆破裂**。`LEGACY_DEFAULT_PROMPTS` 目前宣告為 `Record<SupportedLocale, string>`。計畫書說「舊預設清單不需要（新語系沒有舊版）」，但一旦 `SupportedLocale` 加上 `"vi" | "th"`，TypeScript 編譯器立刻會抗議缺少 `vi` 與 `th` 鍵值，`vue-tsc` 瞬間標紅。必須把型別改成 `Partial<Record<SupportedLocale, string>>` 或拆出 `LegacySupportedLocale`。

[MED] `src/views/DictionaryView.vue:173-185` — **字典頁獨立手寫日期格式化未納管**。計畫書提到 `src/lib/formatUtils.ts` 的日期處理，但 `DictionaryView.vue:177` 竟然自己寫了一套 `date.toLocaleDateString(locale.value, ...)`，沒走共用的 `formatTimestamp`。如果只在 `formatUtils.ts` 處理泰文西元曆，字典頁依然會脫鉤跑出泰國佛曆（2569年），造成不同頁面顯示不一致。

[MED] `src/style.css:186` — **全域字型堆疊缺乏泰文與越南文字型備援**。目前 body 字型為 `"SF Pro Rounded", "Avenir Next Rounded", "Arial Rounded MT Bold", -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif`。Windows 跨平臺環境下沒有針對泰文（`Leelawadee UI`）或越南文（`Segoe UI`）宣告安全優先字型，極易退回系統最底層的 Tahoma 或細明體導致字重失衡；且泰文直向層次多，行高未宣告安全邊界。

[MED] `src/components/NotchHud.vue:816-821` — **HUD 緊湊徽章（Badge）垂直裁切風險**。`.hud-badge` 設定為 `font-size: 10px; padding: 1px 6px;`。泰文具有極高垂直上下標，10px 搭配極窄 1px padding，聲調符號與下標母音在緊湊膠囊內會直接被截斷或貼邊。

[LOW] `src/i18n/languageConfig.ts:133` — **轉錄語言選單中的廣東話名稱未語系化**。`TRANSCRIPTION_LANGUAGE_OPTIONS` 裡的 `yue` 硬編碼為繁體「廣東話」。在介面語言為英文、越文或泰文時，其他項目都是各國母語自稱（Tiếng Việt、ไทย），唯獨廣東話顯示為中文字，建議補上適當的外語名稱映射或自稱標註。

[LOW] `docs/development-guide.md:175` 與 `.claude/rules/i18n.md:10, 14` — **專案指引與發版規則漏改**。文件與規則多處仍寫著「五語系同步」與「五個語系都要加」，需同步升級為「七語系」，包含 `src/MainApp.vue:89` 的升級公告維護指引。

---

## 五個問題的回答

身為天天跟音訊與模型打交道的 AI 助手，這五個問題直接切中要害，我的專業具體回答如下：

### 1. vi／th 要不要像 zh-TW 一樣加 Whisper 口語前置句？用什麼句子？
- **核心結論**：**越南文（vi）建議加；泰文（th）初期強烈建議回 `null`！**
- **詳細理由與句子設計**：
  - **Whisper prompt 的物理特性**：Whisper 的 `prompt` 不是讓 LLM 遵守的指令，而是「上一段錄音的假想逐字稿」。Whisper 會竭盡所能模仿 prompt 的語言、用詞、大小寫與標點風格。
  - **越南文（vi）**：越南文使用拉丁字母加上調符（Dấu），在口語錄音中最常遇到的問題是專有名詞被音譯硬拼，以及標點符號混亂。因此加上包含專有名詞拼寫規範的前置句對辨識率非常有幫助。
    - **推薦前置句**：
      `"Dưới đây là bản ghi âm giọng nói tiếng Việt, có xen lẫn thuật ngữ tiếng Anh. Giữ nguyên chính tả các từ tiếng Anh chuyên ngành."`
      （中譯：以下是越南語語音逐字稿，夾雜英文術語。英文專有名詞請保持原文拼寫。）
    - **搭配的前綴與分隔符（修正 `whisperPrompt.ts`）**：
      - 前綴 `termPrefix`：`" Đã nhắc đến: "`（剛才提到：）
      - 分隔符：`", "`
      - 結尾符：`"."`
  - **泰文（th）**：**先不要加長句！** 泰文是極度敏感的無空格語言（Scriptio continua）。Groq 上的 `whisper-large-v3` 在泰文上非常脆弱，一旦 prompt 給了長句或不自然的空格，Whisper 會發生嚴重的「空格幻覺」，在轉錄結果的每個音節中間胡亂插西文半形空格，甚至把 prompt 的句子反覆鬼打牆吐出來。
    - 泰文最安全優雅的做法是維持 `BASE_PROMPTS["th"] = null;`。這樣一來，Rust 端會自動退回既有的 `format_whisper_prompt` 邏輯（只送出 `Important Vocabulary: term1, term2`），純粹提供字典單字給 Whisper 參考，既不會干擾分詞，又能保護專有名詞。

### 2. 泰文日期該用佛曆還是西元？
- **核心結論**：**一律使用西元曆（Gregorian），強制指定 `th-TH-u-ca-gregory`！**
- **詳細理由**：
  - 泰國日常生活中，官方公文、銀行或傳統日曆確實使用佛曆（B.E.，佛曆年 = 西元年 + 543，2026 年為 2569 年）。
  - 但在**現代桌面應用軟體、生產力工具（如 Slack、Notion、GitHub、macOS/Windows 系統工具）**中，涉及時間戳記、轉錄歷史、用量圖表時，使用佛曆 2569 年會與 Unix Timestamp、ISO 8601 時間以及外部剪貼簿貼上情境產生嚴重的認知衝突（使用者看到 2569 年常誤以為系統時鐘故障或穿越時空）。
  - 現代國際化軟體在泰語本地化時的標準做法：語言採用泰語（顯示泰語月份縮寫），但日曆體系指定西元曆。
  - **實作方式**：在 `src/lib/formatUtils.ts` 及 `DictionaryView.vue` 中，格式化日期時偵測若為 `th`，將 locale 替換為 `th-TH-u-ca-gregory`，完美保留泰文月日格式，同時錨定西元年份。

### 3. bigram 飄移守衛在泰文、越南文上的風險，要不要改 `Intl.Segmenter`？
- **核心結論**：**現行 bigram 在泰文一定會誤判暴斃！但不要改成 `Intl.Segmenter` 的 `word` 分詞，改用「字素簇（grapheme cluster）bigram + 保留 `\p{M}`」是最小改動且最穩健的解法。**
- **深度技術分析**：
  - **為什麼現行寫法會爆**：
    1. 泰文上下標母音與調號是 `\p{Mn}`，被現有正則洗掉後，語意結構徹底破壞。
    2. JavaScript 字串以 UTF-16 code unit 儲存。泰文一個可讀字（如 `กิ่`）包含 3 個 code points。用 `text.slice(i, i + 2)` 直接切碼元，會把一個泰文字活生生切成亂碼碎塊。
  - **為什麼不建議換成 `Intl.Segmenter(..., { granularity: 'word' })`**：
    1. 泰文斷詞在計算語言學上是著名的難題。Whisper 吐出的原始生稿常常有錯字或拼寫瑕疵，V8 內建的 ICU 字典分詞遇到錯字時的斷詞邊界會劇烈抖動；而 LLM 整理後的文字分詞邊界又截然不同，兩者的「word」集合很難比對。
    2. `Intl.Segmenter` 在 word 模式下需要載入並查詢字典，效能明顯慢於字元比對。
  - **小A 的 Ponytail 懶人妙解（Minimum Viable Code）**：
    - 將 `toBigramSet` 改為基於**字素簇（Grapheme Clusters）**的比對：
      ```ts
      function toGraphemeBigramSet(text: string, locale?: string): Set<string> {
        // 使用瀏覽器原生 Intl.Segmenter 以 grapheme（字素）切分，零依賴且完整保留泰文複合字
        const segmenter = new Intl.Segmenter(locale ?? "und", { granularity: "grapheme" });
        const graphemes = Array.from(segmenter.segment(text), s => s.segment);
        const set = new Set<string>();
        for (let i = 0; i < graphemes.length - 1; i++) {
          set.add(graphemes[i] + graphemes[i + 1]);
        }
        return set;
      }
      ```
    - `normalizeForOverlap` 加上 `.normalize("NFC")` 並將正則改為 `/[^\p{L}\p{N}\p{M}]/gu`。
    - 如此一來，泰文的每個完整音節字元都被視為一個單位，不需要複雜的斷詞字典，就能以極高正確率計算 bigram 重疊率，且門檻維持 0.2 不變。

### 4. 翻譯品質：沒有母語者的情況下，用什麼方式降低機翻錯誤（例如 glossary、回譯檢查）？
- **核心結論**：採用「**鎖定專有名詞 Glossary + 雙向回譯（Back-translation）驗證 + UI 上下文提示**」三道防線。
- **具體操作流程**：
  1. **建立 TypeK 關鍵術語鎖定表（Glossary Locklist）**：
     在發給小D 實作時，先定義好核心詞彙，不可隨意意譯：
     - **Hold to talk / 觸發鍵**：
       - vi：`Phím kích hoạt`、`Nhấn và giữ để nói`、`Nhấn một lần để bắt đầu`
       - th：`ปุ่มสั่งการ`、`กดค้างเพื่อพูด`、`กดเพื่อเริ่ม/หยุด`
     - **Prompt Modes（精簡 / 積極 / 自訂）**：
       - vi：`Tinh gọn` / `Tích cực` / `Tùy chỉnh`
       - th：`แบบกระชับ` / `แบบปรับแต่งเชิงรุก` / `กำหนดเอง`
     - **Transcription / 逐字稿**：
       - vi：`Bản chép lời`（或 `Bản gỡ băng`）
       - th：`ข้อความถอดเสียง`
  2. **自動化回譯檢查腳本（Back-translation Gate）**：
     在送出前，用 LLM 將產出的 `vi.json` 與 `th.json` 翻回繁體中文，比對語義漂移；並檢查是否有遺失變數插槽（如 `{count}`、`{hours}`、`{version}` 必須一字不差保留）。
  3. **拒絕脫離情境的單字直翻**：
     要求翻譯 prompt 時必須附帶 `en.json` 與 `zh-TW.json` 對照，並標明該字串出現在按鈕（動詞）、標籤（名詞）還是提示框（完整句子），杜絕將 "Hold" 翻成「抓住」或 "Custom" 翻成「風俗」的災難。

### 5. 還漏了哪些依語系的地方？
- 請參閱本報告第 1 章 `## 漏掉的地方`，完整涵蓋了型別宣告、vue-i18n 掛載、正則字素、日期格式化重複、字型堆疊宣告與 HUD 垂直行高等 10 項關鍵細節。

---

## 風險

### 1. Groq `whisper-large-v3` 對 vi／th 的轉錄品質
- **越南文**：總體辨識率不錯（WER 約 10-15%），但語速飛快時非常容易**遺失聲調（Tone drop）**，且在錄音結尾容易出現 YouTube 常見幻聽（例如「Cảm ơn các bạn đã theo dõi」、「Hãy like và subscribe」）。
- **泰文**：**屬於極高風險區！** Whisper 對泰文的辨識率在官方評測中名列倒數（WER 常超過 25%）。除了常見的英語借詞拼寫分歧外，最致命的是 **空格污染（Space Hallucination）**，Whisper 經常在原本連續的泰文字句中隨機塞入空格。
- **緩解對策**：AI 整理指示必須扛起後製校正責任：
  - 泰文 prompt 必須加入強規則：「絕對不要在泰文字詞之間加入空格，移除語音辨識產生的異常詞間空格，只在句號或話題轉換時保留空格」。
  - 越南文 prompt 必須加入強規則：「嚴格檢查並保留正確的越南文聲調符號，不得轉寫為無聲調文字」。

### 2. HUD 與 Sidebar 的泰文字型渲染與行高截斷（Line-Height Clipping）
- **泰文特有的「垂直四層高」結構**：
  - 上上層：調號（ไม้เอก ่, ไม้โท ้...）
  - 上層：母音（สระอิ ิ, สระอี ี...）
  - 中層：輔音基準線
  - 下層：母音（สระอุ ุ, สระอู ู...）
- **HUD 爆版與截字風險**：
  - `NotchHud.vue` 的預設高度固定為 42px，模式切換只有 36px，且外層套用了 `clipPath: buildNotchPath(...)`。
  - 泰文文字如果沒有給足夠的垂直緩衝，頂部的聲調符號會直接被瀏海切角（clip-path）切平，變成無調殘字！
  - `.hud-badge`（Line 816）設定為 `font-size: 10px; padding: 1px 6px;`。10px 的極致緊湊膠囊放英文/中文很精緻，放泰文必定切頭切腳。
- **側邊欄（Sidebar）**：
  - 泰文字元需要至少 `1.5` 到 `1.6` 的 line-height 才能保證上下符號不重疊。若側邊欄功能選單維持緊湊排版，文字折行時上下行會直接互咬（glyph collision）。

### 3. 字串長度引發的版面崩塌（String Length Explosion）
- **長度對照現實**：
  - 中文是表意文字，4 個字就能表達完整概念（例如「自訂字典」、「歷史記錄」）。
  - 越南文多音節展開後，長度通常是中文的 **1.8 ~ 2.5 倍**（「Từ điển tùy chỉnh」、「Lịch sử chuyển âm」）。
  - 泰文複合詞長度也是中文的 **1.8 ~ 2 倍**（「พจนานุกรมที่กำหนดเอง」）。
- **高危險版面破壞點**：
  - `MainApp.vue` 側邊欄底部 `SidebarFooter`：在 256px 寬度內，一邊塞版本號 `v0.14.1`，另一邊塞按鈕 `Kiểm tra bản cập nhật`（檢查更新）或 `Cài đặt ngay`（立即安裝）。這在中文剛好，在越文與泰文下會直接換行破版，把容器撐變形。
  - `SettingsView.vue` 模式切換 RadioGroup（`grid grid-cols-3`）：三欄等寬卡片放「精簡 / 積極 / 自訂」很整齊，換成「Tinh gọn / Tích cực / Tùy chỉnh」或泰文長句時，卡片文字會產生突兀的多行折疊。

### 4. 繽紛少女風（Option-D）與 vi／th 的風格相容性
- 目前全新導入的繽紛少女風（草莓奶昔、果凍氣泡、手帳貼紙美學）核心依賴 `SF Pro Rounded` 與 `Arial Rounded MT Bold` 等**圓角字型（Rounded Typography）**。
- **殘酷現實**：泰文系統字型（無論是 macOS 的 `Thonburi` 還是 Windows 的 `Leelawadee UI`）**全都是無襯線標準體，完全沒有圓角！**
- 如果在少女風的高飽和果凍按鈕與糖果進度條中，硬套生硬方正的預設字型，視覺上會有微妙的「公文感 vs 少女感」衝突。
- **對策**：在字型堆疊中，除了確保跨平臺 fallback 順暢外，泰文與越文應微調字重（`font-weight: 500` ~ `600`）與字母間距（`letter-spacing: 0.01em`），讓線條飽滿親和，融入果凍琉璃質感。

### 5. 既有使用者升級遷移（Migration）
- **設定檔鍵值相容**：
  - 既有使用者的 `settings.json` 已經存有 `selectedLocale` 與 `selectedTranscriptionLocale`。載入時 fallback 邏輯完整，不會被沖掉。
  - **唯一升級暗樁**：如果使用者本來設說話語言為 `auto`，介面語言選了 `vi`，而 `prompts.ts` 的 `getAutoLanguagePrompt` 缺少 `vi` 對應，首次使用語音會立刻噴出 runtime error。必須確保 `AUTO_LANGUAGE_RULES`、`EXPLICIT_LANGUAGE_RULES` 與 `TEMPLATE_MAP` 的 7 語系完整對稱。

---

## 建議修改

### 1. 實作順序調整（Dependency-first Pipeline）
原計畫將字型、守衛與提示詞放在後面，容易在前期開發時因型別報錯而卡住。建議調整為更平滑的 5 步流程：

```
Step 0: 前置清理
  - 徹底從計畫書刪除「hallucination_terms 幻聽詞庫」，嚴禁在已 drop 的資料庫動土。

Step 1: 基礎建設與型別安全閘
  - 修改 `src/i18n/languageConfig.ts`（擴充 SupportedLocale）
  - 修改 `src/i18n/prompts.ts:8`（修復 LEGACY_DEFAULT_PROMPTS 的型別，防止 vue-tsc 報錯）
  - 修改 `src/i18n/index.ts`（import 並註冊 vi.json, th.json，建立空殼物件防呆）
  - 調整 `src/lib/hallucinationDetector.ts`（正則加入 \p{M} 並加入 NFC 正規化）

Step 2: 字型堆疊與 UI 版面緩衝防護
  - 在 `src/style.css:186` 補上泰文與越文跨平臺字型宣告
  - 微調 `NotchHud.vue` 的 badge 與 HUD 垂直 padding，為泰文調號預留垂直安全裕度
  - 微調 `MainApp.vue` 側邊欄底部 flex-wrap 屬性，防止長字串溢位

Step 3: 介面翻譯實作與對稱性單元測試
  - 由小D 產出 `vi.json` 與 `th.json`（依據 Glossary 與 zh-TW 語意）
  - 撰寫自動化單元測試：驗證 7 語系 keys 集合 100% 相同、無空字串、變數插槽完全匹配

Step 4: AI 整理提示詞與 Whisper 前置詞修正
  - 補齊 `prompts.ts` 中 vi 與 th 的精簡、積極、編輯模式與語言規則
  - 修改 `whisperPrompt.ts`：越文補上專屬提示詞與英文詞標註，泰文設為 null（走字典詞模式），並修復中文標點 hardcode

Step 5: 日期格式統一與端到端驗收
  - 統一 `src/lib/formatUtils.ts` 與 `src/views/DictionaryView.vue`，泰文日期一律使用 `th-TH-u-ca-gregory`
  - 執行全套 `vue-tsc`、`pnpm test` 與真實畫面截圖驗收
```

### 2. 驗收標準（Acceptance Criteria）增補
在原有驗收項目之外，強烈建議追加以下 4 條鐵律：

1. **[視覺] 泰文上下標零裁切（No Vertical Clipping）**：
   - 介面切換至 `th`，在 HUD 處於錄音中、模式切換提示、錯誤顯示時，泰文之聲調符號（上上層）與下標母音（下層）絕不可被容器或 clip-path 裁切截斷。
2. **[版面] 側邊欄與設定頁長字串無破版（No Layout Break）**：
   - 在 720x480 最小視窗尺寸下，側邊欄底部（更新按鈕區塊）與設定頁快捷鍵模式切換按鈕，在 `vi` 與 `th` 語系下均不得產生文字溢位、橫向捲軸或標籤重疊。
3. **[守衛] 泰文與越南文不觸發假飄移（No False Drift Rejection）**：
   - 單元測試中加入真實泰文與越南文逐字稿校對案例，確認 `detectSemanticDrift` 不會因為無空格或聲調而將合法整理結果誤判為語意飄移（drift）。
4. **[編碼] 全程 Unicode NFC 正規化（Strict NFC Compliance）**：
   - 轉錄文字在進入 SQLite 資料庫與傳入 LLM 整理前，一律透過 `.normalize("NFC")` 統一，避免 NFD 分解調符造成字典搜尋失效。

---
REVIEW-RESULT: DONE