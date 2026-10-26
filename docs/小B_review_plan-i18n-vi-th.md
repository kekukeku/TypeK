我先讀計畫與 i18n 相關程式，對照每個語系接入點，只做審查、不改檔案。審查結論已齊，我先把可復用的結論寫進工作紀錄，接著給完整審查。範圍不完整。主路徑（`SupportedLocale`、兩份 JSON、整理指示、Whisper 碼、日期）有寫到，但有幾處會讓 `vue-tsc` 全綠、功能仍是錯的，也有一項指到已經刪掉的表。

## 漏掉的地方

[HIGH] `src/i18n/index.ts:13` — `messages` 是手寫物件，不是 `Record<SupportedLocale, …>`。只加 `vi.json`／`th.json`、不在這裡 import，介面會整頁落到 `fallbackLocale: "en"`（同檔第 12 行）。`.claude/rules/i18n.md:10` 寫的「少 key 會顯示 key 名」在這個 fallback 下不成立，截圖看起來像夾雜英文，不會出現 key。

[HIGH] `src/lib/database.ts:353` — `hallucination_terms` 在 v6→v7 已 `DROP`。第 314 行只是歷史 migration，執行期沒有依 locale 的幻聽詞表。現在的偵測是 `hallucinationDetector.ts` 的能量與語速。計畫第 4 節「為 vi、th 補幻聽句」沒有落地點；為它再做一次 migration，既有使用者會多一次沒有讀者的 schema 變更。

[HIGH] `src/lib/hallucinationDetector.ts:180` — Layer 1 用 `trimmedText.length > 10` 且錄音不到 1 秒就當幻聽（門檻在第 16 行）。這是 UTF-16 碼元。越南文十個字母、泰文一句「สวัสดีครับ」都過得了這個門檻，正常短句會被丟掉。計畫第 6 節只寫了 bigram。

[HIGH] `tests/unit/i18n-settings.test.ts:263` — 現測斷言 `navigator.languages = ['th']` → `zh-TW`。計畫的「首次啟動 vi／th 落在對應語系」會直接讓這條變紅。同檔第 134 行要求 `TRANSCRIPTION_LANGUAGE_OPTIONS` 長度 7（auto + 5 + 粵語），第 85、121 行的 whisper 碼表沒有 vi／th，第 407 行只比對五個 JSON。計畫寫「新增七語系測試」，沒有寫要改這幾條既有斷言。

[MED] `src/i18n/prompts.ts:8` — `LEGACY_DEFAULT_PROMPTS` 的型別是 `Record<SupportedLocale, string>`。計畫說新語系不補舊預設，型別仍會失敗。要把這個 Record 收成原來的五語系，不能改成可能含 `undefined` 的 `Partial`，否則 `isKnownDefaultPrompt`（第 484 行）對 value 呼叫 `trim()` 會炸。

[MED] `.claude/skills/typek-release/SKILL.md:29` — 把「五語系」改成「七語系」不夠。流程是「翻譯 4 語」（第 186、212 行），檔案清單寫死五個 JSON（第 161–167 行），sanity check 也寫 5 個檔（第 229、238 行）。另外 skill 寫的 key 是 `mainView.upgradeNotice`，執行中的 key 是 `mainApp.upgradeNotice`（`src/i18n/locales/zh-TW.json:446`、`src/MainApp.vue:376`）。

[MED] `docs/development-guide.md:175`、`docs/development-process.md:83`、`CLAUDE.md:15` — 這三處是之後改字串的食譜，仍寫五語系。`docs/index.md:196`、`docs/architecture-frontend.md:206`、`docs/data-models.md:171` 是文件漂移，優先級低。`_bmad-output/**` 與舊的 `docs/plan-*.md` 不要回頭改。

[MED] `src/lib/formatUtils.ts:16` 與 `src/views/DictionaryView.vue:177` — 兩處各自把語系丟進 `Intl`，沒有共用 helper。只改 `formatUtils` 的話，字典頁的 `toLocaleDateString(locale.value)` 仍是 `th`，佛曆還在。`formatUtils.ts:62` 的數字格式走同一條 `currentLocale()`。

