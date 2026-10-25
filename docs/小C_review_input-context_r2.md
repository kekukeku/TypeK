- [HIGH] `src-tauri/src/plugins/text_field_reader.rs:292`：`AXRole` 讀取失敗或非字串時仍繼續；若 `AXSubrole` 隨後回 unsupported／no-value，就放行讀取。`AXWebArea` 的 focused child 又未驗證角色（435 行），因此仍有「無法確認角色卻讀取文字」的路徑。應先確認目標為允許的非密碼文字角色，再接受「沒有 subrole」；角色不明直接拒讀。

- [HIGH] `src/lib/enhancer.ts:165`：12 字門檻仍放過第一輪反例。以原始碼函式重現：原文「明天上午九點在公司開會」附加上下文「，密碼是2468」，抄錄、長度、語意守衛全部放行。轉義及不可信標記已補，但短內容外洩仍未攔截。應檢查相對原文新增的內容，處理短敏感片段，並加入此反例；不能以 12 字門檻作為安全保證。

- [MED] `src/lib/enhancer.ts:278`：只有原文與輸出套用簡轉繁，上下文未轉換。已重現：簡體上下文的長句被複製並轉為繁體後，三道守衛仍全部放行。應對所有參與比對的上下文字串套用相同轉換，補上簡體上下文回歸案例。

- [MED] `src/lib/enhancer.ts:167`：精確子字串比對會把正常整理誤判為抄錄。已重現：重述畫面句子後只補逗號，或把「財務抱表」修為「財務報表」，均觸發整段退回原文。12 字視窗包含周圍既有文字，不能區分單字修正與新增內容。應先正規化標點／空白，再區分局部替換與新增片段；單純調整門檻不足。

H1：未修：subrole 錯誤分類已補，但角色不明的放行路徑仍存在。  
H2：已修：refresh 後同步取得 key／model，第一輪指出的錯配窗口已消除。  
H3：已修：上下文等待及 key refresh 後均檢查取消與 epoch。  
H4：未修：轉義及不可信標記已補，抄錄防護仍有上述漏判與誤判。  
M1：已修：測試實際引用兩個正式上限常數。  
M2：已修：轉型前驗證 CFString 型別；非字串釋放，字串由 create-rule wrapper 接管釋放。

AXError 數值正確：[`AttributeUnsupported = -25205`](https://developer.apple.com/documentation/applicationservices/axerror/kaxerrorattributeunsupported)、[`NoValue = -25212`](https://developer.apple.com/documentation/applicationservices/axerror/kaxerrornovalue)，亦已對照本機 SDK header。

正常回傳路徑未發現新增 CF leak／double free；共享字串 helper 對合法字串行為不變，非字串改走既有空值／後備路徑，未見選取或 excerpt 回歸。一般錯誤分支未釋放非 null 值，但未確認 AX 是否會在該情況交付有效的持有引用，故不列為已證實洩漏。

全程未修改檔案；完成原始碼審查、記憶體內反例重現及 `git diff --check`。未執行 Rust 編譯或 clippy；就本次差異未見其他確定的跨平台 lint 阻擋，不能據此宣稱三平台編譯通過。

REVIEW-RESULT: BLOCK