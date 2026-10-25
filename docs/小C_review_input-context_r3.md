- [HIGH] `src/lib/enhancer.ts:248`：以「新增−刪除 ≥ 3」判定，會讓刪除贅詞抵銷外洩內容。已重現：原文「明天上午九點在公司開會，然後就這樣吧」變成「明天上午九點在公司開會，密碼是2468」，同一 hunk 刪 6 字、增 7 字，抄錄、長度、語意守衛全部放行。應避免不相關刪字抵銷新增內容，對上下文來源的替換片段另做檢查，補上此回歸案例。

- [HIGH] `src/lib/enhancer.ts:244`：超過格數上限直接回傳 `false`，使長篇聽寫完全失去抄錄檢查。已重現約千字原文附加「密碼是2468」，三道守衛全部放行；現有 size-cap 測試反而固定了這個行為。應先剝除共同前後綴以縮小比對範圍；仍超限時退回原文，不能把「未檢查」當作安全。

- [MED] `src/lib/enhancer.ts:248`：不等長的正常專名修正仍會誤判。已重現「我們下週要把太普的功能做完」→「我們下週要把 TypeK 的功能做完」，上下文含 TypeK 時被退回原文。`太普 → TypeK` 淨增 3 字，與第 219 行「替換一律放行」的說明矛盾；現有測試用「太普K」只淨增 2 字而避開問題。應區分合理專名替換與額外內容，加入不帶 K 的案例，不能只調整字數門檻。

- [MED] `src-tauri/src/plugins/clipboard_paste.rs:461`：**既有問題，非本次引入**：Linux 分支明確含 `compile_error!`，因此整個 workspace 的 clippy 必定無法通過；第 307 行的 `copy_result` 在 Linux 也會成為 `()`，與後續 `Err` 比對不符。若要求 Linux 通過，需補齊不支援平台的返回路徑及條件編譯。

H1：已修。目標角色讀不到、非字串或不在 allowlist 都會拒讀，WebArea child 亦重新驗證。新子角色分支未見 CFTypeRef 洩漏或 double free：錯誤非空值直接釋放；成功值由型別檢查或 create-rule wrapper 各釋放一次。

H4：未修：第二輪原始短漏字案例與簡繁轉換已修，但上述替換及長文路徑仍可漏出完整上下文片段。

Allowlist 的取捨可接受：標準文字欄位角色已包含；Chromium 的多行文字欄位映射為 `AXTextArea`，Apple 亦定義它為文字檢視角色。自訂編輯器若只暴露 group／未知 child，會失去上下文，但聽寫仍可繼續。未實測 Chrome／Electron、Notes、Slack，不能宣稱全部相容。來源：[Chromium 實作](https://chromium.googlesource.com/chromium/src.git/+/f3dc2485fff2fc4ff77cc167dd875c2c658b63ce/ui/accessibility/platform/browser_accessibility_cocoa.mm)、[Apple 角色定義](https://developer.apple.com/documentation/appkit/nsaccessibility-swift.struct/role/textarea)。

LCS 本身未見索引或 off-by-one 問題；同分優先刪除仍是合法 LCS。以實際函式在記憶體內比對 16,129 組短字串，差異字數均符合獨立 LCS 計算。百萬格限制使 LCS 最長僅 999，`Uint16Array` 不會溢位。3 字可作啟發式門檻，但無法同時保證短片段防漏與跨語言專名修正。

全程未修改檔案。除上述 Linux 既有阻擋，本次 Rust 差異未見確定的 macOS／Windows clippy 問題；未執行 Rust 編譯、clippy 或完整 Vitest。

REVIEW-RESULT: BLOCK