[MED] `src/lib/whisperPrompt.ts:33` — 詞與詞用「、」接，前綴在第 45 行寫死「剛才提到／刚才提到」。vi／th 若要前置句，連接詞與前綴要分開，不能沿用這兩行。

[MED] `src/components/NotchHud.vue:69` — HUD 本體高 42px，用 clip-path 裁切；`mode-switch` 只有 36px（第 78 行）。狀態字 `white-space: nowrap`（第 708、749、763 行），錯誤列再加 ellipsis（第 857 行）。側邊欄按鈕是 `h-8` 加 `overflow-hidden` 與末子 `truncate`（`src/components/ui/sidebar/index.ts:39`、`:48`），欄寬 `16rem`（`src/components/ui/sidebar/utils.ts:6`）。表單標籤是 `leading-none`（`src/components/ui/label/Label.vue:19`）。計畫只寫「測不被截」，沒有點到這些固定高度。

[LOW] `src/lib/formatUtils.ts:28` — `text.slice(0, maxLength)` 會切在泰文字素中間，歷史列表的截斷可能留下半個母音。

[LOW] `src/stores/useVoiceFlowStore.ts:1673` — 編輯模式 prompt 跟介面語言，不跟說話語言。驗收若寫成「說話語言 vi 時編輯指示也是越南文」，會驗到現行設計之外。

[LOW] `src/components/ui/chart/ChartTooltipContent.vue:98` — `toLocaleString()` 沒帶 app locale，圖表數字跟系統語系走。既有行為，這次可以不動。

可以拿掉的：

- 幻聽詞庫與任何新 migration。能量門檻與語言無關，靜音幻聽已經被 Layer 2 擋住。
- 把 `transcriptTextTransforms.ts:19` 的簡轉繁擴到 vi／th。那條只該留在 `zh-TW` 與 `yue`。
- 把 Thonburi 放進全域字型第一位。`src/style.css` 沒有自訂 `font-family`，走 Tailwind 的 `system-ui`。macOS 會回退到泰文字型；Thonburi 在 Windows 不存在，放前面還會影響拉丁字母。品牌字「TypeK」（`src/MainApp.vue:279`）與計時器的 JetBrains Mono（`NotchHud.vue:831`）都不必為 vi／th 改。
- 為 vi／th 補 `LEGACY_DEFAULT_PROMPTS`，以及改 `tests/support/fixtures/builtin-prompts-v0.14.1.ts`。
- 把 `Intl.Segmenter` 當這次必改（見問題 3）。
- Rust `transcription.rs:212` 沒有語言白名單，`language` 原樣送出。這裡不用改。

## 五個問題的回答

1. Whisper 前置句：要準備句子，但是先探針再決定要不要上。比照粵語那次，用 Groq `whisper-large-v3` 各打一發，確認 HTTP 200、語言標籤是 Vietnamese／Thai，而且靜音不會把前置句回吐出來。Whisper 把 prompt 當前一段逐字稿，前置句太長會被原樣幻聽。探針失敗就維持 `null`，跟 en／ja／ko 一樣走 Rust 的 `Important Vocabulary:`。

探針用的草案（還沒有母語者聽過，只保證是口語、不是指令）：

- vi：`Đây là lời nói tiếng Việt, có xen tiếng Anh, tên riêng tiếng Anh giữ nguyên cách viết.` 有詞時接 `Vừa nhắc đến `，詞與詞用 `, `，句尾 `.`。
- th：`นี่คือคำพูดภาษาไทยที่ปนภาษาอังกฤษ ชื่อเฉพาะภาษาอังกฤษคงการสะกดเดิม` 有詞時接 `เมื่อกี้พูดถึง `，詞與詞用空格。不要用「、」，不要加 `。`。

`WHISPER_PROMPT_TERM_CHAR_BUDGET`（80 字元）可以沿用。英文前綴 `Important Vocabulary:` 會把模型往英文拉，所以探針過了就該用目標語言那句，而不是繼續回 `null`。

2. 泰文日期用西元。同一個歷史紀錄不該在介面切到泰文時從 2026 變成 2569。`Intl` 的 `th` 預設日曆是佛曆。兩處都改走同一個 helper，標籤用 `th-TH-u-ca-gregory-nu-latn`：鎖西元，也鎖西方數字。vi 維持 `vi`，它本來就是西元。上線前在 macOS WebKit 與 Windows WebView2 各看一次歷史時間與字典日期，確認年份是 2026、數字是 0–9。

