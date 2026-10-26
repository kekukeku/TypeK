# 計畫：1.3.3 修正批次

> **狀態：定稿 v2（2026-10-26），交小D 實作，Claude 檢驗。** 小A 建議：`docs/小A_advice_1.3.3.md`（下方「v2 定稿決定」優先於各節原文）。
> 1.3.2 未公開（Apple Silicon 打包排不到機器、已取消），本批與 1.3.2 的內容（自簽憑證）一起以 1.3.3 發出。

## 需求（Kevin，2026-10-26，原文摘要）

1. 麥克風改成按按鈕才測試
2. Groq 預設整理模型 `qwen/qwen3.6-27b` 已下架（404），選 Groq＋預設模型時整理一律失敗、默默貼原文；改成 `qwen/qwen3.8-27b`（Kevin 實測同參數可用，約 0.47 秒）
3. Groq 的 `gpt-oss-120b` 整理效果最好，但不知耗 token 多少、會不會很快用完免費額度；讓使用者可以選，不強制
4. 作者從 `kekukeku` 改成 `Kevin Kuo`
5. 開啟「隱藏 Dock 圖示」後仍在 Dock，沒有只留在選單列
6. 每次轉錄輸出後文字也留在剪貼簿；不要自動放剪貼簿，若一定要用剪貼簿貼上，貼完要還原使用者原本的剪貼簿內容
7. （之前記下）「更新摘要」開著時不要再跳「更新已就緒」，避免兩個視窗疊住、按不動

## v2 定稿決定（採用小A 建議，與下方各節衝突時以這裡為準）

- **整理失敗提示不限頻**：每次 AI 整理失敗、貼上原文時，HUD 都顯示 2 秒「已貼上原文（AI 整理失敗）」，琥珀色提示圖示（不是紅色錯誤）。若歷史紀錄已有可標記的欄位（例如 `wasEnhanced=false` 搭配既有欄位），在歷史列表顯示小徽章「未整理」；沒有現成欄位就不加 DB 欄位
- **麥克風按鈕**：放在「輸入裝置」卡第二列（裝置選單下方）。閒置 `variant="outline"`「測試麥克風」（Mic 圖示）；測試中「停止測試（N 秒）」倒數；音量條只在測試中出現，高度 `h-2`、`rounded-full`，填色用既有語意漸層（`from-primary to-chart-4` 類，僅用專案已有的語意 token）。失敗時顯示「無法開啟麥克風，請檢查麥克風權限或換一個輸入裝置」，macOS 加「打開系統設定」按鈕（開麥克風隱私權頁）
- **Groq 額度估計**：模型下拉選單每個 Groq 項目加徽章「約 N 次/天」，選定後說明行補「每日免費額度約可整理 N 次（以一般口述長度估計，每日重置）」；估計公式寫在 `modelRegistry.ts` 的純函式並有單元測試
- **隱藏 Dock 說明**：「開啟後 TypeK 只出現在螢幕上方的選單列，⌘Tab 也不會顯示；從選單列圖示開啟主視窗」。切到 Accessory 後若主視窗開著，立即 `show()`＋`set_focus()`
- **剪貼簿開關文案**：標題「轉錄後把文字留在剪貼簿」；說明「關閉（建議）：貼上後自動還原你原本複製的內容（文字、圖片、檔案）」「開啟：轉錄文字會留在剪貼簿，可再按 ⌘V 貼一次，但會蓋掉原本複製的內容」。還原延遲沿用 `clipboard_paste.rs` 現有值，不另調整，程式註解寫明競態原因
- **對話框互斥**：`MainApp.vue` 用一個「是否有全域對話框開著」的 computed（更新摘要、AccessibilityGuide、手動／自動更新、安裝位置），自動更新下載完成時若有任何一個開著，就等它們都關閉後再跳「更新已就緒」

## 範圍

### 1. 麥克風測試按鈕（`src/views/SettingsView.vue`、`src/composables/useAudioPreview.ts`）

