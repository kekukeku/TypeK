# 小 A 審查意見：語音轉錄多服務架構計畫（docs/plan-stt-providers.md）

> 審查者：小 A（峨嵋派三師姊 · UI/UX 負責人）✨  
> 查核日期：2026-10-26  
> 審查標的：`docs/plan-stt-providers.md`（v1 草稿）  
> 遵循規範：`.claude/rules/ui.md`、`.claude/rules/ipc.md`、`CLAUDE.md`、全域正體「臺」字規範。無吹捧、直指核心。

---

## 綜述

整體計畫方向清晰，滿足 Kevin 提出的「Groq／macOS 內建／BytePlus 三選一」需求。然而從 UI/UX 與前端狀態機架構檢視，本計畫存在**一項足以導致功能死鎖的重大連鎖漏洞（Groq 金鑰於文字整理卡失聯）**，以及**選擇器破壞 Option-D 對稱性**、**macOS 首次授權缺乏引導**、**版面跳動（Layout Shift）**等問題。

---

## 審查發現（Findings）

### [HIGH] 致命連鎖漏洞：當 STT 切換至 macOS 或 BytePlus 時，「文字整理」若選用 Groq 將失去金鑰輸入欄
- **位置**：`src/views/SettingsView.vue:1330-1335`、`docs/plan-stt-providers.md:124-129`
- **問題**：
  現有「文字整理」（LLM Card）中，當 `selectedLlmProviderId === 'groq'` 時，**並未提供任何金鑰輸入框**，而是寫死顯示提示：「使用語音轉錄的 Groq API Key」（讀取 `settingsStore.hasApiKey`）。
  若使用者將「語音轉錄」切換為 `macOS 內建`（免金鑰）或 `BytePlus`，語音轉錄卡將隱藏 Groq 金鑰欄。此時若使用者的文字整理欲使用 Groq（如 Qwen3.6 / Llama 免費模型），**整個設定頁將完全沒有任何地方可供輸入或修改 Groq API Key**，導致文字整理直接死鎖報錯。
  在歷史計畫 `docs/plan-elevenlabs-stt-provider.md:52` 中曾明確規範：「轉錄非 Groq 時 Groq 金鑰欄出現在這裡」，但本計畫完全遺漏此連鎖機制。
- **建議**：
  在「文字整理」卡中補充條件渲染：當 `selectedLlmProviderId === 'groq'` 且 `selectedSttProviderId !== 'groq'` 時，必須展開獨立的 Groq API Key 輸入欄位與儲存按鈕。

### [HIGH] STT 轉錄服務選擇器選型矛盾：下拉選單（Select）破壞與「文字整理」的視覺對稱與 Option-D 美學
- **位置**：`docs/plan-stt-providers.md:12, 125`、`src/views/SettingsView.vue:1309-1327`、`.claude/rules/ui.md:17-47`
- **問題**：
  計畫規劃「最上方多一個『轉錄服務』選單：Groq（預設）、macOS 內建、BytePlus」。若使用 `<Select>` 下拉選單，會與下方「文字整理」卡的 `<RadioGroup>` Option-D 卡片網格（`grid grid-cols-2 sm:grid-cols-4`，帶 `shadow-jelly` 與果凍漸變邊框）產生嚴重的視覺不對稱。
  STT 服務僅 2～3 個選項（Mac 上 3 個、Windows 上 2 個），下拉選單不僅增加一次點擊成本，更讓兩大核心卡片風格割裂。
- **建議**：
  語音轉錄卡最上方應比照文字整理卡，採用 Option-D 風格的 `<RadioGroup>` 卡片網格：
  - Mac 呈現 3 欄（`grid grid-cols-3 gap-3`），Windows 呈現 2 欄（`grid grid-cols-2 gap-3`）。
  - 選項卡內含清晰識別與小標：
    - **Groq**（預設）：`每日 8 小時免費 · 極速 LPU`
    - **macOS 內建**（Mac 獨占）：`系統內建 · 免金鑰 0 佔用`（可加 `badge-jelly` 標示）
    - **BytePlus**：`繁中最佳 · 華語地表最強`