3. bigram 這次不要改成 `Intl.Segmenter`。`normalizeForOverlap`（`hallucinationDetector.ts:110`）用 `/[^\p{L}\p{N}]/gu` 會先刪掉 Mn。泰文聲調與上下標母音是 Mn，現行 bigram 看的是剩下的字母，不是被聲調切開的碼元。計畫擔心的「組合字元把窗口錯開」在這段程式裡不會發生。

真正要補的是進正則之前 `normalize("NFC")`。越南文若以 NFD 進來，聲調是組合標記，會被同一條正則刪掉，比對落到無聲調骨架。

門檻 `0.2`（第 97 行）很鬆。只改標點、只改泰文聲調、只改少數越南文聲調，都不該掉下去。會掉下去的是整段譯成另一種語言。泰文刪掉母音之後，不同句子的輔音骨架可能仍重疊，這是漏放（false negative），不是誤殺；中文在這個門檻下本來就偏漏放。

驗收加三則 fixture 即可：只加標點仍高於 0.2、整段英文低於 0.2、只改聲調仍高於 0.2。字素 bigram 留到有誤殺樣本再做。`Intl.Segmenter` 的詞粒度對泰文還依賴字典，這次不分支。

4. 母語者校對可以留到上線前，這次 PR 仍要有機器能擋的檢查，否則 490 行就是沒人看過的機翻。

- 先寫一份約 30 詞的對照，從 zh-TW 出發：剪貼簿、貼上、逐字稿、自訂字典、快捷鍵、整理、錄音。TypeK、API、Whisper 不翻。vi／th 的 JSON 與 prompt 都用這份，不從 en 二翻。
- 另一個模型回譯成 zh-TW，Kevin 只看對不上的段落。
- 測試除了 key 集合與非空字串，還要鎖定插值 token 一致：`{count}`、`{hours}`、`{minutes}`、`{version}`、`{terms}`、`{provider}`、`{target}`、`{error}`、`{limit}`。
- vi 的值不得出現漢字（TypeK 例外）。th 的值以泰文為主。th 出現「泰文字＋空格＋泰文字」就失敗，這是機翻最常犯的加空格。
- 整理指示不要逐條翻譯 zh-TW 模板。第 4–6 條的全形標點、中英之間加空格，對越南文與泰文是錯的。vi 從 en 那種已有空格的結構改寫，並寫明保留聲調、不要改成無聲調。th 寫明詞間不加空格、不加句號；拉丁詞前後可以留一個空格。贅詞清單裡，vi 的「thì là」、th 的「นะ」有語法作用時要留，跟 zh-TW 對「其實、然後」的例外同一條原則。

5. 漏掉的執行期位置就是上一節那些 HIGH／MED。另外兩件計畫沒寫、但不該做成新工作：既有使用者的 `selectedLocale` 不用遷移（見風險）；`src-tauri` 不用改語言清單。

## 風險

Whisper。`whisper-large-v3` 的語言表含 `vi` 與 `th`，Groq 這條路徑會原樣送出（`transcription.rs:212`）。品質仍弱於英文與中文。越南文常見少聲調、南北用詞混。泰文常見聲調錯、母音錯、多插空格。這個 repo 已經看過 `whisper-large-v3-turbo` 把粵語聽成偏普通話（`docs/plan-cantonese-option.md:46`），vi／th 也該預設 large-v3。驗收要有一發真實請求，不能只斷言 query 帶 `language=vi`。前置句的回吐風險見問題 1。Layer 1 的 10 字元門檻會在辨識成功之後把短句丟掉，這比模型 WER 更先傷到使用者。

