# TypeK 1.3.0 三個 bug 診斷（快捷鍵／權限／麥克風預覽）

> 只做診斷，沒有改任何程式碼。所有 `file:line` 對應本 repo `main`（HEAD `ee0a3af`，版本 1.3.1）。
> 標記 **未確認** 的項目，是我無法在不執行 App、不讀 TCC DB 的情況下直接量測的。
> 撰寫時間：2026-10-26。

---

## 0. 先講結論

| # | 症狀 | 最可能根因 | 信心 |
|---|------|-----------|------|
| 1a | 短按右 Option 完全不錄音 | **TCC 授權與目前這個 build 對不上**：`AXIsProcessTrusted()` 回傳 false → 啟動時 `CGEventTapCreate` 直接失敗 → 鍵盤事件從頭到尾沒進來 | 高（由「每次開都跳 modal」可反推 AX=false） |
| 1b | 長按也不錄音 | 你的設定檔存的是 **Toggle**，而 Toggle 模式「按住 ≥1 秒」會被 Rust 當成 mode-toggle **吞掉**，前端又是 no-op → 這個手勢永遠不會錄音（跟權限無關，是程式邏輯） | 高（`settings.json` 實測 + 程式碼） |
| 2 | 權限開關是 ON，每次開 App 還是跳「需要輔助使用權限」 | 同一件事：**ad-hoc 簽章的 App 身分是 cdhash**，每個版本／每次自動更新都換一個身分；清單裡那一列還是上一個版本，看起來 ON、實際不生效。加上引導視窗只會 poll `AXIsProcessTrusted`、沒有任何「已勾選但無效」的處理路徑 | 高 |
| 3 | 一進設定就開麥克風 | `SettingsView.vue` 的 `onMounted` 無條件 `startPreview()`，且切換裝置／重新整理也會重開；預覽是一條常駐 cpal 輸入流，直到離開頁面才關 | 確定（純程式碼） |

一句話：**問題 1 和問題 2 是同一個根因的兩面**（簽章身分過期）；問題 1 另外還有一個獨立的 Toggle 長按邏輯 bug；問題 3 是啟動時機設計問題，不是權限問題。

---

## 1. 我在你這臺機器上實際量到的事實

以下都是唯讀量測，沒有啟動或修改 App。

| 項目 | 量測結果 |
|------|---------|
| OS | `macOS 27.0.1`（build `26A434`）— 與回報的 Darwin 27 一致 |
| 已安裝版本 | `/Applications/TypeK.app` = **1.3.1**（不是 1.3.0） |
| 簽章 | `Signature=adhoc`、`TeamIdentifier=not set`、`flags=0x10002(adhoc,runtime)` |
| 目前 CDHash | `99efb3f175cc92036dfbce86950119fc6a91090e` |
| **Designated Requirement** | `designated => cdhash H"99efb3f175cc92036dfbce86950119fc6a91090e"` ← **只認這顆 binary 的 hash，沒有 team／憑證可當 stable identity** |
| 簽章完整性 | `codesign --verify --deep --strict` → `valid on disk` / `satisfies its Designated Requirement`（簽章本身沒壞） |
| Gatekeeper | `spctl -a -vv` → `rejected`（未公證，預期行為，與 TCC 無關） |
| 隔離屬性 | 無 `com.apple.quarantine`（已開過），不是 translocation 問題 |
| 程序 | `TypeK` 正在跑，executable = `/Applications/TypeK.app/Contents/MacOS/TypeK`（不是從 DMG 執行） |
| DMG | `/Volumes/TypeK` 還掛載著（建議退出，避免兩份 App 混淆） |
| 設定檔 | `hotkeyTriggerKey = "rightOption"`、**`hotkeyTriggerMode = "toggle"`**、`debugLogEnabled` 未設（= 關） |
| Log | `~/Library/Logs/com.kekukeku.typek/typek.log` 存在，**0 bytes**（因為除錯記錄預設關閉） |

重點：

1. 你下載的是 1.3.0，但機器上已經是 **1.3.1** —— App 內自動更新已經跑過一次。**每一次換版（含 App 內自動更新）都會換 cdhash，也就會再讓 TCC 授權失效一次**。所以就算 1.3.0 時修好了，1.3.1 又會壞。
2. Designated Requirement 只有 cdhash，這是 ad-hoc 簽章的必然結果。TCC 的資料列記的是「上一版那個 hash」，你現在跑的是「這一版這個 hash」，兩者對不上。
3. 引導視窗只會在 `check_accessibility_permission_command` 回傳 false 時出現（`src/MainApp.vue:399-402`）。**你每次開都看到它，等於直接證明 `AXIsProcessTrusted()` 現在是 false** —— 這不是「顯示錯誤」，系統是真的沒授權給這個 binary。

