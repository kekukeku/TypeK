/// 讀取當前 focused text field 游標附近的文字。
/// macOS: 透過 AXUIElement Accessibility API。
/// Windows: 透過 UI Automation（IUIAutomation + TextPattern/ValuePattern，跑在專用 MTA 執行緒）。
///
/// 契約：回傳「游標附近、有上限」的文字（非整份文件）；讀不到一律回 `Ok(None)`。
#[tauri::command]
pub fn read_focused_text_field() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_focused_text_field_impl()
    }

    #[cfg(target_os = "windows")]
    {
        windows_impl::read_focused_text_field_impl()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

/// 讀取當前聚焦文字欄位中被選取（highlight）的文字。
/// 編輯模式的「剪貼簿後備」路徑：僅在 `read_selection_state` 回報
/// unavailable（AX 不可見的 App）時、於錄音停止且按鍵放開後由前端呼叫。
/// 透過模擬 Cmd+C / Ctrl+C 擷取剪貼簿內容。
#[tauri::command]
pub fn read_selected_text() -> Result<Option<String>, String> {
    super::clipboard_paste::capture_selected_text_via_clipboard()
}

/// 選取狀態偵測結果（#24/#25 編輯模式判定）。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    /// "selection" | "noSelection" | "unavailable"
    pub kind: String,
    pub text: Option<String>,
}

impl SelectionState {
    // selection / no_selection 由 macOS 的 AX 分類器與 Windows 的剪貼簿判定使用；
    // unavailable 只剩 macOS 與其他平台會回。cfg 閘避免 dead_code 撞上 clippy -D warnings
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn selection(text: String) -> Self {
        Self {
            kind: "selection".to_string(),
            text: Some(text),
        }
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn no_selection() -> Self {
        Self {
            kind: "noSelection".to_string(),
            text: None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    fn unavailable() -> Self {
        Self {
            kind: "unavailable".to_string(),
            text: None,
        }
    }
}

/// Windows UIA 選取範圍是否算「有選取」（#79/#80）：恰好一段、且起點不等於終點。
/// 零段、退化範圍（起點＝終點，UIA 無選取時回傳游標位置）、多段（本版不支援編輯）
/// 一律不算。`start_vs_end` 是該段起點相對終點的比較結果（`CompareEndpoints`），
/// 讀不到時為 `None`。與平台無關的判定抽出來，讓 macOS 也能跑測試。
#[cfg(any(target_os = "windows", test))]
fn is_single_non_degenerate_range(range_count: i32, start_vs_end: Option<i32>) -> bool {
    range_count == 1 && matches!(start_vs_end, Some(cmp) if cmp != 0)
}

/// 讀取聚焦文字欄位的選取狀態——編輯模式判定的主路徑。
/// macOS：AX 被動查詢（零按鍵模擬，#25 的字元污染在此路徑不可能發生）。三態：
///   selection    — 確定有選取，text 為選取內容 → 前端直接進編輯模式
///   noSelection  — 確定無選取（AX 可讀且長度 0）→ 一般聽寫，
///                  CodeMirror 類編輯器的「無選取複製整行」誤判（#24）在此被排除
///   unavailable  — AX 不可見或讀值失真（Heptabase/LINE 類）→ 前端在錄音停止、
///                  按鍵放開後改走剪貼簿後備（read_selected_text）
/// Windows：UIA 被動讀取選取（#79/#80），**不模擬任何按鍵**——舊做法在錄音開始時
///   送 Ctrl+C，按住 Alt／Shift 觸發時目標程式收到的是 Alt+Ctrl+C，讀不到選取還會
///   多打字元。只回 selection / noSelection：讀不到、不支援、逾時都是 noSelection，
///   本輪不進編輯模式；**不回 unavailable**，前端在 Windows 也不排程剪貼簿後備。
///   計畫：docs/plan-windows-uia-selection.md
/// 其他平台：一律 unavailable。
#[tauri::command]
pub fn read_selection_state() -> SelectionState {
    #[cfg(target_os = "macos")]
    {
        macos::read_selection_state_impl()
    }

    #[cfg(target_os = "windows")]
    {
        match windows_impl::read_selection_impl() {
            Some(text) => SelectionState::selection(text),
            None => SelectionState::no_selection(),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        SelectionState::unavailable()
    }
}

/// AI 整理用的輸入上下文：游標所在 App、視窗標題與游標前後文字。
/// 讀不到的欄位一律 `None`；密碼欄不讀文字。計畫：docs/plan-input-context.md
#[derive(serde::Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputContext {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub text_before_cursor: Option<String>,
    pub text_after_cursor: Option<String>,
}

/// 讀取輸入上下文。macOS：請求送到與選取偵測共用的 AX worker，最多等 1.5 秒
/// （等待本身放在 blocking 執行緒上，不佔 command 主執行緒）；前端另設 300ms 取用上限。
/// Windows／其他平台：本版回空內容。
#[tauri::command]
pub async fn read_input_context() -> InputContext {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(macos::read_input_context_impl)
            .await
            .unwrap_or_default()
    }

    #[cfg(not(target_os = "macos"))]
    {
        InputContext::default()
    }
}

/// 游標前文字上限（字元）。前文對判斷同音字與專有名詞最有用，給得比後文多。
#[cfg(any(target_os = "macos", test))]
const CONTEXT_BEFORE_CHARS: usize = 300;
/// 游標後文字上限（字元）。
#[cfg(any(target_os = "macos", test))]
const CONTEXT_AFTER_CHARS: usize = 100;

/// 依 AX 選取範圍（`location`／`length`，UTF-16 單位）把欄位全文切成游標前、後兩段，
/// 前段取最後 `before_limit` 字、後段取最前 `after_limit` 字；選取中的文字不算前後文。
/// 範圍讀不到時把全文當作游標前文字。與平台無關，抽出來讓 macOS 以外也能跑測試。
#[cfg(any(target_os = "macos", test))]
fn split_text_around_selection(
    full_text: &str,
    selection: Option<(usize, usize)>,
    before_limit: usize,
    after_limit: usize,
) -> (String, String) {
    let units: Vec<u16> = full_text.encode_utf16().collect();
    let (start, end) = match selection {
        Some((location, length)) => {
            let start = location.min(units.len());
            let end = location.saturating_add(length).min(units.len());
            (start, end)
        }
        None => (units.len(), units.len()),
    };

    let before = String::from_utf16_lossy(&units[..start]);
    let after = String::from_utf16_lossy(&units[end..]);

    let before_count = before.chars().count();
    let before = before
        .chars()
        .skip(before_count.saturating_sub(before_limit))
        .collect();
    let after = after.chars().take(after_limit).collect();
    (before, after)
}

/// App 名稱與視窗標題上限（字元）：瀏覽器分頁標題可能很長，且常帶文件名或主旨。
#[cfg(any(target_os = "macos", test))]
const CONTEXT_TITLE_CHARS: usize = 120;

/// 取前 `limit` 個字元。
#[cfg(any(target_os = "macos", test))]
fn cap_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// 空白字串視為讀不到。
#[cfg(any(target_os = "macos", test))]
fn non_blank(text: String) -> Option<String> {
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

// ========== macOS: AXUIElement ==========

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::os::raw::c_int;

    type AXUIElementRef = CFTypeRef;
    type AXError = c_int;

    const K_AX_ERROR_SUCCESS: AXError = 0;
    const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
    const K_AX_ERROR_NO_VALUE: AXError = -25212;

    // AX attribute name constants
    const K_AX_FOCUSED_APPLICATION_ATTRIBUTE: &str = "AXFocusedApplication";
    const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE: &str = "AXFocusedUIElement";
    const K_AX_VALUE_ATTRIBUTE: &str = "AXValue";
    const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE: &str = "AXSelectedTextRange";
    const K_AX_SELECTED_TEXT_ATTRIBUTE: &str = "AXSelectedText";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";
    const K_AX_SUBROLE_ATTRIBUTE: &str = "AXSubrole";
    const K_AX_TITLE_ATTRIBUTE: &str = "AXTitle";
    const K_AX_FOCUSED_WINDOW_ATTRIBUTE: &str = "AXFocusedWindow";
    /// 密碼欄的子角色：角色仍是 AXTextField，必須另外擋
    const K_AX_SECURE_TEXT_FIELD_SUBROLE: &str = "AXSecureTextField";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    /// 選取狀態讀取的總 timeout：AX 是同步跨進程呼叫，目標 App 卡死會阻塞
    /// （對齊 windows_impl 的守衛設計）。上限涵蓋「解析失敗 → 戳醒 Electron →
    /// 等樹重建 → 重試」的最長路徑。
    const SELECTION_READ_TIMEOUT_MS: u64 = 600;
    /// 對 Electron 施加 AXManualAccessibility 後等樹重建的時間。
    const POKE_SETTLE_MS: u64 = 150;

    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: CFTypeRef,
        ) -> AXError;
    }

