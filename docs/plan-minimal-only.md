# 計畫：只保留精簡模式、整理指示不給使用者看

> 建立：2026-10-26。需求（Kevin，原話）：「每個語言留【精簡模式】即可，指令不要給用戶看到，其他模式都拿掉。」
> 流程：本計畫 → 小B 建議 → 斟酌定稿 → 小D 實作 → 小B 審查。完成後才繼續 1.0.0 發版。

## 現況

整理指示有四種，散在這些地方：

| 模式 | 觸發 | 主要程式 |
|---|---|---|
| 精簡（預設） | 一般聽寫 | `src/i18n/prompts.ts` `MINIMAL_TEMPLATES`／`MINIMAL_PROMPTS` |
| 積極 | 設定頁選擇、連按兩下快捷鍵切換 | `ACTIVE_TEMPLATES`／`ACTIVE_PROMPTS`、`useVoiceFlowStore` 的 `waitForDoubleTapResolution`／`handleDoubleTapModeToggle`／`applyDoubleTapModeSwitch`、Rust `hotkey_listener.rs` 的 double-tap 偵測與 `HOTKEY_MODE_TOGGLE` 事件 |
| 自訂 | 設定頁編輯指示 | `useSettingsStore` 的 `aiPrompt`／`saveAiPrompt`／重設、`SettingsView.vue` 指示卡片（模式選單＋文字框） |
| 編輯 | 先選取文字再說話 | `EDIT_MODE_PROMPTS`、`useVoiceFlowStore` 的 `editSourceText`／`read_selection_state` 探測／剪貼簿後備 `read_selected_text`（會模擬 Cmd+C）／`handleEditModeFlow` |

另外：`App.vue` 把 `promptModeLabel`、`modeSwitchLabel`、`isEditMode` 傳給 HUD，HUD 有模式徽章與 `mode-switch` 狀態；`FeatureGuideView.vue` 有 `quickModeSwitch`、`promptMode` 兩節；五語系有 `settings.prompt.*`、`promptMode` 等文案。

## 範圍

1. **指示只剩精簡**：`prompts.ts` 留各語系的精簡模板（zh-TW／zh-CN／en／ja／ko，粵語沿用現有對應）與「明確／自動」兩種語言規則；刪除積極、編輯、`PROMPT_MAP`／`TEMPLATE_MAP` 的模式分支、舊預設清單與 `isKnownDefaultPrompt`。對外只留「依有效語言取得精簡指示」與「辨識語言自動時的精簡指示」
2. **設定**：`useSettingsStore` 刪除 `promptMode`、`aiPrompt`、`savePromptMode`、`saveAiPrompt`、重設與 promptMode 遷移；`getAiPrompt()` 一律回傳精簡指示（保留函式名，呼叫端不必改）。store 裡舊的 `promptMode`／`aiPrompt` 鍵不再讀取
3. **不給使用者看**：`SettingsView.vue` 移除整張整理指示卡片（模式選單、文字框、儲存、重設）；五語系刪掉只屬於這張卡片與模式的文案；`FeatureGuideView.vue` 移除「快速切換模式」「整理模式」兩節（及其文案）
4. **拿掉積極模式與連按兩下切換**：刪除前端的模式切換邏輯與 HUD 的 `mode-switch` 狀態、模式徽章
5. **拿掉編輯模式**：不再在錄音開始時做選取探測、不再跑剪貼簿後備（也就不再模擬 Cmd+C）；選取文字時說話＝一般聽寫，貼上會照常取代選取內容。寫入歷史紀錄時 `isEditMode=false`、`editSourceText=null`；資料庫欄位保留不動（不做 migration）
6. **Rust 不改**：`read_selection_state`、`read_selected_text` 指令與 double-tap 偵測都留著（這台沒有 Rust 工具鏈，避免無法驗證的改動）；前端不再呼叫／不再訂閱即可
7. **文件**：`.claude/rules/ipc.md` 呼叫點欄位更新、`docs/plan-input-context.md` 提到編輯模式的地方加註

## 待審查決定

1. **連按兩下快捷鍵**：Rust 仍會送 `hotkey:mode-toggle`。前端要 (a) 保留「很短的連按＝靜默取消、不切換」，還是 (b) 完全移除、讓兩段極短錄音交給既有的短音訊／幻聽判斷？
2. **歷史紀錄裡既有的編輯模式紀錄**：「重新整理」「重送」遇到舊的編輯模式紀錄要怎麼處理（當一般聽寫整理、停用按鈕、或照舊顯示但不可重跑）？
3. **其他語系的精簡指示**：只有 zh-TW 這版加了「依字典／上下文修正專有名詞、保留英文」的規則。這次要不要一併把 en／ja／ko／zh-CN 的精簡指示補到同樣水準？（Kevin 沒要求，預設不做）
4. 還有哪些地方會殘留模式相關的程式、文案或測試？

