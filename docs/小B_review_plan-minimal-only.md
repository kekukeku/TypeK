我先讀計畫與相關程式，再對四個待決事項與遺漏路徑給建議。不會改任何檔案。接著搜尋既有工作紀錄，並讀計畫與相關原始碼。記憶沒有舊紀錄。我接著把計畫點到的原始碼與測試讀完。繼續讀流程 store、HUD、歷史與快捷鍵相關路徑。四個待決事項都有明確建議：連按兩下要靜默取消、舊編輯紀錄維持停用重跑、其他語系精簡指示這輪不要升、功能介紹還漏了「編輯選取文字」。接著把漏掉的路徑與風險寫完整。## 待審查決定的建議

**1. 連按兩下快捷鍵：選 (a) 保留「極短連按＝靜默取消」，不要切模式、不要閃 HUD。**

Rust 在 Hold 第二次按下只送 `hotkey:mode-toggle`、不送 `hotkey:pressed`（`hotkey_listener.rs:467-472`）。第一次按下已經開始錄音。前端若完全不聽這個事件，第一次放開會立刻走 `handleStopRecording`，實際時長通常 < 300ms，撞上 `MINIMUM_RECORDING_DURATION_MS`（`useVoiceFlowStore.ts:1253-1273`），HUD 出現「錄音時間太短」、寫入 failed 紀錄、播錯誤音。功能介紹與設定頁現在還在教這個手勢，升版後習慣連按的人會一直誤觸。

實作要點：

- 保留 `waitForDoubleTapResolution`（< 350ms 等 400ms）與 `HOTKEY_MODE_TOGGLE` 監聽。
- `handleDoubleTapModeToggle` 確認後只靜默取消（停錄音、還原音量、世代 +1），**不要**再寫 `promptMode`、不要設 `modeSwitchLabel`。
- Toggle 長按（`hotkey_listener.rs:514-522`）本來就不開始錄音；監聽還在時 else 分支改成 **no-op**。若仍呼叫 `applyDoubleTapModeSwitch`（`:960-1005`），刪掉 `promptMode` 之後會在執行期炸掉。
- 設定頁的 `doubleTapHint`／`longPressHint` 必須拿掉，否則還在教已失效的手勢。

選 (b) 只有在連帶改 Rust 停發 `mode-toggle` 時才合理；這台沒有 Rust 工具鏈，不要選。

**2. 既有編輯模式歷史紀錄：維持現況——按鈕停用＋ store 守衛，可看、可複製、可播錄音，不可重跑。**

`rawText` 是語音指令、`processedText` 是改寫結果（`useVoiceFlowStore.ts:1689-1700`）。當一般聽寫重跑會把指令洗成「整理過的指令」，毀掉編輯結果。UI 已停用（`HistoryView.vue:322,334`），store 也在打 API 前擋下（`useHistoryStore.ts:711,834`）。測試已覆蓋（`use-history-retry.test.ts:269`、`HistoryView.test.ts:148`）。新紀錄一律 `isEditMode=false`；DB 欄位不動。不要為舊資料開新功能。

**3. 其他語系精簡指示：這輪不要升。**

Kevin 的範圍是「每個語言留精簡、指令不要給用戶看」，不是把 zh-TW 新規則抄到所有語系。`prompts-output-language.test.ts` 還在用 v0.14.1 凍結文案守 #83。這輪改 en／ja／ko／zh-CN 會把「輸出語言插槽」回歸測一起打亂，也超出 1.0.0 閘門。粵語精簡仍是舊版 zh-TW（`prompts.ts:245-255`），後續若要升，**連 yue 一起**，並保留粵語用字句。

**4. 殘留：計畫列的不夠。** 見下一節。必做的漏網是功能介紹的「編輯選取文字」、設定頁快捷鍵提示、型別／事件／HudStatus、以及一大批測試。磁碟上的 `promptMode`／`aiPrompt` **不要刪**（不讀即可，方便回退）。

---

## 漏掉的地方

**產品／UI**