### [HIGH] 新手引導（Onboarding Hint）與狀態徽章（Status Badge）未與 Provider 解耦
- **位置**：`src/views/SettingsView.vue:364-372, 1132-1138, 1153-1158`、`docs/plan-stt-providers.md:124-129`
- **問題**：
  1. 現有 `shouldShowOnboardingHint` 直接綁定 `!settingsStore.hasApiKey`。若新使用者選擇「macOS 內建」，頁面仍會跳出「首次使用請先至 Groq 取得免費 API Key」的引導框，造成強烈困惑。
  2. 卡片標題旁的狀態徽章 `apiKeyStatusLabel`（「已設定」/「未設定」）亦直接綁死 Groq Key。切至 macOS 內建時顯示「未設定」為嚴重錯誤；切至 BytePlus 時若 Groq 有 Key 也會誤標「已設定」。
- **建議**：
  - `shouldShowOnboardingHint` 必須改為：`selectedSttProviderId === 'groq' && !settingsStore.hasApiKey`。BytePlus 則對應專屬引導。macOS 內建絕不顯示申辦金鑰引導。
  - 將徽章重構為 `sttStatusBadge`：
    - Groq：已設定 / 未設定
    - BytePlus：已設定 / 未設定
    - macOS 內建：免金鑰（就緒）/ 需授權（未授權時）

### [MED] macOS 內建語音辨識之首次授權流程（Permission UX）過於隱晦，易造成錄音中斷與卡死
- **位置**：`docs/plan-stt-providers.md:94, 101, 128`
- **問題**：
  計畫僅規劃在 Rust/Swift 端以 `DispatchSemaphore` 等待 `requestAuthorization`。若使用者從未點擊「測試連線」，而是在按住熱鍵錄音放開後才觸發首次辨識，macOS 會突然彈出系統 Modal 權限詢問視窗，奪取焦點並破壞放開即貼上的狀態機，導致初次體驗失敗。且若使用者誤按「不允許」，macOS 永遠不再彈窗。
- **建議**：
  1. 在設定頁切換至 macOS 內建時，主動檢查授權狀態（未授權 / 已授權 / 已拒絕）：
     - **未決定**：提供顯眼的「點此授權語音辨識」按鈕，讓使用者在設定階段即完成系統授權。
     - **已拒絕**：以 Alert 樣式呈現警告，並提供「前往系統設定」按鈕（深層鏈接：`x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition`）。
  2. 點擊「測試連線」時亦主動觸發授權檢驗與狀態刷新。

### [MED] 模型與語言選單的版面跳動（Layout Shift）與不對稱
- **位置**：`docs/plan-stt-providers.md:126-129`、`src/views/SettingsView.vue:1219-1266`
- **問題**：
  目前版面為雙欄網格 `grid sm:grid-cols-[1.4fr_1fr]`（左邊轉錄模型，右邊轉錄語言）。
  BytePlus 與 macOS 內建均無模型切換需求。若左側模型選單直接銷毀，右側語言選單會突然拉寬或留白，造成切換時的劇烈版面跳動（Jank）。
- **建議**：
  維持雙欄骨架不變。在 BytePlus 與 macOS 模式下，左側改為**唯讀的模型資訊展示元件**：
  - BytePlus：顯示標籤「模型引擎」，內容為 `Seed Speech 2.0 (AUC Turbo)`，副標「極速雲端大模型」。
  - macOS 內建：顯示標籤「辨識架構」，內容為 `Apple Speech (SFSpeechRecognizer)`，副標「端側優先 · 系統聽寫」。
  右側統一放置「轉錄語言」選單，確保幾何佈局完全穩定。

