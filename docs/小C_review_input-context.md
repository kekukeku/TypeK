- [HIGH] `src-tauri/src/plugins/text_field_reader.rs:482`：密碼辨識失敗時仍允許讀取。`AXSubrole` 查詢失敗得到 `None`，會被判定為非密碼欄，繼續讀 `AXValue`，不符合「密碼欄絕不讀取」。建議將「無法辨識」視為禁止讀取，只在確認非密碼欄後取得文字。

- [HIGH] `src/stores/useVoiceFlowStore.ts:1441`：API key 在等待前取得（1434），model 卻在等待後讀取（1449）。跨視窗刷新若在這段期間切換 provider，可把 Groq key 傳往 Gemini，反向亦然；新增的 300 ms 等待擴大了既有競態。記憶體內重現已確認錯配參數。建議所有等待完成後，同步取得並驗證同一份 provider／model／key 快照。

- [HIGH] `src/stores/useVoiceFlowStore.ts:1441`：等待上下文後沒有檢查 `recordingEpoch`。等待期間 ESC 取消、立即開始新錄音，舊流程會取得新 `abortController`，繼續處理舊逐字稿與上下文，甚至貼入新目標。清空全域 probe 無法撤銷 `takeInputContext()` 已持有的 Promise。建議綁定本輪 epoch／signal，等待後與送出前拒絕過期流程；計畫要求的世代防護屬 **missing**。

- [HIGH] `src/lib/enhancer.ts:109`：外部視窗標題及文字未轉義，直接接入 system prompt；例如 `</context>…指令…<context>` 可以破壞宣告的資料邊界。#43 不是可靠防線：純函式重現中，「明天上午九點在公司開會」附加「，密碼是2468」同時通過語意與長度守衛。建議把上下文隔離為明確的不可信資料、轉義分隔符，並補指令注入及上下文抄錄的回歸案例；不可假設 #43 必定攔截。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:141`：兩個上限常數使用 `cfg(any(macos, test))`，但只有 macOS 實作引用，測試則硬編碼數字。Windows／Linux 測試 target 會產生 `dead_code`，使 `cargo clippy --all-targets -- -D warnings` 失敗。建議常數只在 macOS 編入，或讓測試實際引用。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:489`：新讀取路徑沿用未驗型別的 `get_ax_string_attribute()`（269–272）。resolver 又允許未驗角色的 `AXWebArea` focused child，因此數值等非 CFString 的 `AXValue` 可能被當字串操作，造成 native crash。建議先檢查 CF type ID；不符時釋放並回 `None`，同時驗證 child 角色。

- [LOW] `src/stores/useVoiceFlowStore.ts:1130`：編輯模式、略過整理及失敗分支沒有清除 probe；已取得的上下文可能一直留在 store，直到下一次錄音覆寫。這些分支目前不會把它送進編輯／重送請求，但清理不完整。建議在終止路徑清除所屬 epoch 的 probe，避免誤清下一輪資料。

- [LOW] `src/views/SettingsView.vue:1860`：新增回饋使用 `text-green-400`／`text-red-400`，違反語意色彩規則，也不隨主題調整。建議改用現有語意 token；`Switch` 綁定及 `Label for/id` 本身正確。

其餘檢查：正常返回路徑未發現新增 CF reference 洩漏或 double-free；合法 UTF-16 邊界切割正確。single-flight 可限制卡住的上下文 worker 為一個，但前端逾時不會終止它，永久卡住後本次程序會持續回空。300 ms race 與 timer 清理本身正確，取消及雙擊也有清空全域 probe。

穩定設定狀態下，Groq 舊使用者遷移、Kimi K2 遷移及載入／跨視窗的 model-provider 交叉驗證正確；上述 key 錯配發生在請求組裝期間。IPC 註冊、camelCase/null DTO、契約表及五語系 key 一致。

雙向追溯如下；19 個 diff 檔案及新增計畫均有需求歸屬，未見 **scope creep**：

| 需求 | 對應檔案與行號 |
|---|---|
| 上下文讀取、平台分支、密碼排除、300／100 字 | `src-tauri/src/plugins/text_field_reader.rs:111,126,151,461` |
| IPC 註冊與契約 | `src-tauri/src/lib.rs:497`、`.claude/rules/ipc.md:36`、`src/types/transcription.ts:53` |
| 錄音開始非阻塞、整理前最多等 300 ms | `src/stores/useVoiceFlowStore.ts:1130,1057,1441` |
| 上下文加入整理請求及測試 | `src/lib/enhancer.ts:105,166`、`tests/unit/enhancer.test.ts:389` |
| macOS 預設開、設定儲存及跨視窗同步 | `src/stores/useSettingsStore.ts:80,408,1258,1545`、`src/types/events.ts:31`、`src/views/SettingsView.vue:1842` |
| 五語系揭露 | `src/i18n/locales/zh-TW.json:224`、`zh-CN.json:224`、`en.json:224`、`ja.json:224`、`ko.json:224` |
| Gemini 預設與 Groq／Kimi 遷移 | `src/lib/modelRegistry.ts:7,61,159`、`src/stores/useSettingsStore.ts:94,332,360,375,1515` |
| 預設變更的測試調整 | `tests/unit/model-registry.test.ts:12`、`tests/unit/api-pricing.test.ts:54`、`tests/unit/use-settings-store.test.ts:761`、`tests/unit/enhancer.test.ts:30` |
| 兩項需求的計畫 | `docs/plan-input-context.md:1` |

驗證：`vue-tsc --noEmit --incremental false`、五語系 JSON 解析、`git diff --check` 通過；競態與守衛以原始碼片段在記憶體內重現。未修改檔案，未執行完整 Vitest、Rust 編譯或實機 AX 測試。

REVIEW-RESULT: BLOCK