- [HIGH] `src/views/FeatureGuideView.vue:20` — 計畫只刪 `quickModeSwitch`、`promptMode`，漏了 `editSelection`（「選取文字 → 說你想怎麼改」）。拿掉編輯模式後這節是假說明。
- [HIGH] `src/views/SettingsView.vue:1203-1208` — `doubleTapHint`／`longPressHint` 仍在教「連按／長按切換語音模式」。五語系 `settings.hotkey.doubleTapHint`、`longPressHint`（`zh-TW.json:34-35`）。
- [HIGH] `src/i18n/locales/zh-TW.json:459-463` — `featureGuide.editSelection` 整節；另有 `voiceFlow.editMode/editing/editSuccess/editFailed`（`:347-350`）、`modeSwitched`（`:357`）、`commandMode`（`:358`，死 key）、`errors.promptEmpty`（`:363`，只給 `saveAiPrompt` 用）、整塊 `settings.prompt.*`（`:116-130`）。五語系必須一起刪，否則 `i18n-settings.test.ts:407` 的 key 集合會紅。
- [MED] `src/MainApp.vue:86-95`、`zh-TW.json:446-449` — 升版摘要是依版本號彈的。自訂／積極使用者會無聲切到精簡；建議加一條 item，不要只靠設定頁消失。
- [LOW] `src/components/NotchHud.vue:80` — `mode-switch` 專用 350×36；徽章拿掉後錄音 HUD 仍是 420 寬（`:71-76`），可接受。CSS `:800-826` 的 mode-switch／badge 一併刪。

**型別／IPC／store**

- [HIGH] `src/types/settings.ts:63-65` — `PROMPT_MODE_VALUES`、`PromptMode`、`PresetPromptMode`；`prompts.ts:2` 還在 import。
- [HIGH] `src/types/events.ts:24,35` — `SettingsKey` 仍有 `"aiPrompt"`、`"promptMode"`。刪函式後若 union 還留著，廣播端會變成死成員；呼叫端若還 emit 會 `vue-tsc` 紅。
- [MED] `src/types/index.ts:6` — `HudStatus` 含 `"editing"`；`NotchHud.vue:303` 與 `useVoiceFlowStore.ts:1662` 都用它。
- [MED] `src/composables/useTauriEvents.ts:32` — `HOTKEY_MODE_TOGGLE`。選 (a) 要留；選 (b) 才刪。`.claude/rules/ipc.md:66` 列了這個事件，計畫寫「更新呼叫點」但沒寫事件列怎麼改：建議註明「前端只用來取消極短錄音」。
- [HIGH] `.claude/rules/ipc.md:34-35` — `read_selected_text`、`read_selection_state` 呼叫點仍寫 useVoiceFlowStore。前端停呼叫後改成「（前端不再呼叫）」，列不要刪（Rust 還在）。
- [MED] `src/stores/useSettingsStore.ts:1432-1510` — `refreshCrossWindowSettings` 仍讀 `aiPrompt`／`promptMode`。`loadSettings` 的遷移（`:291-315`）整段刪。磁碟鍵不要 `store.delete`。
- [MED] `src/stores/useVoiceFlowStore.ts:1464` — 診斷 log 含 `promptMode=`。刪欄位後這行會紅；改成固定 `minimal` 或拿掉該欄。
- [LOW] `src/lib/enhancer.ts:51-57` — 註解仍寫「編輯模式不傳 transcriptLocale／inputContext」。

**測試（不改會直接紅）**

- [HIGH] `tests/unit/use-voice-flow-store.test.ts:474` 起整段「選取偵測三態」與 Windows UIA（`:554`）——改成斷言**不再**呼叫 `read_selection_state`／`read_selected_text`，選取後仍走一般聽寫貼上。
- [HIGH] `tests/unit/settingsStore.test.ts:133-230`、`tests/unit/use-settings-store.test.ts:264-619`、`tests/unit/i18n-settings.test.ts:294-398` — promptMode 遷移、custom、active、`saveAiPrompt`。locale／粵語連動 `getAiPrompt()` 的部分要留下，改成只斷言精簡＋自動語言規則。
- [HIGH] `tests/unit/prompts-output-language.test.ts:10`、`prompts-cantonese.test.ts:22-34`、`prompts-legacy-default.test.ts`、`tests/support/fixtures/builtin-prompts-v0.14.1.ts` — 仍掃 `active`、`getPromptForModeAndLocale`、`isKnownDefaultPrompt`。
- [HIGH] `tests/unit/enhancer.test.ts:611-635`、`tests/unit/settings-store-chord.test.ts:25-28` — mock 了 `ACTIVE_PROMPTS`／`isKnownDefaultPrompt`。
- [MED] `tests/component/NotchHud.test.ts:30` — 預設塞 `isEditMode: false`；拿掉 prop 後要改 factory。
- [MED] `tests/component/HistoryView.test.ts:148`、`tests/unit/use-history-retry.test.ts:269,503` — 舊編輯紀錄守衛**保留**。
- [LOW] `tests/unit/types.test.ts:8-15` — `HudStatus` 清單本來就沒列 `editing`／`cancelled`，刪 `editing` 不會紅，但可順便對齊。