    // CFRange struct for AXValue extraction
    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct CFRange {
        location: i64,
        length: i64,
    }

    extern "C" {
        fn AXValueGetValue(value: CFTypeRef, value_type: u32, value_ptr: *mut c_void) -> bool;
    }

    // kAXValueCFRangeType = 4
    const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;

    fn get_ax_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<CFTypeRef> {
        let attr = CFString::new(attribute_name);
        let mut value: CFTypeRef = std::ptr::null();

        let err =
            unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };

        if err != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    fn get_ax_string_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<String> {
        let value = get_ax_attribute(element, attribute_name)?;
        cf_value_into_string(value)
    }

    /// 接手一個 +1 的 CFTypeRef：是 CFString 才轉成 String，否則釋放後回 None。
    /// AX 屬性值不保證是字串（例如數值型 AXValue），未驗型別就當 CFString 用會 native crash。
    fn cf_value_into_string(value: CFTypeRef) -> Option<String> {
        if unsafe { CFGetTypeID(value) } != CFString::type_id() {
            unsafe { CFRelease(value) };
            return None;
        }
        let cf_string = unsafe { CFString::wrap_under_create_rule(value as *const _) };
        Some(cf_string.to_string())
    }

    /// 讀取 AXSelectedTextRange 並解出 CFRange（游標位置 + 選取長度的共用來源）。
    fn read_selected_text_range(element: AXUIElementRef) -> Option<CFRange> {
        let value = get_ax_attribute(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE)?;

        let mut range = CFRange {
            location: 0,
            length: 0,
        };

        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_CF_RANGE_TYPE,
                &mut range as *mut CFRange as *mut c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success {
            Some(range)
        } else {
            None
        }
    }

    fn get_cursor_position(element: AXUIElementRef) -> Option<usize> {
        let range = read_selected_text_range(element)?;
        if range.location >= 0 {
            Some(range.location as usize)
        } else {
            None
        }
    }

    fn extract_excerpt(full_text: &str, cursor_pos: Option<usize>, context: usize) -> String {
        let chars: Vec<char> = full_text.chars().collect();
        let len = chars.len();

        if len == 0 {
            return String::new();
        }

        let pos = match cursor_pos {
            Some(p) if p <= len => p,
            _ => {
                // fallback: 取末尾 FALLBACK_CHARS 字
                let start = len.saturating_sub(FALLBACK_CHARS);
                return chars[start..].iter().collect();
            }
        };

        let start = pos.saturating_sub(context);
        let end = (pos + context).min(len);

        chars[start..end].iter().collect()
    }

    fn is_text_input_role(role: &str) -> bool {
        matches!(
            role,
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXWebArea"
        )
    }

    /// AX 元素走訪結果。呼叫端負責讀取屬性後呼叫 `cleanup()` 釋放所有 CFTypeRef。
    struct FocusedElementContext {
        system_wide: AXUIElementRef,
        app: AXUIElementRef,
        element: AXUIElementRef,
        target_element: AXUIElementRef,
    }