### [MED] BytePlus 與 macOS 說明文案與引導細節不足
- **位置**：`docs/plan-stt-providers.md:127-128`
- **問題**：
  1. **BytePlus 金鑰混淆防範**：BytePlus 主控台結構極為複雜，極易誤創 ModelArk（LLM）金鑰而非 Seed Speech 金鑰。文案必須明確提示：「請至 BytePlus Seed Speech 主控台建立 API Key（非 ModelArk 金鑰）」。
  2. **隱私揭露文案**：「錄音音訊將傳輸至 BytePlus 新加坡節點進行即時轉錄處理，音訊不留存於本平臺。」
  3. **macOS 離線套件指引**：應提示「如需純離線辨識，請至 macOS『系統設定 → 鍵盤 → 聽寫』確認已下載離線語言套件。」

### [MED] 錯誤轉譯覆蓋度（`errorUtils`）與狀態碼缺口
- **位置**：`docs/plan-stt-providers.md:108, 130`
- **問題**：
  計畫僅覆蓋 401、`45000010`、`NOT_AUTHORIZED`、`LOCALE_UNSUPPORTED`。遺漏以下常見場景：
  1. BytePlus 帳號欠費或額度用盡（`45000011` / `45000005`）：應轉譯為「BytePlus 帳號額度不足或欠費」。
  2. BytePlus 跨海連線超時：應轉譯為「BytePlus 語音服務連線超時，請檢查網路連線」。
  3. Apple 辨識超時（Code 4 `TIMEOUT`）：應轉譯為「macOS 語音辨識超時，請重試或改用 Groq」。

### [MED] `no_speech_probability` 改 `Option` 之歷史紀錄與展示層連帶影響
- **位置**：`docs/plan-stt-providers.md:68-71, 122`
- **問題**：
  計畫注意到了 `src/types/audio.ts` 與 `hallucinationDetector` Layer 2b，但遺漏了：
  - `src/stores/useHistoryStore.ts` 與 `HistoryView.vue`：歷史記錄詳情彈窗或列表若有讀取或計算 `noSpeechProbability`，需確保處理 `null`（顯示為 `n/a` 或隱藏該指標），避免 runtime 報錯。

### [LOW] 歷史紀錄與用量分帳之模型 Display Name 對照
- **位置**：`docs/plan-stt-providers.md:123`
- **問題**：
  歷史紀錄寫入 `apple-speech` 與 `seed-asr-fast`。在 UI 上不應直接顯示 raw string，應於 `modelRegistry.ts` 或 i18n 提供本地化友善名稱（如「macOS 系統語音」、「BytePlus Seed Speech」）。

### [LOW] 全域正體中文「臺」字用字合規查核
- **位置**：全計畫文件及後續文案
- **提醒**：
  在新增的 i18n 翻譯（`zh-TW`）、註解與 UI 文案中，凡提及「臺」字（如「臺灣」、「平臺」、「後臺」），務必嚴格遵循全域正體字原則寫作「臺」，嚴禁出現俗體「台」。

---

## 計畫待決 6 大問題具體回答

### 1. Apple 用 `SFSpeechRecognizer` 還是 `SpeechAnalyzer`？本機沒下載時退回 Apple 線上還是直接報錯？
- **解答**：
  - **堅決採用 `SFSpeechRecognizer`**：`SpeechAnalyzer` 僅限 macOS 26+，目前生態過新、缺乏字典詞注入（`contextualStrings`）之確認規範。`SFSpeechRecognizer` 成熟穩定，支援 macOS 10.15+，完美支援字典注入。
  - **本機未下載語言套件時，務必「退回 Apple 線上辨識」！絕不要直接報錯**。
    Kevin 的訴求是「不佔空間，無論選擇哪一個都可以」。若因未下載語言套件就硬性報錯，絕大多數 Mac 使用者會遭遇失敗體驗。由系統自動 fallback 至 Apple 官方免費伺服器轉錄，是最平滑且零負擔的體驗。