**文件**

- [MED] `docs/architecture-frontend.md:100`、`docs/architecture-backend.md:104,185`、`docs/data-models.md:54` — 仍寫 edit mode／`hotkey:mode-toggle` 語意。
- [MED] `docs/community-commitments.md:16-17` — #79／#80 等編輯模式 Windows 承諾；功能拿掉後那些 bug 隨之消失，應註明「功能已移除」。
- [LOW] `docs/plan-input-context.md:25,43` — 計畫有寫要加註，同意。歷史計畫（`plan-cantonese-option.md`、`plan-i18n-vi-th.md`）不必改。
- [LOW] `CHANGELOG.md` — 1.0.0 要寫這是破壞性變更（積極／自訂／編輯模式移除）。`README.md` 特色列已經沒寫模式，可不動。

**存檔設定**

- [MED] `settings.json` 的 `promptMode`、`aiPrompt`：不讀、不刪。自訂指示從此失效，這是需求本身；回退舊版時還找得到原文。

---

## 風險

**行為回歸**

- [HIGH] `src/stores/useVoiceFlowStore.ts:1094-1134` 與 `:1131-1134` — 選取探測與 `inputContextProbe` 寫在同一段 `handleStartRecording`。刪編輯模式時**必須留下** `read_input_context`。拿掉上下文會讓 zh-TW 精簡裡「依 &lt;context&gt; 修專有名詞」失效。
- [HIGH] 選取文字再說話：不再進編輯、貼上會取代選取（計畫已寫，這是產品變更）。以前說「翻成中文」會改寫選取；之後會把「翻成中文」四個字貼上去。功能介紹若不刪 `editSelection`，使用者會以為壞了。
- [HIGH] 連按兩下：見決定 1。選 (b) 會讓習慣連按的人反覆看到「錄音時間太短」。真的極短單按（&lt; 300ms）本來就走這條，不要再放寬門檻。
- [MED] `src/stores/useVoiceFlowStore.ts:559-573` — 修正監控在 `completePasteFlow` 之後跑，與編輯模式無關，應保留。選取被聽寫蓋掉後，監控比的是貼上的聽寫結果；這條路徑仍然成立。
- [MED] 自訂／積極使用者無聲改走精簡：排版會變保守（不再合併段落、列點）。用升版摘要講清楚。
- [MED] Toggle 長按 1 秒：Rust 仍吞掉這次 toggle（`:533`）。前端 no-op 後，使用者會長按卻沒開始錄音——拿掉 hint 之後這只是「長按沒反應」，可接受。
- [LOW] 舊編輯紀錄展開後，「原文」顯示的是語音指令（`HistoryView.vue:389`），沒有編輯徽章。可接受；不要為展示再開工。
- [LOW] HUD 重試（`handleRetryTranscription`，`:1733`）本來就不走編輯模式，繼續用 `getAiPrompt()` 即可。

**CI**

- [HIGH] Vitest：上列測試檔不改會整片紅。`prompts-output-language` 若還 import `getPromptForModeAndLocale`／掃 `active`，模組一改就編譯失敗。
- [HIGH] `vue-tsc`：`App.vue:119-121` 若還傳已刪的 props；`SettingsView.vue:55` 還 import `PROMPT_MODE_VALUES`；`prompts.ts` 還用 `PresetPromptMode`。
- [MED] eslint：刪卡片後 `SettingsView.vue` 的 `promptInput`、`handleSavePrompt`、`watch` locale（`:373-379`）會變 unused。
- [LOW] Rust clippy：計畫不改 Rust，macOS／Windows clippy 不該動。`hotkey_listener.rs` 的 double-tap 測試（`:1660` 起）仍會綠。不要為了「乾淨」去刪 Rust 偵測。