    impl FocusedElementContext {
        fn cleanup(self) {
            unsafe {
                if self.target_element != self.element {
                    CFRelease(self.target_element);
                }
                CFRelease(self.element);
                CFRelease(self.app);
                CFRelease(self.system_wide);
            }
        }
    }

    /// 走訪 AX 樹取得當前聚焦的文字輸入元素。
    /// 共用邏輯：system-wide → focused app → focused element → role check → WebArea child。
    fn resolve_focused_text_element() -> Option<FocusedElementContext> {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return None;
        }

        let app = match get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            Some(a) => a,
            None => {
                unsafe { CFRelease(system_wide) };
                return None;
            }
        };

        let element = match get_ax_attribute(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
            Some(e) => e,
            None => {
                unsafe {
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        let target_element = match role.as_deref() {
            Some(r) if is_text_input_role(r) => {
                if r == "AXWebArea" {
                    match get_ax_attribute(element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
                        Some(child) => child,
                        None => element,
                    }
                } else {
                    element
                }
            }
            _ => {
                unsafe {
                    CFRelease(element);
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        Some(FocusedElementContext {
            system_wide,
            app,
            element,
            target_element,
        })
    }

    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let ctx = match resolve_focused_text_element() {
            Some(c) => c,
            None => return Ok(None),
        };

        let cursor_pos = get_cursor_position(ctx.target_element);
        let full_text = get_ax_string_attribute(ctx.target_element, K_AX_VALUE_ATTRIBUTE);
        ctx.cleanup();

        match full_text {
            Some(text) if !text.is_empty() => {
                let excerpt = extract_excerpt(&text, cursor_pos, CONTEXT_CHARS);
                if excerpt.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(excerpt))
                }
            }
            _ => Ok(None),
        }
    }

    // ========== 輸入上下文（AI 整理用） ==========

    use super::{
        cap_chars, non_blank, split_text_around_selection, InputContext, CONTEXT_AFTER_CHARS,
        CONTEXT_BEFORE_CHARS, CONTEXT_TITLE_CHARS,
    };

    /// 上下文讀取的總 timeout（自送出請求起算）。上下文與選取偵測共用同一條 AX worker，
    /// 錄音開始時兩個請求幾乎同時送出、依序執行，要涵蓋排在前面的選取偵測最長
    /// SELECTION_READ_TIMEOUT_MS，再加上本身的讀取。前端另有 300ms 的取用上限。
    const CONTEXT_READ_TIMEOUT_MS: u64 = 1_500;

    /// 入口：送到共用的 AX worker（不另開執行緒，不和選取偵測並行打進同一個 App），
    /// 最多等 CONTEXT_READ_TIMEOUT_MS。worker 忙碌（佇列滿）、逾時、已死一律回空內容。
    pub fn read_input_context_impl() -> InputContext {
        let Some(sender) = ax_worker_sender() else {
            return InputContext::default();
        };
        let (resp_tx, resp_rx) = sync_channel::<InputContext>(1);
        if sender.try_send(AxRequest::Context(resp_tx)).is_err() {
            return InputContext::default();
        }
        resp_rx
            .recv_timeout(Duration::from_millis(CONTEXT_READ_TIMEOUT_MS))
            .unwrap_or_default()
    }

    /// 聚焦文字元素對上下文讀取的處理方式。
    enum FieldTextPolicy {
        /// 確定是一般文字欄位：讀取欄位文字
        Read,
        /// 網頁區域本身（沒有聚焦的子欄位）：不是輸入框，不讀文字，App 與視窗標題照送
        SkipText,
        /// 密碼欄或無法判定：四個欄位全部不送（含 App 與視窗標題，登入視窗標題可能帶帳號）
        Sensitive,
    }

    /// 上下文讀取的欄位判定：
    /// - 角色讀不到 → Sensitive
    /// - 角色是 AXWebArea（resolver 找不到子元素時退回 WebArea 本身）→ SkipText
    /// - 角色不是 AXTextField／AXTextArea／AXComboBox（含 AXSecureTextField、WebArea 底下的未知子元素）→ Sensitive
    /// - 子角色是 AXSecureTextField → Sensitive
    /// - 子角色「不支援／無值」→ 一般文字角色本來就沒有子角色（AXTextArea 常見）→ Read
    /// - 其他錯誤或值不是字串 → Sensitive
    fn field_text_policy(element: AXUIElementRef) -> FieldTextPolicy {
        match get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE).as_deref() {
            Some("AXWebArea") => return FieldTextPolicy::SkipText,
            Some("AXTextField" | "AXTextArea" | "AXComboBox") => {}
            _ => return FieldTextPolicy::Sensitive,
        }

        let attr = CFString::new(K_AX_SUBROLE_ATTRIBUTE);
        let mut value: CFTypeRef = std::ptr::null();
        let err =
            unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
        if err != K_AX_ERROR_SUCCESS {
            if !value.is_null() {
                unsafe { CFRelease(value) };
            }
            return if err == K_AX_ERROR_ATTRIBUTE_UNSUPPORTED || err == K_AX_ERROR_NO_VALUE {
                FieldTextPolicy::Read
            } else {
                FieldTextPolicy::Sensitive
            };
        }
        if value.is_null() {
            return FieldTextPolicy::Sensitive;
        }
        match cf_value_into_string(value) {
            Some(subrole) if subrole != K_AX_SECURE_TEXT_FIELD_SUBROLE => FieldTextPolicy::Read,
            _ => FieldTextPolicy::Sensitive,
        }
    }

    /// resolver 找不到文字欄位時的密碼欄補查：聚焦元素的角色或子角色是 AXSecureTextField
    /// → true。沒有聚焦元素 → false（沒有欄位可言）；有元素但角色讀不到 → 無法判定 → true。
    fn focused_element_may_be_secure() -> bool {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return true;
        }
        let Some(app) = get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) else {
            unsafe { CFRelease(system_wide) };
            return false;
        };
        let element = get_ax_attribute(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE);
        unsafe {
            CFRelease(app);
            CFRelease(system_wide);
        }
        let Some(element) = element else {
            return false;
        };

        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        let subrole = get_ax_string_attribute(element, K_AX_SUBROLE_ATTRIBUTE);
        unsafe { CFRelease(element) };
        match role.as_deref() {
            None => true,
            Some(role) => {
                role == K_AX_SECURE_TEXT_FIELD_SUBROLE
                    || subrole.as_deref() == Some(K_AX_SECURE_TEXT_FIELD_SUBROLE)
            }
        }
    }

    /// 讀 App 名稱與聚焦視窗標題（各自截到 CONTEXT_TITLE_CHARS）。
    fn read_app_and_window_title(context: &mut InputContext) {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return;
        }
        if let Some(app) = get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            context.app_name = get_ax_string_attribute(app, K_AX_TITLE_ATTRIBUTE)
                .map(|title| cap_chars(&title, CONTEXT_TITLE_CHARS))
                .and_then(non_blank);
            if let Some(window) = get_ax_attribute(app, K_AX_FOCUSED_WINDOW_ATTRIBUTE) {
                context.window_title = get_ax_string_attribute(window, K_AX_TITLE_ATTRIBUTE)
                    .map(|title| cap_chars(&title, CONTEXT_TITLE_CHARS))
                    .and_then(non_blank);
                unsafe { CFRelease(window) };
            }
            unsafe { CFRelease(app) };
        }
        unsafe { CFRelease(system_wide) };
    }

    /// 在 AX worker 上執行。先判定聚焦欄位：敏感就整包回空，連 App 與視窗標題都不讀。
    fn input_context_blocking() -> InputContext {
        let mut context = InputContext::default();

        let Some(field) = resolve_focused_text_element() else {
            // 沒有聚焦的文字欄位（例如焦點在按鈕上）：App 與視窗標題照送。
            // 例外：resolver 只收文字輸入角色，角色本身就是 AXSecureTextField 的密碼欄會落到這裡
            if !focused_element_may_be_secure() {
                read_app_and_window_title(&mut context);
            }
            return context;
        };

        match field_text_policy(field.target_element) {
            FieldTextPolicy::Sensitive => {}
            FieldTextPolicy::SkipText => read_app_and_window_title(&mut context),
            FieldTextPolicy::Read => {
                read_app_and_window_title(&mut context);
                let selection = read_selected_text_range(field.target_element)
                    .filter(|range| range.location >= 0 && range.length >= 0)
                    .map(|range| (range.location as usize, range.length as usize));
                if let Some(text) =
                    get_ax_string_attribute(field.target_element, K_AX_VALUE_ATTRIBUTE)
                {
                    let (before, after) = split_text_around_selection(
                        &text,
                        selection,
                        CONTEXT_BEFORE_CHARS,
                        CONTEXT_AFTER_CHARS,
                    );
                    context.text_before_cursor = non_blank(before);
                    context.text_after_cursor = non_blank(after);
                }
            }
        }
        field.cleanup();
        context
    }

    // ========== 選取狀態偵測（#24/#25 編輯模式判定） ==========

    use super::SelectionState;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::panic::catch_unwind;
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    /// 送給共用 AX worker 的請求：選取偵測（編輯模式判定）或輸入上下文（AI 整理）。
    /// 兩者跑在同一條執行緒上依序執行，不會同時打進同一個 App 的 AX server。
    enum AxRequest {
        Selection(SyncSender<SelectionState>),
        Context(SyncSender<InputContext>),
    }

    /// 佇列容量：錄音開始時選取偵測與上下文幾乎同時送出，要能同時排進去。
    /// worker 卡死時佇列很快填滿，之後的請求 try_send 失敗、立刻降級，不會無上界堆積。
    const AX_WORKER_QUEUE_CAPACITY: usize = 2;

    static SELECTION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static AX_WORKER: OnceLock<Option<Mutex<SyncSender<AxRequest>>>> = OnceLock::new();

    /// 讀取聚焦元素的選取長度（AXSelectedTextRange.length）。
    /// length > 0 = 真的有選取；length == 0 = 只有游標、沒選取
    /// （編輯器「無選取時 Cmd+C 複製整行」不影響 AX 層的選取範圍，故能分辨）。
    fn get_selection_length(element: AXUIElementRef) -> Option<i64> {
        read_selected_text_range(element).map(|range| range.length)
    }

    /// Electron/Chromium 的無障礙樹是惰性啟用的：對焦點 App 設
    /// AXManualAccessibility=true 可強制喚醒完整樹（Electron 官方支援的旗標）。
    /// 對原生 App 設此屬性會失敗，無副作用。
    fn poke_focused_app_manual_accessibility() {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return;
        }
        if let Some(app) = get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            let attr = CFString::new("AXManualAccessibility");
            let value = core_foundation::boolean::CFBoolean::true_value();
            unsafe {
                AXUIElementSetAttributeValue(app, attr.as_CFTypeRef(), value.as_CFTypeRef());
                CFRelease(app);
            }
        }
        unsafe { CFRelease(system_wide) };
    }

    /// 依已解析的聚焦文字元素分類選取狀態。消耗 ctx 並負責釋放。
    fn classify_selection(ctx: FocusedElementContext) -> SelectionState {
        let state = match get_selection_length(ctx.target_element) {
            Some(len) if len > 0 => {
                match get_ax_string_attribute(ctx.target_element, K_AX_SELECTED_TEXT_ATTRIBUTE) {
                    Some(text) if !text.trim().is_empty() => SelectionState::selection(text),
                    // 長度 > 0 但文字讀不到/為空 = 橋接失真（Electron 已知失效模式），
                    // 交給剪貼簿後備嘗試撈回真實選取
                    _ => SelectionState::unavailable(),
                }
            }
            Some(_) => SelectionState::no_selection(),
            // 元素是文字輸入類但範圍屬性不支援 → 無法判定
            None => SelectionState::unavailable(),
        };
        ctx.cleanup();
        state
    }

    /// 阻塞式選取偵測：第一次解析失敗時戳醒 Electron 樹再試一次。
    /// 全程只做被動 AX 查詢，不模擬任何按鍵。
    fn selection_probe_blocking() -> SelectionState {
        if let Some(ctx) = resolve_focused_text_element() {
            return classify_selection(ctx);
        }
        poke_focused_app_manual_accessibility();
        std::thread::sleep(Duration::from_millis(POKE_SETTLE_MS));
        match resolve_focused_text_element() {
            Some(ctx) => classify_selection(ctx),
            None => SelectionState::unavailable(),
        }
    }

    /// 入口：AX 讀取跑在單一常駐 worker 執行緒上、最多等 SELECTION_READ_TIMEOUT_MS
    /// （AX 為同步跨進程呼叫，目標 App 卡死不可拖住 command thread——
    /// 對齊 windows_impl 的守衛模式；常駐而非每次 spawn，卡死時最多損失
    /// 一條執行緒、不會隨熱鍵次數無上界累積）。逾時 / 忙碌一律回 unavailable，
    /// 由前端剪貼簿後備接手。
    pub fn read_selection_state_impl() -> SelectionState {
        let sender = match ax_worker_sender() {
            Some(s) => s,
            None => return SelectionState::unavailable(),
        };

        // single-flight：熱鍵連按時避免 AX 讀取堆疊。
        // 旗標由「呼叫端」在所有路徑後無條件清掉，不依賴 worker
        // （worker 卡死時遲到結果只會送進已 drop 的 receiver 而被丟棄）
        if SELECTION_IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return SelectionState::unavailable();
        }

        let outcome = selection_read_once(&sender);
        SELECTION_IN_FLIGHT.store(false, Ordering::Release);
        outcome
    }

    fn selection_read_once(sender: &SyncSender<AxRequest>) -> SelectionState {
        let (resp_tx, resp_rx) = sync_channel::<SelectionState>(1);
        if sender.try_send(AxRequest::Selection(resp_tx)).is_err() {
            // worker 卡在先前的請求、佇列已滿（目標 App 的 AX server 無回應）
            return SelectionState::unavailable();
        }
        resp_rx
            .recv_timeout(Duration::from_millis(SELECTION_READ_TIMEOUT_MS))
            .unwrap_or_else(|_| SelectionState::unavailable())
    }

    fn ax_worker_sender() -> Option<SyncSender<AxRequest>> {
        let cell = AX_WORKER.get_or_init(spawn_ax_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    fn spawn_ax_worker() -> Option<Mutex<SyncSender<AxRequest>>> {
        let (req_tx, req_rx) = sync_channel::<AxRequest>(AX_WORKER_QUEUE_CAPACITY);
        std::thread::Builder::new()
            .name("ax-selection-reader".into())
            .spawn(move || ax_worker_loop(req_rx))
            .ok()?;
        Some(Mutex::new(req_tx))
    }

    /// 單一常駐 worker。dev build 下單次讀取 panic 只讓該請求回降級值（resp_tx 被 drop，
    /// 呼叫端 recv 立刻失敗），worker 繼續服務下一個請求。
    /// 注意：release profile 設 `panic = "abort"`，正式版 panic 會直接結束程式，
    /// catch_unwind 不構成防護；讀取路徑本身不得有 unwrap／未 clamp 的索引。
    fn ax_worker_loop(req_rx: Receiver<AxRequest>) {
        while let Ok(request) = req_rx.recv() {
            // 呼叫端可能已逾時離開（receiver drop）：try_send 失敗直接丟棄
            match request {
                AxRequest::Selection(resp_tx) => {
                    if let Ok(result) = catch_unwind(selection_probe_blocking) {
                        let _ = resp_tx.try_send(result);
                    }
                }
                AxRequest::Context(resp_tx) => {
                    if let Ok(result) = catch_unwind(input_context_blocking) {
                        let _ = resp_tx.try_send(result);
                    }
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_extract_excerpt_empty() {
            assert_eq!(extract_excerpt("", None, 50), "");
        }

        #[test]
        fn test_extract_excerpt_short_text() {
            let text = "Hello world";
            let result = extract_excerpt(text, Some(5), 50);
            assert_eq!(result, "Hello world");
        }

        #[test]
        fn test_extract_excerpt_cursor_in_middle() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(100), 50);
            assert_eq!(result.chars().count(), 100); // 50 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_start() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(0), 50);
            assert_eq!(result.chars().count(), 50); // 0 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_end() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(200), 50);
            assert_eq!(result.chars().count(), 50); // 50 before + 0 after
        }

        #[test]
        fn test_extract_excerpt_no_cursor_fallback() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, None, 50);
            assert_eq!(result.chars().count(), 100); // fallback last 100 chars
        }

        #[test]
        fn test_extract_excerpt_cjk_characters() {
            let text =
                "這是一段很長的中文測試文字，用來驗證游標附近截取功能是否正確處理多位元組字元";
            let result = extract_excerpt(text, Some(10), 5);
            assert_eq!(result.chars().count(), 10); // 5 before + 5 after
        }

        #[test]
        fn test_is_text_input_role() {
            assert!(is_text_input_role("AXTextField"));
            assert!(is_text_input_role("AXTextArea"));
            assert!(is_text_input_role("AXComboBox"));
            assert!(is_text_input_role("AXWebArea"));
            assert!(!is_text_input_role("AXButton"));
            assert!(!is_text_input_role("AXStaticText"));
        }
    }
}