---

## 2. 問題 1：按右 Option 不會開始錄音

### 2.1 事件鏈（正常應該怎麼走）

```
TCC 授權 OK
  → hotkey_listener 啟動時 CGEventTap::new(Session, HeadInsert, ListenOnly,
        [FlagsChanged, KeyDown, KeyUp])            hotkey_listener.rs:776-784
  → FlagsChanged keycode 61 → matches_trigger_key_macos(RightOption)
        → is_modifier_pressed(Alternate) → handle_key_event(true)
        → emit "hotkey:pressed" / "hotkey:toggled"  hotkey_listener.rs:893-897, 420-552
  → HUD 的 voiceFlowStore 收到 → handleStartRecording()
        useVoiceFlowStore.ts:1813-1837
```

這條鏈上任何一環斷掉，症狀都是「完全沒反應」。

### 2.2 根因（排序）

#### R1（主因，短按）TCC 授權對不上 → event tap 根本沒建立

證據鏈：

- 引導視窗每次出現 ⇒ `AXIsProcessTrusted() == false`（`hotkey_listener.rs:580-587`、`MainApp.vue:399-402`）。
- 啟動時 `init()` 先檢查，false 就 `prompt_accessibility_permission()` 然後**仍然**呼叫 `start_event_tap()`（`hotkey_listener.rs:1416-1429`）。
- 沒有 Accessibility 信賴時，`CGEventTap::new(... ListenOnly ...)` 會回 `Err(())`，程式只寫 log + emit `hotkey:error`，**不會重試**（`hotkey_listener.rs:985-998`）。
- `reinitialize_hotkey_listener()` 在 AX=false 時直接 `return Err`（`hotkey_listener.rs:1041-1043`），而引導視窗只會在 AX=true 時才呼叫它（`AccessibilityGuide.vue:34-43, 58-71`）。⇒ **形成死結：權限沒過 → tap 沒建 → 引導視窗無法完成 → 權限永遠沒過。**
- 同一個 pattern 也出現在 `keyboard_monitor.rs:177-237`（第二個 tap，同樣只建一次、失敗不重試）。

為什麼會「以前可以、1.0 以後不行」：

- `git log` 顯示 macOS 觸發邏輯在 1.0.0 前有一個大改（`bc2a5f2`，gh-30 修飾鍵逐鍵追蹤）。我逐行比對了 `bc2a5f2^` 與現在的 `FlagsChanged` 單鍵觸發分支，**邏輯完全相同**（Chord/Combo 是新增分支，不影響 RightOption）。所以不是那次重構把右 Option 改壞。
- 更合理的解釋是版本邊界：**1.0.0 很可能是第一個你重新下載／重新安裝的版本**，ad-hoc 簽章一換，TCC 就失效；之後每版都一樣。這與「1.0 以前都還可以」在時間上完全吻合。

#### R2（主因，長按）Toggle 模式的 1 秒長按是 dead gesture

這是獨立於權限的另一個 bug，而且你的設定檔實測就是 `toggle`：

- `hotkeyTriggerMode = "toggle"`（`~/Library/Application Support/com.kekukeku.typek/settings.json`）。
- Toggle 分支：按下時 spawn 一個 1 秒 timer；1 秒後若還按著，設 `toggle_long_press_fired = true` 並 emit `hotkey:mode-toggle`（`hotkey_listener.rs:500-521`）。
- 放開時若 `was_long_press == true`，**直接不做 toggle**（`hotkey_listener.rs:526-547`）。
- 前端對 `hotkey:mode-toggle` 的處理是 **no-op**（`useVoiceFlowStore.ts:926-935`，註解明寫「Toggle 長按：模式切換已移除」）。

⇒ 在 Toggle 模式下，**按住超過 1 秒 = 一定不會錄音，也不會切模式**，就只是什麼都沒發生。這正好對上「長按不會開始錄音」。修好權限之後，這個 bug 仍然會存在。

> 註：Toggle 模式下「短按後放開」才會 `hotkey:toggled {action:start}`。所以短按壞掉只能是 R1。