---

## 建議順序與驗收

1. **`prompts.ts`**：只留精簡模板＋明確／自動語言規則＋ yue 現況；`getMinimalPromptForLocale`、`getAutoLanguagePrompt(uiLocale)`（拿掉 mode 參數）。先改 `prompts-output-language`／粵語測試，確認 #83 精簡路徑仍綠。
2. **型別**：刪 `PromptMode` 家族；`SettingsKey` 去掉 prompt 兩鍵；`HudStatus` 去掉 `editing`。
3. **`useSettingsStore`**：`getAiPrompt()` 只回精簡（auto 走自動規則）。刪 state／save／reset／遷移；`refreshCrossWindowSettings` 不再讀那兩鍵。保留函式名。
4. **`useVoiceFlowStore`（最容易誤傷）**：先確認 `inputContextProbe` 獨立於選取探測；再刪 `read_selection_state`／剪貼簿後備／`handleEditModeFlow`。連按兩下改成靜默取消。診斷 log 拿掉 `promptMode`。
5. **HUD／`App.vue`**：刪徽章、`mode-switch`、相關 props。
6. **`SettingsView`**：整張指示卡片＋ script（`:365-509`、`:1607-1704`）＋快捷鍵 hint。
7. **`FeatureGuideView`**：刪 `editSelection`、`quickModeSwitch`、`promptMode` 三節。
8. **歷史**：UI／store 的 `isEditMode` 守衛留下；新寫入永遠 false／null。
9. **i18n 五檔同步刪 key** → 立刻跑 key 集合測試。
10. **測試重寫**（上列 HIGH）→ `vue-tsc`、eslint、Vitest。
11. **文件**：`ipc.md`、`plan-input-context.md` 加註、CHANGELOG 1.0.0、升版摘要文案。

**驗收（計畫四條＋補上）**

- `pnpm exec vue-tsc --noEmit`、eslint、`pnpm test` 全綠。
- `rg` 在 `src/**/*.{vue,ts}` 與 `src/i18n/locales/*.json` 找不到 `promptMode`、`aiPrompt`、`ACTIVE_PROMPTS`、`EDIT_MODE_PROMPTS`、`savePromptMode`、`saveAiPrompt`（例外：`transcription.ts`、`useHistoryStore` 的 DB 映射、`HistoryView` 的 `record.isEditMode`）。
- 設定頁沒有整理指示卡片；快捷鍵區沒有連按／長按切模式說明。
- 功能介紹沒有整理模式、快速切換、編輯選取三節。
- 選取一段文字再聽寫：不呼叫 `read_selection_state`／`read_selected_text`，一般精簡後貼上，選取被取代；**不**模擬 Cmd+C。
- macOS 開著上下文感知：整理請求仍帶 `inputContext`（可用現有診斷 log 的 `hasContext`）。
- Hold 連按兩下（各下 &lt; 300ms、間隔 &lt; 350ms）：靜默取消、不貼上、不出現「錄音時間太短」、不切任何模式、HUD 不閃模式名。
- Toggle 短按仍開始／停止；長按 ≥ 1s 不開始錄音、不報錯。
- 單次極短按（&lt; 300ms、沒有第二次）：仍「錄音時間太短」。
- 貼上後修正監控仍會在使用者改字後學詞（智慧字典開著時）。
- 歷史：舊 `isEditMode=true` 兩顆重跑鈕 disabled；直呼 store 也不打 API。新紀錄 `isEditMode=false`。
- 辨識語言「自動」：精簡指示含「保持輸入的語言，不要翻譯」；明確 zh-TW 仍要求繁中。
- 五語系 locale key 集合一致。
- 自訂指示還在 `settings.json` 裡但不被讀取；行為等於精簡。

REVIEW-RESULT: DONE