### 2. `build.rs` 用 `swiftc` 產靜態庫在 GitHub Actions `macos-latest` 交叉編 x86_64 會不會出問題？
- **解答**：
  - **高風險點**：GitHub Actions 的 `macos-latest` 現已全面改為 Apple Silicon（arm64）runner。在 arm64 上執行 `swiftc -target x86_64-apple-macos10.15` 雖為 Xcode 支援之行為，但 Swift runtime 庫路徑（`usr/lib/swift/macosx`）在不同架構下路徑極易出錯。
  - **防護措施**：在 `build.rs` 中，必須精確解析 SDK 路徑並透過 `cargo:rustc-link-search=native` 注入完整的 Swift toolchain 庫路徑；且在 CI 的 `rust-check` 工作流中，必須同時測試 `--target aarch64-apple-darwin` 與 `--target x86_64-apple-darwin`。

### 3. BytePlus 欄位有沒有漏或錯？
- **解答**：
  - 經查核官方最新規範與 VolcEngine 規範：
    1. `output_zh_variant: "tw"` **完全正確**（官方規範值為 `tw`、`hk`、`traditional`，`tw` 為臺灣繁體標準）。
    2. `corpus.context` 採用 `{"hotwords":[{"word":"..."}]}` JSON 字串 **完全正確**。
    3. `X-Api-Sequence: -1` 用於一次性非串流請求 **完全正確**。
    4. 回應解析時，`result` 在特定錯誤或特定模型下可能為 Object 而非 Array，解析端應相容 `result.text` 與 `result[0].text` 雙結構。

### 4. `no_speech_probability` 改 `Option` 的連帶影響是否列齊？
- **解答**：
  - 核心呼叫鏈與幻覺守衛已列出。
  - 補遺：需同步檢查 `HistoryView.vue`、`useHistoryStore.ts` 中對歷史紀錄記錄項的渲染，確保對 `null` 做安全過濾。

### 5. 設定頁三家切換的版面（小A）：要不要先出拍板 demo？
- **解答**：
  - **小 A 結論：強烈建議「必須先出拍板 HTML demo」！**
  - **理由**：
    1. 符合專案規則（`.claude/rules/ui.md:13-16`）：大改動或涉及狀態切換的版面，以拍板 demo 作為規格的一部分，避免文字與實作落差。
    2. 本次涉及三種截然不同的控制項狀態組合（Groq: Key+Model；BytePlus: Key+Info；macOS: Auth+Info），且下方文字整理卡需動態連動展開 Groq Key。
    3. 先行製作一份輕量 HTML demo（如 `docs/demos/stt-providers/settings-stt-providers.html`），讓 Kevin 在本機瀏覽器親自點擊切換、確認版面視覺完全符合 Option-D 美學後再發工，能節省後續反覆修改 Vue 元件的工時。

### 6. 漏了哪些呼叫點或測試？
- **解答**：
  1. **重送路徑（Retranscribe）**：除了即時錄音（`transcribe_audio`），HUD 介面的「重送」（Retry with new parameters）與歷史頁面「重新辨識」（`retranscribe_from_file`）必須確認皆正確攜帶 `provider` 與對應 API Key。
  2. **跨視窗同步（Cross-window Broadcast）**：`useSettingsStore` 中的 `selectedSttProviderId` 與 `byteplusApiKey` 必須加入 `SETTINGS_UPDATED` 廣播與接收清單，確保 MainApp、HUD 與 Settings 視窗即時同步。
  3. **測試案例補遺**：
     - 前端測試：當切換至非 Groq 時，LLM 選擇 Groq 是否正確顯示金鑰輸入框。
     - 前端測試：當非 Mac 平臺時，`selectedSttProviderId` 強制 fallback 至 `groq` 且不崩潰。

---

審查完成標記：`DONE_STT_PLAN_REVIEW`