#### R3（次要，會讓修好後又隨機失效）tap 被系統停用後無人復活

- callback 只處理 `FlagsChanged / KeyDown / KeyUp`（`hotkey_listener.rs:780-784, 850-957`），**沒有處理 `kCGEventTapDisabledByTimeout` / `kCGEventTapDisabledByUserInput`**；全 repo 也找不到 `CGEventTapEnable` 的再次啟用。
- 系統在 callback 逾時、或 TCC 狀態變動時會把 tap 停用；停用後程式還活著、但再也收不到鍵，直到重啟 App。
- 這解釋「有時候本來可以、突然就不行」，但不是「每次開都不行」的主因。

#### R4（診斷盲點，不是病因）啟動期的 log 根本不會被寫進檔案

- 檔案 log 是在 `setup()` 裡才 `attach_logger`（`lib.rs:630-652`），而 hotkey plugin 的 `setup()` 比它更早跑（`lib.rs:577`）。
- 所以 `[hotkey-listener] AXIsProcessTrusted = ...`、`Creating CGEventTap on thread...` 這些**啟動期日誌在檔案裡會缺**（`logging.rs` 的註解也承認「app setup 之前的日誌不會被捕捉」）。
- 加上 `FILE_LOG_ENABLED` 預設 false（`logging.rs:22`），你現在打開 `typek.log` 是 0 bytes 完全正常，**不代表沒有錯誤**。

#### R5（可以排除）最近的改動沒有直接弄壞 hotkey 啟動

| 改動 | 判定 |
|------|------|
| 1.2.2 執行檔改名 `sayit` → `TypeK`（`82cfd0f`） | **不是直接原因，但是加重因素**：bundle 內 executable 路徑變了，TCC 清單可能同時留下舊 `sayit` 與新 `TypeK` 兩列（未確認你的畫面有幾列）。這會讓人「勾對了卻沒用」。改名本身沒動任何 hotkey 程式。 |
| `build.rs` 的 Objective-C / weak Speech 連結 | 無關。它只影響 Apple Speech 轉錄；hotkey 是 core-graphics。 |
| `Info.plist` | 只有麥克風／語音辨識用途字串，沒有碰 Accessibility；而且 Accessibility 不需要 usage description。 |
| `Entitlements.plist` | `audio-input` + `apple-events`，與 event tap 無關（非 sandbox）。 |
| App 內自動更新（1.3.0 新功能） | **加重因素**：更新會原地換掉 bundle，cdhash 一變 TCC 就再次失效。你這臺已經被更新到 1.3.1，就是實例。 |
| 1.3.0/1.3.1 的程式碼差異 | 只有繁中用字（`fc0a87d` 等），與 hotkey 無關。 |

### 2.3 macOS 27 需不需要額外的 Input Monitoring？

