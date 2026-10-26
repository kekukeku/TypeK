我先對照規格、先前驗收清單和未提交的 diff，只讀不改，逐項核對實作是否真的只剩 minimal mode。工作樹是 31 個已修改檔。我接著對照定稿，把語音流程、設定、文案和測試的 diff 拆開看。沒有會擋發版的問題。未提交的 31 個檔與定稿一致：精簡指示、靜默取消連按、選取改走一般聽寫、舊編輯紀錄不可重跑。下面四條是文件與死樣式，不影響執行，也不會讓 CI 變紅。

[LOW] `src/lib/enhancer.ts:51-57` — `transcriptLocale`／`inputContext` 的註解仍寫「編輯模式不傳」。定稿要求改這段註解，但註解還在。之後讀程式的人會以為編輯模式仍是呼叫端。改成只寫重送與連線測試不傳這兩個欄位。

[LOW] `docs/data-models.md:147-157` — 執行期狀態圖仍把 `HudStatus` 列成含 `'editing'`，並保留 `editMode: { isActive, sourceText, fieldRef? }`。資料庫欄位註解（`docs/data-models.md:54-55`）已改成舊資料，這段狀態圖沒改。對照現行程式會以為編輯狀態還在。從這段拿掉 `editing` 與 `editMode`。

[LOW] `src/style.css:126-127` — `--notch-edit-bg`、`--notch-edit-fg` 只剩定義。`NotchHud.vue` 的徽章與 `mode-switch` 樣式已刪，沒有引用。死變數。刪這兩行。`--notch-mode`（`src/style.css:125`）仍被 `.magic-star`（`src/components/NotchHud.vue:572`）使用，留下。

[LOW] `docs/component-inventory-frontend.md:14`、`docs/integration-architecture.md:148-149` — 元件清單仍寫 HUD 有 `editing`；整合文件仍把 `read_focused_text_field`、`read_selected_text` 寫成給 Edit Mode。`read_focused_text_field` 現在是修正監控在用（`src/stores/useVoiceFlowStore.ts:550`）。這兩份現行文件會讓人以為選取改寫還在。歷史計畫（`plan-cantonese-option.md`、`plan-windows-uia-selection.md` 等）維持不動是對的。

## 驗收