// ========== Windows: UI Automation ==========

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    use windows::core::BOOL;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextPattern2, IUIAutomationTextRange, IUIAutomationValuePattern,
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
        UIA_TextPattern2Id, UIA_TextPatternId, UIA_ValuePatternId,
    };

    /// 游標前後各取的字數（對齊 macOS CONTEXT_CHARS）。
    const CONTEXT_CHARS: i32 = 50;
    /// TextPattern GetText 上限＝游標前後 excerpt 寬度（caret ± CONTEXT_CHARS）。
    /// 設成 excerpt 寬度，確保即使 provider 未照 MoveEndpointByUnit 收斂，
    /// 回傳的仍是「從 range 起點（caret 前緣）」起算的 caret 區段，不會被 cap_tail 從尾端截掉。
    const GET_TEXT_CAP: i32 = CONTEXT_CHARS * 2;
    /// ValuePattern 整欄值 fallback 的字元上限（隱私 / 成本保護）。
    const MAX_VALUE_CHARS: usize = 600;
    /// 單次 UIA 讀取 timeout，需小於前端輪詢間隔（500ms），避免阻塞 command thread。
    /// 首次呼叫的 COM／UIA 初始化也在這個期限內（worker 不再同步回報就緒）。
    const READ_TIMEOUT_MS: u64 = 250;

    type RespTx = SyncSender<Option<String>>;

    /// 送給 UIA worker 的請求：游標附近摘錄（欄位輪詢）或目前選取（編輯模式判定，#79/#80）。
    enum Request {
        Excerpt(RespTx),
        Selection(RespTx),
    }

    /// 只管欄位輪詢的 single-flight；選取讀取不受它拒絕，免得被每 500ms 的輪詢擠掉。
    static IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static WORKER: OnceLock<Option<Mutex<SyncSender<Request>>>> = OnceLock::new();

    /// 入口：把讀取請求送到專用 UIA 執行緒，最多等 `READ_TIMEOUT_MS`。
    /// 任何失敗 / 逾時 / 忙碌一律回 `Ok(None)`（與 macOS 一致，靜默降級）。
    ///
    /// 契約：回傳游標附近「有上限」的文字（TextPattern excerpt ≤ ~100 字，
    /// 或 ValuePattern 整欄值 ≤ `MAX_VALUE_CHARS` 字），絕不回傳整份文件。
    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let sender = match worker_sender() {
            Some(s) => s,
            None => return Ok(None),
        };

        // single-flight：已有讀取進行中就放棄這次，避免輪詢呼叫堆疊阻塞。
        if IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return Ok(None);
        }

        // 由「呼叫端」在所有路徑（成功 / 逾時 / 送出失敗）後清掉 IN_FLIGHT，
        // 不依賴 worker 清旗標：若某次 UIA 呼叫永久卡死、worker 回不來，
        // 旗標才不會永久卡 true 而使功能靜默失效。每次呼叫各有獨立 oneshot
        // channel，卡死 worker 的遲到結果只會送進已 drop 的 receiver 而被丟棄。
        let outcome = read_once(
            &sender,
            Request::Excerpt,
            Duration::from_millis(READ_TIMEOUT_MS),
        );
        IN_FLIGHT.store(false, Ordering::Release);
        Ok(outcome)
    }

    /// 讀取目前聚焦欄位中被選取的文字（#79/#80：取代模擬 Ctrl+C 的剪貼簿探測）。
    /// 恰好一段、且非退化的選取才回 `Some`；其餘（無選取、多段、不支援、錯誤、
    /// 逾時、佇列已滿）一律 `None`——呼叫端視為無選取，**不退回複製**。
    pub fn read_selection_impl() -> Option<String> {
        let sender = worker_sender()?;
        read_once(
            &sender,
            Request::Selection,
            Duration::from_millis(READ_TIMEOUT_MS),
        )
    }

    /// 送一次讀取請求並最多等 `timeout`（正式呼叫一律 `READ_TIMEOUT_MS`，參數化是為了
    /// 讓測試用寬鬆期限驗證「立即返回」而不依賴 CI 排程）；逾時 / 送出失敗 /
    /// worker 已退出一律回 `None`。
    fn read_once(
        sender: &SyncSender<Request>,
        make_request: fn(RespTx) -> Request,
        timeout: Duration,
    ) -> Option<String> {
        let (resp_tx, resp_rx) = sync_channel::<Option<String>>(1);
        if sender.try_send(make_request(resp_tx)).is_err() {
            return None;
        }
        resp_rx.recv_timeout(timeout).unwrap_or(None)
    }

    fn worker_sender() -> Option<SyncSender<Request>> {
        let cell = WORKER.get_or_init(spawn_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    /// 啟動長壽 MTA 執行緒，內含快取的 `IUIAutomation`。
    /// 不同步等待就緒：初始化時間由第一個請求的 `READ_TIMEOUT_MS` 涵蓋；
    /// 初始化失敗時 worker 直接結束、佇列斷開，之後的請求立即回 `None`。
    fn spawn_worker() -> Option<Mutex<SyncSender<Request>>> {
        spawn_worker_with(worker_loop)
    }

    /// `spawn_worker` 的本體；worker 函式可注入，讓測試模擬初始化卡住。
    fn spawn_worker_with(worker: fn(Receiver<Request>)) -> Option<Mutex<SyncSender<Request>>> {
        let (req_tx, req_rx) = sync_channel::<Request>(1);

        std::thread::Builder::new()
            .name("uia-reader".into())
            .spawn(move || worker(req_rx))
            .ok()?;

        Some(Mutex::new(req_tx))
    }

    fn worker_loop(req_rx: Receiver<Request>) {
        // 此執行緒專用 MTA COM，存活整個 process 生命週期；COM 物件不跨執行緒傳遞。
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let automation: IUIAutomation =
            match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) } {
                Ok(a) => a,
                Err(_) => {
                    // 結束執行緒＝req_rx 被 drop：已排入的請求隨之斷開，呼叫端立即拿到 None
                    unsafe { CoUninitialize() };
                    return;
                }
            };

        while let Ok(request) = req_rx.recv() {
            let (resp_tx, result) = match request {
                Request::Excerpt(tx) => (tx, read_excerpt(&automation)),
                Request::Selection(tx) => (tx, read_selection(&automation)),
            };
            // 即使呼叫端已逾時離開（receiver 被 drop）也不阻塞；IN_FLIGHT 由呼叫端清。
            let _ = resp_tx.try_send(result);
        }

        unsafe { CoUninitialize() };
    }

    /// 讀取目前聚焦元素的選取文字。全程在 worker 執行緒上跑。
    /// 只收恰好一段、起點≠終點的選取，讀該範圍原文——不擴張、不讀整欄、不截斷
    /// （與 macOS 的 AXSelectedText 一致，選取讀取不設長度上限）。
    fn read_selection(automation: &IUIAutomation) -> Option<String> {
        let element = unsafe { automation.GetFocusedElement() }.ok()?;

        // 隱私保護：與欄位摘錄同一規則，密碼 / 受保護欄位不讀。
        if is_password_element(&element) {
            return None;
        }

        unsafe {
            let text_pattern = element
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()?;
            let ranges = text_pattern.GetSelection().ok()?;
            let range_count = ranges.Length().ok()?;
            let first = if range_count >= 1 {
                ranges.GetElement(0).ok()
            } else {
                None
            };
            let start_vs_end = first.as_ref().and_then(|range| {
                range
                    .CompareEndpoints(
                        TextPatternRangeEndpoint_Start,
                        range,
                        TextPatternRangeEndpoint_End,
                    )
                    .ok()
            });
            if !super::is_single_non_degenerate_range(range_count, start_vs_end) {
                return None;
            }
            let text = first?.GetText(-1).ok()?.to_string();
            // 沿用既有政策：純空白不算選取（與 macOS classify_selection 一致）
            if text.trim().is_empty() {
                return None;
            }
            Some(text)
        }
    }

    /// 讀取目前聚焦元素游標附近文字。全程在 worker 執行緒上跑。
    fn read_excerpt(automation: &IUIAutomation) -> Option<String> {
        let element = unsafe { automation.GetFocusedElement() }.ok()?;

        // 隱私保護：聚焦在密碼 / 受保護欄位時不讀取，避免把密碼 / token / API key 送 LLM。
        if is_password_element(&element) {
            return None;
        }

        // 1) 優先：TextPattern 游標附近 excerpt（涵蓋 contenteditable，如 Teams / 文件編輯器）。
        if let Some(text) = read_via_text_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, (CONTEXT_CHARS as usize) * 2));
            }
        }

        // 2) Fallback：ValuePattern 整欄值（涵蓋原生 input / textarea），capped。
        if let Some(text) = read_via_value_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, MAX_VALUE_CHARS));
            }
        }

        None
    }

    /// 聚焦元素是否為密碼 / 受保護欄位（讀不到屬性時保守視為「是」→ fail-closed，
    /// 對未正確暴露 IsPassword 的第三方欄位較安全，避免把可能的密碼 / token 送 LLM）。
    fn is_password_element(element: &IUIAutomationElement) -> bool {
        unsafe { element.CurrentIsPassword() }
            .map(|b| b.as_bool())
            .unwrap_or(true)
    }

    fn read_via_text_pattern(element: &IUIAutomationElement) -> Option<String> {
        let range = caret_range(element)?;
        unsafe {
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -CONTEXT_CHARS,
            );
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                CONTEXT_CHARS,
            );
            let bstr = range.GetText(GET_TEXT_CAP).ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取得游標 range：先試 `TextPattern2.GetCaretRange`，再 fallback 到 `TextPattern.GetSelection()[0]`。
    fn caret_range(element: &IUIAutomationElement) -> Option<IUIAutomationTextRange> {
        unsafe {
            if let Ok(tp2) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
            {
                let mut is_active = BOOL(0);
                if let Ok(range) = tp2.GetCaretRange(&mut is_active) {
                    return Some(range);
                }
            }

            if let Ok(tp) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                if let Ok(selection) = tp.GetSelection() {
                    if matches!(selection.Length(), Ok(len) if len > 0) {
                        if let Ok(range) = selection.GetElement(0) {
                            return Some(range);
                        }
                    }
                }
            }

            None
        }
    }

    fn read_via_value_pattern(element: &IUIAutomationElement) -> Option<String> {
        unsafe {
            let value_pattern = element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?;
            let bstr = value_pattern.CurrentValue().ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取字串末尾最多 `max` 個字元（以 char 計，CJK 安全）。
    fn cap_tail(s: &str, max: usize) -> String {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() <= max {
            s.to_string()
        } else {
            chars[chars.len() - max..].iter().collect()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::cap_tail;
        use super::{read_once, spawn_worker_with, Request};
        use std::sync::mpsc::{sync_channel, Receiver};
        use std::time::{Duration, Instant};

        // 時間判定只用寬鬆上限（相對 10 秒期限），不以 wall-clock 精準值判對錯：
        // CI runner 暫停執行緒不會讓正確的程式變紅。
        const LONG_TIMEOUT: Duration = Duration::from_secs(10);
        const RETURNED_PROMPTLY: Duration = Duration::from_secs(5);

        /// AC1：worker 有空時，選取請求照常送達並拿到結果
        #[test]
        fn test_read_once_selection_gets_worker_reply() {
            let (tx, rx) = sync_channel::<Request>(1);
            let worker = std::thread::spawn(move || {
                if let Ok(Request::Selection(resp)) = rx.recv() {
                    let _ = resp.try_send(Some("選取".to_string()));
                }
            });
            assert_eq!(
                read_once(&tx, Request::Selection, LONG_TIMEOUT),
                Some("選取".to_string())
            );
            assert!(worker.join().is_ok());
        }

        /// AC3：worker 卡住（初始化或上一個 UIA 呼叫沒回來）時，到期回 None、不阻塞呼叫端
        #[test]
        fn test_read_once_times_out_when_worker_stuck() {
            let (tx, _rx) = sync_channel::<Request>(1); // 有接收端、但沒人處理
            let started = Instant::now();
            assert_eq!(
                read_once(&tx, Request::Selection, Duration::from_millis(20)),
                None
            );
            assert!(started.elapsed() < RETURNED_PROMPTLY);
        }

        /// AC1：佇列已滿時立即回 None（忙碌就降級，不排隊等）
        #[test]
        fn test_read_once_returns_immediately_when_queue_full() {
            let (tx, _rx) = sync_channel::<Request>(1);
            let (filler, _filler_rx) = sync_channel::<Option<String>>(1);
            assert!(tx.try_send(Request::Excerpt(filler)).is_ok());
            let started = Instant::now();
            assert_eq!(read_once(&tx, Request::Selection, LONG_TIMEOUT), None);
            assert!(started.elapsed() < RETURNED_PROMPTLY);
        }

        /// AC3：worker 初始化失敗已結束（接收端被 drop）時立即回 None
        #[test]
        fn test_read_once_returns_immediately_when_worker_gone() {
            let (tx, rx) = sync_channel::<Request>(1);
            drop(rx);
            let started = Instant::now();
            assert_eq!(read_once(&tx, Request::Selection, LONG_TIMEOUT), None);
            assert!(started.elapsed() < RETURNED_PROMPTLY);
        }

        /// AC3：UIA 初始化卡住時，啟動不等它就緒、第一個請求到期回 None。
        /// 若有人加回同步等待就緒，這條會卡住直到 CI 逾時（不是斷言變紅）。
        #[test]
        fn test_spawn_worker_does_not_wait_for_stuck_init() {
            fn stuck_init(_rx: Receiver<Request>) {
                loop {
                    std::thread::park();
                }
            }
            let started = Instant::now();
            let worker = spawn_worker_with(stuck_init).expect("worker thread should spawn");
            let sender = worker.lock().expect("sender lock").clone();
            assert_eq!(
                read_once(&sender, Request::Selection, Duration::from_millis(20)),
                None
            );
            assert!(started.elapsed() < RETURNED_PROMPTLY);
        }

        #[test]
        fn test_cap_tail_shorter_than_max() {
            assert_eq!(cap_tail("hello", 10), "hello");
        }

        #[test]
        fn test_cap_tail_equal_to_max() {
            assert_eq!(cap_tail("hello", 5), "hello");
        }

        #[test]
        fn test_cap_tail_keeps_tail() {
            assert_eq!(cap_tail("abcdefghij", 3), "hij");
        }

        #[test]
        fn test_cap_tail_cjk() {
            let s = "這是一段中文測試文字";
            assert_eq!(cap_tail(s, 4), "測試文字");
            assert_eq!(cap_tail(s, 4).chars().count(), 4);
        }

        #[test]
        fn test_cap_tail_empty() {
            assert_eq!(cap_tail("", 5), "");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cap_chars, is_single_non_degenerate_range, non_blank, split_text_around_selection,
        CONTEXT_AFTER_CHARS, CONTEXT_BEFORE_CHARS, CONTEXT_TITLE_CHARS,
    };

    // 測試一律引用正式上限常數：非 macOS 的 test target 只靠這裡用到它們，
    // 否則 `clippy --all-targets -D warnings` 會報 dead_code
    const BEFORE: usize = CONTEXT_BEFORE_CHARS;
    const AFTER: usize = CONTEXT_AFTER_CHARS;

    #[test]
    fn test_split_cursor_in_middle() {
        let (before, after) =
            split_text_around_selection("今天開會討論預算", Some((4, 0)), BEFORE, AFTER);
        assert_eq!(before, "今天開會");
        assert_eq!(after, "討論預算");
    }

    #[test]
    fn test_split_excludes_selected_text() {
        let (before, after) = split_text_around_selection("abcXYZdef", Some((3, 3)), BEFORE, AFTER);
        assert_eq!(before, "abc");
        assert_eq!(after, "def");
    }

    #[test]
    fn test_split_applies_production_limits() {
        assert_eq!((BEFORE, AFTER), (300, 100));
        let text: String = "一".repeat(500) + &"二".repeat(500);
        let (before, after) = split_text_around_selection(&text, Some((500, 0)), BEFORE, AFTER);
        assert_eq!(before, "一".repeat(BEFORE));
        assert_eq!(after, "二".repeat(AFTER));
    }

    #[test]
    fn test_split_uses_utf16_offsets() {
        // emoji 在 UTF-16 佔兩個單位：游標在 emoji 之後是 location 3，不是 2
        let (before, after) = split_text_around_selection("a😀b", Some((3, 0)), BEFORE, AFTER);
        assert_eq!(before, "a😀");
        assert_eq!(after, "b");
    }

    #[test]
    fn test_split_without_range_treats_all_as_before() {
        let (before, after) = split_text_around_selection("hello", None, 3, AFTER);
        assert_eq!(before, "llo");
        assert_eq!(after, "");
    }

    #[test]
    fn test_split_clamps_out_of_range_location() {
        let (before, after) = split_text_around_selection("abc", Some((99, 5)), BEFORE, AFTER);
        assert_eq!(before, "abc");
        assert_eq!(after, "");
    }

    #[test]
    fn test_cap_chars_applies_title_limit() {
        assert_eq!(CONTEXT_TITLE_CHARS, 120);
        let long_title = "標".repeat(200);
        assert_eq!(cap_chars(&long_title, CONTEXT_TITLE_CHARS).chars().count(), 120);
        assert_eq!(cap_chars("Slack", CONTEXT_TITLE_CHARS), "Slack");
    }

    #[test]
    fn test_non_blank() {
        assert_eq!(non_blank("  \n".to_string()), None);
        assert_eq!(non_blank(" a ".to_string()), Some(" a ".to_string()));
    }

    #[test]
    fn test_single_range_with_distinct_endpoints_is_selection() {
        assert!(is_single_non_degenerate_range(1, Some(-1)));
        assert!(is_single_non_degenerate_range(1, Some(1)));
    }

    #[test]
    fn test_degenerate_range_is_not_selection() {
        // UIA 無選取時回傳游標位置的退化範圍（起點＝終點）
        assert!(!is_single_non_degenerate_range(1, Some(0)));
    }

    #[test]
    fn test_zero_or_multiple_ranges_are_not_selection() {
        assert!(!is_single_non_degenerate_range(0, Some(-1)));
        // 多段選取本版不支援編輯，降級為無選取
        assert!(!is_single_non_degenerate_range(2, Some(-1)));
    }

    #[test]
    fn test_unreadable_endpoints_are_not_selection() {
        assert!(!is_single_non_degenerate_range(1, None));
    }
}