- `onMounted` 不再 `startPreview`；切換裝置、重新整理裝置清單時，只有「正在測試」才用新裝置重開，否則不開
- 「輸入裝置」卡加按鈕：閒置「測試麥克風」，測試中「停止測試」；音量條只在測試中顯示
- 測試 10 秒自動停止；離開設定頁一定停止（沿用 `onBeforeUnmount`）
- `startPreview` 失敗要回報，按鈕旁顯示「無法開啟麥克風」
- 七語系新增：`settings.audioInput.testMic`、`stopTest`、`testFailed`（zh-TW「測試麥克風」「停止測試」「無法開啟麥克風，請檢查麥克風權限或換一個輸入裝置」）
- 測試：掛載不呼叫 `startPreview`；按下才呼叫；10 秒後呼叫 `stopPreview`

### 2. Groq 預設模型換成 `qwen/qwen3.8-27b`（`src/lib/modelRegistry.ts`）

- `LLM_MODEL_LIST`：把 `qwen/qwen3.6-27b` 那筆改成 `id: "qwen/qwen3.8-27b"`、`displayName: "Qwen3.8 27B (Preview)"`，其餘欄位沿用（價格、免費額度數字**未確認**，沿用舊值並在註解標「沿用 3.6，待查證」），`isDefault: true` 保留
- `LlmModelId` 型別同步
- `DECOMMISSIONED_MODEL_MAP`：加 `"qwen/qwen3.6-27b": "qwen/qwen3.8-27b"`；原本指向 `qwen/qwen3.6-27b` 的舊 id 全改指向 `qwen/qwen3.8-27b`。已存舊 id 的使用者載入時自動遷移
- 搜尋全專案 `qwen3.6` 一併更新（測試、文件、i18n）
- 測試：`getEffectiveLlmModelId("qwen/qwen3.6-27b") === "qwen/qwen3.8-27b"`；Groq 預設模型是 3.8

### 2b. 整理失敗要讓使用者看得到

- 現在 AI 整理失敗（例如模型 404、金鑰錯）會默默貼原文。改成：貼上原文照舊，但 HUD 顯示一則短提示「AI 整理失敗，已貼上原文」，並在 Dashboard／歷史那筆標記失敗原因（沿用既有錯誤轉譯；若已有欄位就用，沒有就只做 HUD 提示，不加 DB 欄位）
- 同一個原因（例如模型 404）每次執行 App 只提示一次，避免每句話都跳

### 3. `gpt-oss-120b` 給使用者選（已在清單，補資訊）

- `openai/gpt-oss-120b` 已在 Groq 模型清單（`modelRegistry.ts` 約 135 行），不是預設。確認它在設定頁的 Groq 模型選單可選
- 在模型選單的每個 Groq 模型下方顯示一行「免費額度約可整理 N 次／天」，N 由 `freeQuotaTpd ÷ 每次整理估計 token 數` 算出（估計值：精簡指示＋字典＋上下文約 900 token 輸入、輸出約與原文等長；gpt-oss 是推理模型，現行已送 `reasoning_effort: "low"`（`src/lib/llmProvider.ts` 約 153 行），另加 300 token 推理估計）。文字註明「估計值，實際依句子長短而定」
- 不改預設、不強制

### 4. 作者名稱改成 Kevin Kuo

- `src/views/SettingsView.vue` 關於卡：連結文字 `kekukeku` → `Kevin Kuo`（連結網址維持 `https://github.com/kekukeku`）
- `LICENSE`：`Copyright (c) 2026 kekukeku (TypeK modifications)` → `Copyright (c) 2026 Kevin Kuo (TypeK modifications)`；原作者 SayIt 那行不動（MIT 規定保留）
- `package.json` 若有 `author` 欄位一併改（沒有就不加）
- **不改**：GitHub 網址、bundle id `com.kekukeku.typek`（改了會讓所有人權限與設定重置）