- Event tap 要「讀」全系統鍵盤事件，對應的 TCC 服務是 **`kTCCServiceListenEvent`（Input Monitoring）**；Accessibility（`kTCCServiceAccessibility`）主要是 AX API 控制其他 App / 送事件。一個會「吞鍵」的 tap 兩個都要；純 listen-only 的 tap 至少需要 Input Monitoring（[keymapper macOS 架構文件](https://raw.githubusercontent.com/mamrhein/keymapper.rs/main/docs/macos-architecture.md)、[HackTricks TCC 對照表](https://hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-input-monitoring-screen-capture-accessibility.html)）。
- TypeK **從頭到尾沒有呼叫 `CGPreflightListenEventAccess()` / `CGRequestListenEventAccess()`**（全 repo grep 不到），引導視窗也只談 Accessibility。也就是說：**如果 macOS 27 對 listen-only tap 只認 Input Monitoring，TypeK 永遠不會主動要求，也永遠偵測不到。**
- 但歷史經驗上，只有 Accessibility 也可能建立 listen-only tap（macOS 10.15–26）。macOS 27 是否收緊、以及新的「Device Control and Data Access」是否把兩個服務合併成同一個開關，我**未確認**（無法在不改機器的情況下量測）。
- 這件事必須用診斷代碼分開量測，不能猜：**AX=true 但 tap 建不起來 ⇒ 就是 Input Monitoring 缺**（見 §5.1）。

---

## 3. 問題 2：權限勾了，每次開還是跳訊息

### 3.1 根因

#### R1（主因）TCC 那列是「上一個版本」，不是現在跑的這個 binary

- ad-hoc 簽章的 designated requirement 就是 `cdhash H"..."`（本機實測），**沒有 stable identity**。每個 release、每次 App 內自動更新，cdhash 都不同。
- macOS 的隱私紀錄是「bundle id + 由簽章推導的 requirement」。requirement 對不上時：系統設定仍把舊那列顯示成 ON（它顯示的是紀錄，不是即時驗證），但 `AXIsProcessTrusted()` 對新 binary 回 false。
- 這是 ad-hoc 簽章的已知行為，也是業界共通症狀：「開關看起來開著，實際被忽略」，標準解法就是 **− 移除、+ 重新加入**（[FavTray: Why macOS Keeps Asking for Permissions Again](https://favtray.com/blog/macos-permissions-after-update)、[Synergy: macOS 27 Device Control and Data Access 排錯](https://support.symless.com/hc/en-us/articles/35743428145169-Troubleshooting-the-macOS-Device-Control-and-Data-Access-or-Accessibility-permission)、[SO: 每次重新編譯都要重新授權](https://stackoverflow.com/questions/69058238/)）。
- 我們自己的 `docs/deployment-guide.md:275-278` 其實早就寫了這個限制與「移除後重新加入」的解法，只是 App 內引導沒有照做。

#### R2 引導視窗的文案與流程，恰好把使用者卡死

- 文案只有三步：「開啟系統設定 → 在清單中找到 TypeK 並勾選 → 回到 App 會自動偵測」（`zh-TW.json:351-361`、`AccessibilityGuide.vue:150-165`）。
- 你的實際狀態是「已經在清單裡、已經 ON」，第 2 步無事可做；第 3 步的「自動偵測」永遠不會成立。**UI 沒有「已勾選但無效」這個狀態。**
- 偵測只看 `AXIsProcessTrusted`（`AccessibilityGuide.vue:37-43`），每 2 秒 poll 一次，永遠 false，永遠不關。
- 按「稍後設定」關掉後，下次開 App 又會因為 AX=false 再跳（`MainApp.vue:381-403`），這就是「每次打開程式都還是會跳訊息」。

#### R3 深連結還是舊的 pane 名稱／路徑

- `open_accessibility_settings` 開的是 `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`（`hotkey_listener.rs:602-613`），這是 macOS 12 時代的 URL。
- macOS 27 已把「輔助使用」改名為 **Device Control and Data Access**（[Synergy 文件](https://support.symless.com/hc/en-us/articles/35743428145169-Troubleshooting-the-macOS-Device-Control-and-Data-Access-or-Accessibility-permission)），你的截圖就是這個 pane。
- 這個舊 URL 在 macOS 27 是否還會正確跳到新 pane，我**未確認**（沒有實際點擊）。如果它跳到隱私權首頁或跳不過去，使用者就更不可能完成「移除＋重新加入」。

#### R4 macOS 27 的 pane 可能把多個服務合成一列（未確認）

你的截圖裡每個 App 只有一個開關，而說明文字同時提到「monitor your keyboard」。如果 macOS 27 把 Accessibility / Input Monitoring / Automation 合併成單列，那個 ON 可能只代表其中一部分授權，無法從 UI 判斷缺哪一個。這一點**未確認**，但正好說明為什麼 App 必須自己回報每個服務的狀態（§5.1）。

### 3.2 為什麼「重新勾選」沒用，一定要「− 再 +」

- 把既有那列 OFF→ON，只改 `auth_value`，**不會重寫那列的 csreq**；它仍然指向舊 cdhash。
- 按 **−** 刪掉紀錄，再按 **+** 從 `/Applications` 重新加入，系統才會用「現在這顆 binary」的簽章建立新 requirement。
- 這也是為什麼 Symless／FavTray 的官方排錯都寫「remove and re-add」，而不是「toggle off and on」。

---

## 4. 問題 3：一進設定就自動開麥克風測試

### 4.1 根因（確定）

- `SettingsView.vue:1027-1032`：`onMounted` 先載入裝置清單，然後**無條件** `startPreview(...)`。
- 另外兩個入口也會重開：切換裝置 `:1021`、重新整理 `:1009`。
- `startPreview()` 呼叫 Rust `start_audio_preview`（`useAudioPreview.ts:28-50`），後者開一條常駐 cpal 輸入流＋背景執行緒，直到 `stop_audio_preview`（`audio_recorder.rs:138-193, 473-604`）或頁面 unmount（`SettingsView.vue:1055`）才關。
- 所以只要設定頁開著，macOS 選單列的麥克風指示燈就會一直亮（你截圖看到的正是這個）。**這不是麥克風權限異常，是設計問題。**
- 預覽只計算音量（FFT / RMS）並 emit `audio:preview-level`（`audio_recorder.rs:560-604`），**不會寫檔、不會送去轉錄**；錄音檔只由 `start_recording` / `save_recording_file` 產生。這點可以跟使用者保證。

### 4.2 附帶問題

- `startPreview` 失敗只 `console.error`（`useAudioPreview.ts:55-57`），UI 不會提示，使用者只看到「沒有音量」。
- 沒有自動停止計時器：麥克風指示燈會一直亮到離開頁面，對隱私感受很差。

---

## 5. 建議的程式修法（具體到檔案與行為）

> 原則是先修「量測」再修「文案」：沒有辦法分辨缺哪個權限，寫再多引導都是猜。

### 5.1 後端：一個真正的權限／tap 狀態探針

**`src-tauri/src/plugins/hotkey_listener.rs`**

1. 把 `check_accessibility_permission()`（L580-587）擴充成：

```rust
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,     // AXIsProcessTrusted()
    pub input_monitoring: bool,  // CGPreflightListenEventAccess()
    pub event_tap_ok: bool,      // 最近一次 CGEventTap 是否建立成功
}

extern "C" {
    fn CGPreflightListenEventAccess() -> bool;  // 10.15+
    fn CGRequestListenEventAccess() -> bool;    // 會跳系統提示
}
```

2. 新增 command `get_permission_status`（迴圈讀 `event_tap_ok`）與 `request_input_monitoring`。
   `event_tap_ok` 由 `start_event_tap` 的成功／失敗分支設定（L963-999），不要只用 AX 判斷「能不能用」。
3. `reinitialize_hotkey_listener`（L1038-1065）改成**等 tap 真的建立才回 Ok**：用 `std::sync::mpsc` 回傳結果（照抄 `start_audio_preview` 的 `ready_tx` 模式，`audio_recorder.rs:156-190`），失敗回 `Err("tap_creation_failed")`。現在它 spawn 完就回 Ok，引導視窗會誤報「已啟用」。
4. tap 失敗重試：`Err(())` 時 sleep 2 秒重試 3 次（低成本），仍失敗才 emit error。
5. tap 被停用時復活：把 `CFMachPortRef` 存進 `OnceLock<usize>`，在 callback 收到 `CGEventType::TapDisabledByTimeout | TapDisabledByUserInput` 時呼叫 `CGEventTapEnable(port, true)`（extern "C"）。這是 R3 的根治。
6. 深連結（L602-613）：
   - Accessibility：先試 `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility`，失敗才退回舊 URL。
   - Input Monitoring：`...?Privacy_ListenEvent`。
   - macOS 27 的正確 anchor **未確認**，所以「先試新、再退舊」比寫死一個安全。

### 5.2 前端：AccessibilityGuide 改成三態狀態機

**`src/components/AccessibilityGuide.vue`**

把現在的「一個 visible + 無限 poll」改成：

| 狀態 | 條件 | 內容 |
|------|------|------|
| `grant` | AX=false，且這是本版本第一次顯示 | 現有文案，但 pane 名稱改成「Device Control and Data Access（macOS 27；舊版叫輔助使用）」 |
| `remove_readd` | AX=false，且**同一個 app 版本已經引導過一次**（或使用者按「我已勾選但仍無效」） | 移除／重新加入步驟 |
| `input_monitoring` | AX=true，但 `event_tap_ok=false` | 要求 Input Monitoring（按鈕呼叫 `request_input_monitoring`） |
| `restart` | 權限剛變成 true | 「重新啟動 TypeK」按鈕（呼叫既有 `request_app_restart`，`lib.rs:88,579`） |

**「列著且 ON 但沒真的授權」怎麼偵測（不碰私有 API）：**

- 在 `tauri-plugin-store` 存兩個鍵（照 `lastSeenVersion` / `autoStartRegisteredVersion` 的既有模式，`useSettingsStore.ts:821,1660`）：
  ```
  permissionGuideVersion: string   // 上次顯示引導時的 __APP_VERSION__
  permissionGuideShownCount: number
  ```
- 開啟引導時：若 `permissionGuideVersion === __APP_VERSION__`，直接進 `remove_readd`。
  理由：同一個版本、已經引導過一次、AX 還是 false ⇒ 使用者的開關狀態與實際授權不一致，這正是 stale record 的定義。
- 再加一個顯式出口：`grant` 畫面下方放「我已勾選，但仍無效」連結，讓使用者不必等第二次啟動。
- 成功條件改成 `event_tap_ok === true`（不是 AX），這樣 Input Monitoring 缺失也能被引導修好。

**建議文案（zh-TW，其餘 6 語系同步）：**

`grant`
> 標題：需要「Device Control and Data Access」權限
> 說明：macOS 27 把原本的「輔助使用」清單改名為「Device Control and Data Access」。TypeK 需要這個權限才能監聽快捷鍵。
> 1 點「開啟系統設定」 2 找到 TypeK，把開關打開 3 回到 TypeK，系統會自動偵測

`remove_readd`（新增，重點）
> 標題：開關看起來是開的，但 macOS 沒有把權限給這個版本
> 說明：TypeK 沒有 Apple 開發者簽章（ad-hoc）。每次更新版本，系統認定的 App 身分就會改變，清單裡那一列還是上一個版本 —— 所以看起來是開的，實際沒有生效。
> 1 在清單中選取 TypeK 2 按「−」移除 3 按「+」，從「應用程式」重新選擇 TypeK 4 把開關打開 5 按下方「重新啟動 TypeK」
> 進階（折疊）：終端機執行 `tccutil reset Accessibility com.kekukeku.typek`

`input_monitoring`（新增）
> 標題：還需要「輸入監控」權限
> 說明：macOS 需要「輸入監控」才能讓 TypeK 讀到鍵盤事件。請在「輸入監控」清單中打開 TypeK；若清單中沒有，按「要求權限」讓系統跳出提示。

`restart`
> 標題：權限已更新，請重新啟動 TypeK
> 說明：macOS 只會在 App 啟動時把權限交給它。按下方按鈕重新啟動，快捷鍵就會生效。

### 5.3 麥克風：改成「按了才測」

**`src/views/SettingsView.vue`**

1. 刪掉 `onMounted` 裡的 `void startPreview(...)`（L1030）；`handleAudioInputDeviceChange`（L1021）與 `handleRefreshAudioInputDeviceList`（L1009）也不要在背景重開，改成「若正在測試就停止」。
2. 在「輸入裝置」卡片（L2080-2155）加一顆按鈕：
   - 閒置：`[🎤 測試麥克風]`
   - 測試中：`[停止測試]` + 進度條 + 文字「測試中…（最多 10 秒）」
3. 10 秒自動停止（`setTimeout`，在 stop / unmount 清除），保證麥克風指示燈會熄。
4. 音量條只在 `isTestingMic` 時顯示（現在是 `isPreviewActive`，但一進頁面就是 true）。
5. `useAudioPreview.startPreview` 改成回傳 `Promise<boolean>` 或直接把錯誤往上丟，讓按鈕能顯示「無法開啟麥克風：<原因>」。
6. 靜音 3 秒後顯示提示：「沒有偵測到音量。請確認系統麥克風權限或換一個輸入裝置。」
7. 新增 i18n keys（7 個語系）：`testMicrophone`、`stopTest`、`testing`、`testHint`、`testNoSignal`、`testFailed`。

**`src/i18n/locales/*.json`**：`settings.audioInput` 區塊（zh-TW 在 L165-174）。

### 5.4 文件

- `docs/deployment-guide.md:275-278`：把 pane 名稱補成「Device Control and Data Access（macOS 27）／輔助使用（≤26）」，並加上 App 內自動更新也會使授權失效。
- `docs/development-guide.md:219` 附近：補一句「hotkey plugin 的啟動期日誌在 logger 掛上之前，不會進檔案」。

### 5.5 長期：要不要處理簽章？

| 選項 | 效果 | 成本／風險 |
|------|------|-----------|
| 維持 ad-hoc，只把 UX 做好 | 每版仍要使用者「− 再 +」一次 | 0 元；但每次更新都會再踩一次，支援成本高 |
| 付費 Developer ID（$99/年）＋ notarize | TCC 以 Team ID 認身分，更新後授權可延續；順便解決「強制打開」 | 需要付費帳號與 CI secrets |
| 自簽憑證（stable self-signed identity） | designated requirement 變成憑證 leaf，跨版本穩定；TCC 授權可存活 | 使用者仍要「強制打開」；CI 要保管 .p12；TCC 是否接受自簽 leaf **未確認**（[trycua 的作法](https://github.com/trycua/cua/pull/1792)聲稱可行） |

務實建議：1.3.x 先把 §5.1–5.3 做完（不需要簽章變更），把「移除＋重新加入」變成一個有引導、可一鍵重啟的流程；要不要買 Developer ID 另案決定。

---

## 6. Kevin 現在就能做的事（不用等改版）

> 以下指令都只影響 TypeK 這一個 App，安全。**不要**跑 `sudo tccutil reset Accessibility`（那是全部 App）。

### 6.1 先把環境清乾淨

1. 退出掛著的 DMG：Finder 側邊欄把 `TypeK` 按退出（避免有兩份 App、兩種身分）。
2. 完全結束 TypeK：選單列 TypeK 圖示 →「結束 TypeK」（不是只關視窗）。
3. （可選）確認版本與簽章，順便留證據：

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/TypeK.app/Contents/Info.plist
codesign -dv --verbose=4 /Applications/TypeK.app 2>&1 | grep -E 'Identifier|CDHash|Signature|TeamIdentifier'
codesign -d -r- /Applications/TypeK.app 2>&1 | tail -1
```

你應該看到 `Signature=adhoc`、`TeamIdentifier=not set`，以及
`designated => cdhash H"..."` —— 這就是「每個版本都是不同 App」的證明。

### 6.2 重設並重新授權（關鍵步驟）

```bash
tccutil reset Accessibility com.kekukeku.typek
tccutil reset ListenEvent com.kekukeku.typek   # 若顯示 Invalid service 就跳過，不影響
```

然後：

1. 打開「系統設定 → 隱私權與安全性 → **Device Control and Data Access**」（macOS 27 的新名字）。
2. 在清單裡找 TypeK。**如果看到兩列 TypeK（或一列 sayit），全部選取後按「−」移除。**
3. 按「+」→ 到 `/Applications` 選 `TypeK.app` →「打開」。
4. 把 TypeK 的開關打開。
5. **重新啟動 TypeK**（權限是啟動時交付的，開著改常常不會生效）。

### 6.3 驗證

1. 打開 TypeK 主視窗（Dashboard）。
2. **如果「需要輔助使用權限」的 modal 不再出現** ⇒ Accessibility 這關過了（因為 modal 只在 `AXIsProcessTrusted()==false` 時顯示）。
3. 在設定裡把觸發模式改成 **Hold**（或維持 Toggle 但用「短按」），按一下右 Option：
   - 短按有反應、長按沒反應 ⇒ 你中的是 §2.2 R2（Toggle 長按 bug），不是權限。
   - 兩個都沒反應，但 modal 已消失 ⇒ 很可能缺 **Input Monitoring**：到「隱私權與安全性 → 輸入監控」（若 macOS 27 把它併進同一個 pane，就在同一個清單）把 TypeK 打開，再重啟 App。這一步是 **未確認** 的，因為我無法從外部讀 TCC 清單。
4. 還不行就看 log：
   - 先在 TypeK 設定 →「除錯記錄」打開 → 重啟 App → 重現一次。
   - `tail -100 ~/Library/Logs/com.kekukeku.typek/typek.log`
   - 注意：**啟動期的 `[hotkey-listener]` 行可能不在檔案裡**（§2.2 R4）；看到 `[hotkey-listener] Reinitialized...` 之後的行才比較可信。
   - 也可以在同一個設定頁按「複製診斷資訊」取得記憶體中的 `[hotkey-listener]` 白名單日誌（`SettingsView.vue:158`）。

### 6.4 麥克風（問題 3）

- 現在的行為是 1.3.x 的設計，不是你的麥克風權限壞掉；預覽只算音量、不錄音、不寫檔。
- 臨時緩解：不要停留在「設定」頁；離開頁面就會停止（`onBeforeUnmount` → `stopPreview`）。
- 真正修好要等 §5.3 的「測試麥克風」按鈕。

---

## 7. 未確認清單

1. `AXIsProcessTrusted()` 的**即時值**：我沒有在 App 內執行，無法直接印；但「modal 每次出現」已可反推為 false（`MainApp.vue:399-402`）。
2. TCC 資料列實際內容（csreq、有幾列 TypeK/sayit）：`~/Library/Application Support/com.apple.TCC/TCC.db` 需要 Full Disk Access，讀不到；`log show` 被 sandbox 擋掉。
3. macOS 27 的 `kTCCServiceListenEvent` 是否為 listen-only tap 的必要條件、以及新的 pane 是否把 Accessibility / Input Monitoring 合併：**未確認**。需要用 §5.1 的探針實測。
4. 舊的 `x-apple.systempreferences:...Privacy_Accessibility` 在 macOS 27 是否還會跳到新 pane：**未確認**（沒有實際點擊）。
5. 你回報截圖是 Hold，但機器上的 `settings.json` 是 `toggle`。兩者之一過時：可能是截圖較早，也可能是 UI 顯示與 store 不同步（若是後者，是另一個 bug）。這一點需要你確認「現在設定頁上亮的是 Hold 還是 Toggle」。
6. 1.2.2 改名後 TCC 清單是否真的留下舊 `sayit` 一列：**未確認**（同上，讀不到 TCC DB）。

---

## 8. 來源

- Apple — `CGEvent.tapCreate`（event tap 建立與權限要求）：<https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)?language=objc>
- Apple — Resetting access to protected resources in macOS（`tccutil`）：<https://developer.apple.com/documentation/Xcode/resetting-access-to-protected-resources-in-macOS>
- HackTricks — macOS Input Monitoring / Accessibility / TCC service 對照：<https://hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-input-monitoring-screen-capture-accessibility.html>
- keymapper.rs — macOS 架構（CGEventTap 需要 Input Monitoring + Accessibility；ad-hoc 每次 rebuild 失效）：<https://raw.githubusercontent.com/mamrhein/keymapper.rs/main/docs/macos-architecture.md>
- FavTray — Why macOS Keeps Asking for Permissions Again（簽章改變 → 開關看起來 ON 但授權失效；off/on、−/+、`tccutil reset`）：<https://favtray.com/blog/macos-permissions-after-update>
- Symless — macOS 27「Device Control and Data Access」排錯（移除後重新加入）：<https://support.symless.com/hc/en-us/articles/35743428145169-Troubleshooting-the-macOS-Device-Control-and-Data-Access-or-Accessibility-permission>
- Stack Overflow — 每次重新編譯都要重新授權 Accessibility：<https://stackoverflow.com/questions/69058238/>
- trycua PR #1792 — stable self-signed identity 讓 TCC 授權跨 rebuild 存活：<https://github.com/trycua/cua/pull/1792>
- 專案內既有紀錄：`docs/deployment-guide.md:275-278`（ad-hoc → 更新後需移除／重新加入輔助使用）

---

### 附：這次診斷用到的 repo 位置

| 位置 | 內容 |
|------|------|
| `src-tauri/src/plugins/hotkey_listener.rs:580-587` | `AXIsProcessTrusted` |
| `:602-613` | 開啟系統設定的舊 URL |
| `:615-634` | `AXIsProcessTrustedWithOptions` 提示 |
| `:768-1001` | macOS event tap 建立（僅一次、無 retry） |
| `:963-999` | tap 成功／失敗分支 |
| `:1038-1065` | `reinitialize_hotkey_listener`（AX=false 直接 Err） |
| `:1383-1450` | plugin `init`：啟動檢查＋prompt＋建 tap |
| `:420-552` | `handle_key_event`（Hold / Toggle / 長按吞掉） |
| `src-tauri/src/plugins/keyboard_monitor.rs:177-237` | 第二個 tap，同樣無 retry |
| `src/MainApp.vue:381-403` | 啟動權限檢查 → 顯示引導 |
| `src/components/AccessibilityGuide.vue:32-71,118-125,150-192` | poll / 重新初始化 / 文案 / 按鈕 |
| `src/stores/useVoiceFlowStore.ts:926-935,1813-1841` | Toggle 長按 no-op、hotkey 事件處理 |
| `src/views/SettingsView.vue:1009,1021,1027-1032,1055,2080-2155` | 自動預覽與輸入裝置卡片 |
| `src/composables/useAudioPreview.ts:28-81` | 預覽 start/stop |
| `src-tauri/src/plugins/audio_recorder.rs:138-193,473-604` | `start_audio_preview` / 常駐串流 |
| `src-tauri/src/plugins/logging.rs:22,34` | 檔案 log 預設關閉、檔名 `typek` |
| `src-tauri/src/lib.rs:577-598,630-652` | plugin 註冊順序與 logger 掛載時機 |
| `src-tauri/tauri.conf.json` | `mainBinaryName: TypeK`、`signingIdentity: "-"` |