泰文渲染。一般段落在 WebKit 與 WebView2 會斷行，問題在固定高度。側邊欄 `h-8` 加 `overflow-hidden` 會切掉上下標；`leading-none` 的 Label 也會。HUD 的 42px／36px clip-path 會切上下標，`nowrap` 會把變長的越南文切掉右半邊。側邊欄 16rem 裡，「儀表板」「自訂字典」「功能介紹」的越南文（例如 bảng điều khiển、từ điển tùy chỉnh）會被 `truncate` 吃掉，看起來像爆版。字型方面越南文拉丁字母在 SF／Segoe 裡就有；泰文在 Windows 要靠 Leelawadee UI 這類系統回退，不要內嵌 Thonburi。

字串長度。最長的是功能介紹（`zh-TW.json:456` 一帶）與設定說明，這些會折行，風險是按鈕與側邊欄。最短、又不准折行的是 HUD：`voiceFlow.cancelled`、`vocabularyLearnedLabel`、`pasteFailed`、錯誤列。設定頁介面語言選單是 `w-48`（`SettingsView.vue:2057`），「Tiếng Việt」與「ไทย」放得下；說話語言選單是 `w-full`（第 1372 行），沒有這個問題。

Prompt 規則。泰文無空格：若把 zh-TW「中英文之間加空格」翻過去，模型會在每個泰文詞中間插空格，bigram 正規化會把空格刪掉所以守衛不一定擋，貼上的文字已經是壞的。越南文聲調：模型若輸出無聲調，`ệ` 與 `e` 的 bigram 不同；少量修正過得了 0.2，整段去聲調有機會被守衛退回原文。那是可接受的退回，前提是 prompt 明白寫了要留聲調。編輯模式仍看介面語言。

既有使用者。`useSettingsStore.ts:259` 只在沒有 `selectedLocale` 時才偵測系統語言，升級不會把已存的 zh-TW 改成 vi／th。第 1479 行的跨視窗重新載入同樣只讀已存值。不要寫「依 OS 重設語系」的遷移。降版後若 store 裡已是 `vi`，舊版沒有這個 messages，會落到英文 fallback，這可以接受。自訂 prompt 不會被新語系的預設覆寫；只有仍等於已知預設、又把說話語言切到 vi／th 時，才會換成新預設，這是現有行為。

## 建議修改

實作順序從「等繽紛少女風」改成兩段。該套版還在 `docs/demos/ui-refresh/`，設定頁與側邊欄的正式樣式還沒進 `src/`。語系型別、JSON、prompt、測試不要等它。等它的只有截圖與行高，而且套版落地後要再看一次。

建議順序：

1. `SupportedLocale`、`LANGUAGE_OPTIONS`、`index.ts` 註冊、`LEGACY_DEFAULT_PROMPTS` 收窄型別。同一批改掉 `i18n-settings.test.ts`：`th`／`vi-VN`／`th-TH` 落到 vi／th，選項長度改 9，whisper 碼補 vi／th，key 測試改七檔。`vue-tsc` 這時會列出 prompt Record 缺的鍵。
2. vi／th JSON，帶對照表、回譯差異、key／非空／插值 token／文字系統檢查。
3. 整理指示：vi、th 的精簡、積極、編輯，以及明確與自動語言規則。不逐譯 zh-TW 的標點條款。
4. `getIntlLocale()`，`formatUtils` 與 `DictionaryView` 一起用。泰文為 `th-TH-u-ca-gregory-nu-latn`。
5. Layer 1 依文字系統分門檻：越南文用詞數，泰文不要用 10 個碼元；中文門檻維持，避免放掉既有中文幻聽。補 NFC 與三則 drift fixture。
6. Groq 探針。過了才把前置句寫進 `whisperPrompt.ts`，並換成該語言的前綴與連接詞。
7. 套版之後再修 HUD、側邊欄 `h-8`、`leading-none`，並截設定頁、側邊欄、功能介紹、HUD 錯誤與「新增字典」。macOS 與 Windows 各一次。

驗收在現有四條上補：七檔插值 token 相同；`detectSystemLocale` 的 th 不再期望 zh-TW；說話語言 vi／th 時整理指示是該語言，編輯模式仍跟介面語言；Layer 1 不擋一句正常的越南文／泰文短句；drift 三則 fixture；一發 large-v3 探針（200 且語言標籤正確）。「介面 7 項、說話 9 項」這個數字是對的，粵語留在最後。

幻聽詞庫整項從範圍刪掉。

REVIEW-RESULT: DONE