- ✅ `vue-tsc`、eslint、Vitest：這次沒有重跑。你提供的結果是 vue-tsc 過、eslint 過（1 個既有警告）、Vitest 632/632。靜態檢查沒有殘留 import 會讓這三項變紅：`getPromptForModeAndLocale`、`ACTIVE_PROMPTS`、`EDIT_MODE_PROMPTS`、`isKnownDefaultPrompt`、`PROMPT_MODE_VALUES`、`saveAiPrompt`、`savePromptMode` 都已從 `src` 與測試 import 消失。`prompts-legacy-default.test.ts` 已刪。Rust 不在 diff 裡。
- ✅ `src/**/*.{vue,ts}` 與五份 locale 找不到 `promptMode`、`aiPrompt`、`ACTIVE_PROMPTS`、`EDIT_MODE_PROMPTS`、`savePromptMode`、`saveAiPrompt`、`getPromptForModeAndLocale`、`read_selection_state`、`read_selected_text`。留下的 `isEditMode`／`editSourceText` 只在 `src/types/transcription.ts:20-21`、`src/stores/useHistoryStore.ts` 的資料庫映射、`src/views/HistoryView.vue:322,334`，以及新紀錄寫入 `src/stores/useVoiceFlowStore.ts:354-355`（固定 `false`／`null`）。
- ✅ 設定頁整理指示卡片與 `doubleTapHint`／`longPressHint` 已從 `src/views/SettingsView.vue` 刪除。五份 locale 沒有這些 key。
- ✅ `src/views/FeatureGuideView.vue:15-21` 只剩語音輸入、快捷鍵、觸發模式、字典、歷史。`src/i18n/locales/zh-TW.json:428-450` 沒有快速切換、整理模式、編輯選取。
- ✅ 選取後聽寫：`handleStartRecording` 只發 `read_input_context`（`src/stores/useVoiceFlowStore.ts:1013-1016`）。`read_selection_state`、`read_selected_text`、`handleEditModeFlow` 已刪。測試 `tests/unit/use-voice-flow-store.test.ts:488-512` 斷言不呼叫這兩個指令，並貼上一般轉錄「測試轉錄」。
- ✅ 上下文仍送進整理：`takeInputContext`（`src/stores/useVoiceFlowStore.ts:975-988`）進 `enhanceOptions.inputContext`（`:1282-1289`）。診斷 log 的 `hasContext` 還在（`:1274-1276`），`promptMode=` 已拿掉。
- ✅ Hold 連按：`waitForDoubleTapResolution` 仍等 400ms（`:896-905`）。確認後 `handleStopRecording`（`:1053-1060`）停計時、清靜音計時、`restoreSystemAudio()`（`:289-297`，呼叫 `restore_system_audio`）、`stop_recording`，然後 `cancelDoubleTapRecording`（`:920-926`：`isRecording = false`、`recordingEpoch += 1`、清 probe、`transitionTo("idle")`）並 return。這條路不進 `failRecordingFlow`，因此不播 `play_error_sound`（`:451`）、不貼上、不寫「錄音時間太短」。沒有 `modeSwitchLabel`。測試 `:517-545`。
- ✅ Toggle 短按：`HOTKEY_TOGGLED` 仍依 `start`／`stop` 呼叫開始與停止（`:1778-1786`）。測試 `:847-861`。長按 ≥ 1s 時 Rust 只送 `hotkey:mode-toggle`、不送 `hotkey:toggled`（`src-tauri/src/plugins/hotkey_listener.rs:514-547`，此 diff 未改）。前端 `doubleTapResolve` 為空時 no-op（`src/stores/useVoiceFlowStore.ts:908-917`）。測試 `:547-559`。
- ✅ 單次極短按：門檻仍是 300ms（`:1101-1120`），走 `failRecordingFlow` 與 `voiceFlow.recordingTooShort`。測試 `:562-584`。
- ✅ 修正監控：`completePasteFlow` 在貼上後呼叫 `startCorrectionDetectionFlow`（`:813-816`）；智慧字典關閉時直接 return（`:534-535`）。
- ✅ 歷史：重跑按鈕在 `record.isEditMode` 時 disabled（`src/views/HistoryView.vue:322,334`）。`retranscribeRecord`／`reEnhanceRecord` 在打 API 前 return（`src/stores/useHistoryStore.ts:711-712,834-835`）。既有測試 `tests/unit/use-history-retry.test.ts:275,503`、`tests/component/HistoryView.test.ts:155` 未刪。新紀錄一律 `isEditMode: false`、`editSourceText: null`。
- ✅ 辨識語言「自動」：`getAiPrompt` 走 `getAutoLanguagePrompt(selectedLocale)`（`src/stores/useSettingsStore.ts:623-628`）。自動規則含「保持輸入的語言，不要翻譯」（`src/i18n/prompts.ts:20-25`）。明確 zh-TW 結尾仍是「繁體中文 zh-TW。」（`:12-17,54`）。`tests/unit/prompts-output-language.test.ts` 鎖住 #83：zh-TW 精簡允許與 v0.14.1 不同，其餘語系精簡逐字相同。
- ✅ 粵語未升級：`src/i18n/prompts.ts:108-121` 仍是舊版「逐段處理」加上粵語用字句，與新版 zh-TW 不同。`tests/unit/prompts-cantonese.test.ts:9-14` 鎖住這一點。
- ✅ 五語系 key 集合：禁止 key 在五份 locale 都已消失，每份 diff 同為約 39 行。key 集合測試若不一致會紅；你提供的 Vitest 是全綠。
- ✅ 磁碟上的 `promptMode`／`aiPrompt`：`loadSettings` 與 `refreshCrossWindowSettings` 不再 `get`，也沒有 `store.delete`（`src/stores/useSettingsStore.ts:284` 附近只留註解）。測試 `tests/unit/settingsStore.test.ts:122-130` 斷言讀了自訂內容仍回精簡，且沒有把這兩鍵寫回去。
- ✅ `.claude/rules/ipc.md:34-35` 呼叫點是「（前端不再呼叫）」；`:66` 註明 `hotkey:mode-toggle` 只用於靜默取消極短連按。`docs/plan-input-context.md`、`docs/community-commitments.md`、`docs/architecture-frontend.md`、`docs/architecture-backend.md` 的模式切換與編輯模式敘述已改。CHANGELOG 與升版摘要依定稿留到 1.0.0，這次沒做是對的。

REVIEW-RESULT: READY