### 5. 隱藏 Dock 圖示無效（`src-tauri/src/lib.rs`）

- 現況：`apply_dock_icon_hidden` 用 `AppHandle::set_activation_policy`（約 143–158 行），啟動時在 `setup` 內呼叫（約 670 行），設定頁切換時經 `set_dock_icon_hidden` command 呼叫
- 要先查清楚（小D 寫在回報）：
  - `setup` 內對 `AppHandle` 設策略是否生效；Tauri v2 文件建議在 `App` 上設（`app.set_activation_policy`），或在 `RunEvent::Ready` 之後
  - 執行期切換是否需在主執行緒（`run_on_main_thread`）呼叫
  - 主視窗 `show_main_window` 或其他地方是否把策略改回 `Regular`、或呼叫 `setDockVisibility`
- 修法：啟動時在 `setup` 用 `App` 的 `set_activation_policy`；執行期切換用 `app.run_on_main_thread` 包住；切到 Accessory 後若主視窗正開著，維持顯示並 `set_focus`（Accessory 切換常會把視窗藏到後面）
- 選單列圖示（tray）已存在（約 728 行）；隱藏 Dock 後使用者從選單列圖示叫出 Dashboard
- 設定頁說明文字補一句：「開啟後 TypeK 只出現在螢幕上方選單列」
- 本機無法驗證（沒有 Rust）；CI 編過即可，實機由 Kevin 驗

### 6. 剪貼簿：預設不保留轉錄文字，貼上後還原原本內容

- `src/stores/useSettingsStore.ts`：`DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD` 改 `false`；一次性遷移：store 沒有 `copyTranscriptionDefaultMigrated` 時，把 `copyTranscriptionToClipboard` 設為 `false` 並寫入旗標（Kevin 要求預設不放剪貼簿；之後使用者自己再打開就照他的選擇）
- `src-tauri/src/plugins/clipboard_paste.rs` `paste_text`：現在只備份**文字**（`clipboard.get_text()`），使用者原本剪貼簿若是圖片或檔案，備份失敗、貼完會留下轉錄文字。改成：
  - macOS：用 `NSPasteboard`（objc）把 `pasteboardItems` 每個 type 的 data 全部備份，貼上後清空並寫回（含圖片、檔案、富文字）
  - Windows：備份文字＋圖片（arboard `get_image`／`set_image`；若 crate feature 沒開就只文字，不改 `Cargo.toml`）
  - 原本剪貼簿是空的：貼完清空，不留轉錄文字
  - 還原前等待貼上完成（沿用現有延遲）；還原失敗只記 log，不影響貼上
- 設定頁「轉錄後複製到剪貼簿」開關文案確認清楚（關閉＝貼完還原原本內容）
- 測試：設定遷移；Rust 端備份／還原邏輯拆成可測的純函式（型別資料陣列的 round trip），macOS objc 部分只靠 CI 編譯

### 7. 更新摘要與更新視窗不疊（`src/MainApp.vue`）

- 「更新摘要」開著時，自動更新下載完成不立刻跳「更新已就緒」，等更新摘要關閉後再跳（沿用既有 `autoInstallPromptPending` 機制）
- 手動「檢查更新」時若更新摘要開著，先關掉更新摘要
- 測試：更新摘要開著時下載完成 → 不開 autoInstall 對話框；關閉後才開

## 不做

- 改 bundle id、GitHub 網址
- 升級 updater 外掛
- 快捷鍵偵測重試、Toggle 長按（Kevin：目前運作良好）

## 驗收（Claude）

- `npx vue-tsc --noEmit`、eslint、`npx vitest run` 全綠；七語系 JSON 合法
- 推功能分支跑 CI（macOS、Intel、Windows clippy＋test）全綠
- 實機（Kevin）：麥克風按鈕、Groq 預設模型可整理、gpt-oss-120b 可選且有額度估計、作者名、隱藏 Dock、剪貼簿還原（文字與圖片）、更新摘要不再卡住