## 定稿（2026-10-26，依 `docs/小B_review_plan-minimal-only.md` 全數採納）

1. **連按兩下**：保留 `HOTKEY_MODE_TOGGLE` 監聽與 `waitForDoubleTapResolution`；確認是連按時只**靜默取消**（停錄音、還原音量、世代 +1），不寫任何模式、不設 `modeSwitchLabel`、HUD 不顯示模式名。Toggle 長按分支改成 no-op（原本會呼叫 `applyDoubleTapModeSwitch`）。單次極短按仍是「錄音時間太短」，門檻不放寬
2. **舊的編輯模式歷史紀錄**：維持現有守衛——`HistoryView` 重跑按鈕停用、`useHistoryStore` 在打 API 前擋下；可看、可複製、可播放。新紀錄一律 `isEditMode=false`、`editSourceText=null`
3. **其他語系精簡指示**：這輪不升級（含粵語）
4. **必須保留**：`read_input_context` 與 `inputContextProbe`（和選取探測寫在同一段 `handleStartRecording`，刪選取探測時不可誤刪）；貼上後的修正監控（學詞）
5. **補刪清單**（小B 列出的漏網）：
   - `FeatureGuideView.vue` 再刪 `editSelection` 一節（共刪 `quickModeSwitch`、`promptMode`、`editSelection` 三節）
   - `SettingsView.vue` 快捷鍵區的 `doubleTapHint`／`longPressHint`
   - 五語系：`settings.prompt.*`、`settings.promptMode`／`promptMode` 區塊、`settings.hotkey.doubleTapHint`／`longPressHint`、`featureGuide.quickModeSwitch`／`promptMode`／`editSelection`、`voiceFlow.editMode`／`editing`／`editSuccess`／`editFailed`／`modeSwitched`／`commandMode`、`errors.promptEmpty`（刪前先 grep 確認沒有其他使用者）
   - 型別：`src/types/settings.ts` 的 `PROMPT_MODE_VALUES`／`PromptMode`／`PresetPromptMode`；`src/types/events.ts` `SettingsKey` 的 `"aiPrompt"`／`"promptMode"`；`src/types/index.ts` `HudStatus` 的 `"editing"`
   - `useSettingsStore.refreshCrossWindowSettings` 不再讀 `aiPrompt`／`promptMode`；磁碟上的這兩個鍵**不刪**（不讀即可，方便回退）
   - `useVoiceFlowStore` 診斷 log 拿掉 `promptMode=`；`src/lib/enhancer.ts` 註解更新
   - `NotchHud.vue` 的 `mode-switch` 尺寸設定與相關 CSS
   - `.claude/rules/ipc.md`：`read_selected_text`、`read_selection_state` 呼叫點改「（前端不再呼叫）」；`hotkey:mode-toggle` 註明「前端只用來靜默取消極短連按」
   - 文件：`docs/architecture-frontend.md`、`docs/architecture-backend.md`、`docs/data-models.md` 提到編輯模式／模式切換處更新；`docs/plan-input-context.md` 加註
6. **測試**：依小B 清單更新（選取偵測改為斷言「不再呼叫」、promptMode 遷移與 custom／active 測試刪除、locale／粵語連動 `getAiPrompt()` 的測試保留並改成只斷言精簡＋自動語言規則、`prompts-*`／fixture／mock 調整、`NotchHud` factory）；舊編輯紀錄守衛的測試保留
7. **發版時處理**（不在本次實作）：1.0.0 CHANGELOG 註明積極／自訂／編輯模式移除；升級摘要加一條說明

## 不做

- 改 Rust、改資料庫 schema
- 新增任何模式或設定

## 驗收

- `vue-tsc`、eslint、Vitest 全綠；Vue 檔與 i18n 不再出現 `promptMode`、`aiPrompt`、`ACTIVE_PROMPTS`、`EDIT_MODE_PROMPTS`、`editSourceText`（歷史紀錄的型別與 DB 映射除外）
- 設定頁沒有任何整理指示的顯示或編輯入口；功能介紹沒有模式相關章節
- 選取文字後說話：照一般聽寫流程整理並貼上，不模擬 Cmd+C
- 五語系 key 集合仍一致
