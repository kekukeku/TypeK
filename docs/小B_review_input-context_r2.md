開始重審：先讀先前審查、計畫閘門與目前 diff，再對照原始碼核對每一項修復。先前審查與閘門已對上。接著搜尋既有紀錄，並讀目前 diff 與相關原始碼。diff 被截斷了。接著把 AX worker、前端世代檢查與設定頁相關原始碼整段讀完。接著核對 `panic = "abort"`、前端世代檢查，以及 Rust 測試與未使用匯入。HIGH 無 timeout／旗標卡住／與選取偵測並行：已修
MED 密碼欄仍送 App／標題：已修
MED App／標題無字數上限：已修
MED 讀取 WebArea 本身：已修
MED `takeInputContext` 前未做世代檢查：已修
MED `enhanceText` 返回後與 `catch` 只看 `isAborted`：已修
LOW Windows 仍顯示設定卡片：已修
缺 Gemini key 的 HUD 看不出原因：已修

共用 AX worker（`AxRequest::{Selection,Context}`，`text_field_reader.rs:605`）正確。`read_input_context_impl`（`:477`）`try_send` 失敗或 `recv_timeout(1500ms)` 都回空內容；`CONTEXT_IN_FLIGHT` 已刪除，旗標不會再卡死。`spawn_blocking` 只負責有上限的等待，AX 本體在 `ax-selection-reader` 上跑。`field.cleanup()` 在 Sensitive／SkipText／Read 三臂都會走到（`:590`）；`field_text_policy` 失敗路徑有 `CFRelease`，成功路徑由 `cf_value_into_string` 接手 +1（非字串就釋放，字串走 `wrap_under_create_rule`），沒有雙重釋放。`ax_worker_sender` 的 Mutex 只用來 clone sender，worker 不鎖它，沒有死鎖。

佇列 1→2 改變「忙碌」定義：worker 佔用中時，可再排 2 筆才 `try_send` 失敗。錄音開始是先 `read_selection_state` 再 `read_input_context`，選取仍先入列。`SELECTION_IN_FLIGHT` 仍由呼叫端清旗標，選取連按立刻 `unavailable` 的語意維持。容量 2 讓「上一筆還沒消化完」時，這一輪的選取＋上下文都能排進去；第三筆起才立刻降級。

`catch_unwind(selection_probe_blocking)`／`catch_unwind(input_context_blocking)`（`:735`、`:740`）傳的是 fn item，`UnwindSafe`，edition 2021 可編譯，不必 `AssertUnwindSafe`。`src-tauri/Cargo.toml:58` `[profile.release] panic = "abort"`，正式版 panic 直接結束行程，`catch_unwind` 在 release 無效；檔案註解（`:728`）已寫明。dev（預設 unwind）單次 panic 會 drop 該請求的 `resp_tx`，worker 繼續跑。這不讓 HIGH 復發：卡住的是 worker 執行緒，呼叫端 timeout 後回空，沒有永遠為 true 的旗標。

`CONTEXT_IN_FLIGHT`、`is_secure_or_undeterminable` 已不存在。`AtomicBool`／`Ordering` 仍用於 macOS `SELECTION_IN_FLIGHT`（`:614`）與 Windows `IN_FLIGHT`（`:861`）。`is_text_input_role` 仍給 `resolve_focused_text_element` 與測試用（`:355`、`:809`）。`cap_chars`／`CONTEXT_*` 有 `#[cfg(any(target_os = "macos", test))]`，Windows `clippy --all-targets` 的 test target 會用到它們，lib target 不會留下 dead_code。看不出新的 `-D warnings` 項目。

[LOW] `src-tauri/src/plugins/text_field_reader.rs:355`：角色本身是 `AXSecureTextField` 時，`is_text_input_role` 不含它，`resolve_focused_text_element` 回 `None`，`:562` 走「沒有文字欄位」仍讀 App／標題。標準密碼欄（`AXTextField` + 子角色）已由 `field_text_policy` 回 Sensitive、四欄全空。

整段 `AXValue` 先讀進記憶體仍維持延後。本機無 Rust 工具鏈，clippy／`cargo test` 以閱讀判定；CI `rust-check`（macos-latest + windows-latest）仍須綠。

REVIEW-RESULT: READY
