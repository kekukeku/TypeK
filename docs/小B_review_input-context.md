我先以唯讀方式看未提交的 diff、三輪審查紀錄和專案規則，再獨立判斷有沒有漏網問題。核心 diff 已看到一半。我接著把 Rust AX 路徑、enhancer 與三輪審查原文對完，再核對行號。## 漏網問題

密碼欄白名單、`& < >` 跳脫、`resolveLlmProviderId` 與 Kimi 遷移、以及 key／model 在 `refreshLlmApiKey()` 之後同步讀取，這幾段站得住。下面是三輪沒抓住、或 H3 只補了一半的問題。

- [HIGH] `src-tauri/src/plugins/text_field_reader.rs:496`：`CONTEXT_IN_FLIGHT` 要等 `read_input_context_blocking()` 整個返回才清掉，這條路徑沒有 timeout，也沒有 `Drop` 守衛。目標 App 的 AX server 一卡住（同檔選取偵測已把這當成常態），blocking thread 會一直佔著，旗標維持 `true`，之後每次錄音的上下文都直接回空，直到該次呼叫返回或程序重開。`spawn_blocking` 的 panic 被 `unwrap_or_default()`（`text_field_reader.rs:131`）吃掉，旗標同樣不會清。前端 300 ms（`useVoiceFlowStore.ts:165`）只放棄等待，不會取消這次 IPC。同一輪錄音又和選取偵測並行（`useVoiceFlowStore.ts:1101` 與 `:1130`），兩條執行緒同時打進同一個 App 的 AX server；選取路徑是刻意做成單一 worker 的。這次呼叫有機會把 `ax-selection-reader` 一起拖住。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:512`：App 名稱與視窗標題在密碼判定之前就讀完，密碼欄只是略過 `AXValue`。登入視窗標題（帳號、站名）仍會進 LLM。隱私文案寫的是「密碼欄不讀取」。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:513`：`appName`／`windowTitle` 沒有字數上限。游標前後有 300／100 的上限，標題沒有。瀏覽器分頁標題可以很長，也常帶文件名或主旨。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:530`：先把整個 `AXValue` 讀進記憶體，再切 400 字。長文件或編輯器緩衝會在沒有 timeout 的 blocking thread 上做一次大配置。送出的字數有上限，讀取沒有。

- [MED] `src-tauri/src/plugins/text_field_reader.rs:435`：WebArea 沒有 focused child 時，target 就是 WebArea 自己。它在白名單裡（`:377`），子角色又常常是「不支援」，`is_secure_or_undeterminable`（`:304`）會把它當成一般文字欄而讀 `AXValue`。各瀏覽器這個 value 到底是空的、網址，還是一段頁面文字，這份 diff 沒有實測；控制流確定會讀。

- [MED] `src/stores/useVoiceFlowStore.ts:1437`：世代檢查在 `takeInputContext()` 之後。`getTopTermListByWeight` 這段 await 期間若 ESC 並立刻重錄，舊流程會把新一輪的 probe 取走，接著因世代不符丟棄。新一輪後來 `takeInputContext()` 拿到 `null`。檢查與取 probe 必須放在同一段同步程式裡，中間不能有 await。

- [MED] `src/stores/useVoiceFlowStore.ts:1470` 與 `:1542`：`enhanceText` 返回後和 `catch` 只看 `isAborted`。新錄音會把 `isAborted` 清掉（`:1077`）並換掉 `abortController`。舊的 LLM 呼叫被 abort 之後，`catch` 會把上一輪逐字稿貼出去。`:1432` 的註解說舊流程必須放棄；詞彙與上下文這兩段 await 有守住，LLM 呼叫本體沒有。

- [LOW] `src/views/SettingsView.vue:1831`：Windows 上這張卡片照樣出現，文案仍說會送出游標前後文字。此平台的 command 固定回空，預設雖是關的，打開之後沒有任何效果，也沒有平台說明。

- [LOW] `src/stores/useVoiceFlowStore.ts:1413`：編輯模式與略過整理仍不清 probe。下一輪錄音會覆寫，不會把舊上下文送出。與小C 延後的判斷相同。

Rust 這輪沒有在這台機器上編譯。以 lint 等級來看，macOS／Windows 的 `cargo clippy --all-targets -- -D warnings` 沒有明顯的新 deny 項目；`split_text_around_selection` 的測試有引用那兩個常數。CI 的 Rust job 只有 macOS 與 Windows（`.github/workflows/ci.yml:37`）。`clipboard_paste.rs:461` 的 Linux `compile_error!` 是既有問題，不會讓這條 CI 變紅。

## 對審查過程的看法

拿掉抄錄守衛是對的。這個功能就是要讓模型把畫面上的專名寫進輸出；「新增字數」分不出「太普 → TypeK」和「把畫面上的句子接在稿子後面」。三輪都找到新的反例，代表這條規則的邊界不存在，不是門檻還沒調好。繼續加 LCS、簡繁轉換、格子上限，是跟功能目標對打，屬於過度工程。第三輪交你裁決，符合專案自己的規則。

H1 的白名單、H2 的同步讀 key／model、跳脫與「不可信」標籤，工程量跟風險相稱，應該留。H3 的方向對，但只蓋住等待上下文和刷新 key 的那兩段，`enhanceText` 之後仍只用 `isAborted`。

不足的是 AX。同檔的選取偵測已經用「單一 worker + timeout + 呼叫端清旗標」處理卡死；新 command 改用 `spawn_blocking` 加一把要等呼叫結束才放開的旗標，把已經付過的教訓又走了一遍。

## 建議

上下文讀取接到現有的 `ax-selection-reader`（或另一條專用 AX worker），帶 timeout。逾時與 panic 都要清旗標，而且清旗標之後不能再 `spawn` 新執行緒。前端 300 ms 維持不變。密碼欄判定成立時，四個欄位全部回空，包含 App 與視窗標題。`appName`、`windowTitle` 各設一個小上限（例如 120 字）。WebArea 只拿來找子元素；子元素不是 `AXTextField`／`AXTextArea`／`AXComboBox` 就不讀 value。

世代方面：`takeInputContext()` 之前先做同步的世代檢查；`enhanceText` 返回後與 `catch` 改看 `enhanceEpoch !== recordingEpoch`，不要只看 `isAborted`。對不上就返回，不要貼上。

抄錄風險不要再做事後字數守衛。比較穩的做法是模型只回替換清單，由程式把替換套回原文：每一筆的 `from` 必須是逐字稿裡的子字串，`to` 設長度上限，沒被點名的字元一律沿用原文。模型就沒有機會在稿尾接一段畫面文字。在那之前，prompt 可以改成「只准替換聽錯的詞，不准加句子或數字串」，上下文放在 user 訊息而不是 system。上線後只記一個本地計數：輸出裡有沒有出現「上下文有、逐字稿沒有、且連續超過 N 字」的片段，不要把片段本身寫進 log。真的常發生再做結構化輸出。

Gemini 預設與「已有 Groq key、沒存過 provider 的人留在 groq」這段邏輯是對的。全新安裝會在使用者填 Groq key 之前就把 provider 寫成 `gemini`，之後只補 Groq key 不會被拉回 groq，整理會因缺少 Gemini key 退回原文。設定頁有 Gemini 金鑰欄；HUD 上的未整理提示要讓人看得出來是缺金鑰，而不是整理失敗被靜默吞掉。

## 能不能 commit

還不行。commit 前要先改 AX：同一條 worker、有 timeout、panic 與逾時都會清旗標，並且不要和選取偵測並行打進同一個 App。同一輪建議一併補上世代檢查（取 probe 之前，以及 `enhanceText` 的返回與 `catch`），密碼欄連標題都不要送。macOS 上跑過 `cargo clippy --all-targets -- -D warnings` 和 `cargo test` 再推。抄錄守衛維持拿掉。

REVIEW-RESULT: NOT-READY
