# 計畫：貼上後剪貼簿還原太早，第一句常打不出字（1.3.4 修復）

> 建立：2026-10-27 · 狀態：計劃閘一輪（小C NOT-READY 4 HIGH／3 MED／1 LOW；小B NOT-READY 1 HIGH／4 MED／2 LOW）→ v2 已依審查修訂（2026-10-28），使用者裁示失敗路徑採小C 方案，直接交小D 實作、小B 審查 → 小D 實作完成（2026-10-28）→ 小B 實作審查 READY（1 LOW 已修）· Rust clippy／test 交 CI（本機不裝 Rust）· 排程：1.3.4（patch）

## 實作審查結果（2026-10-28，小B 唯讀，`docs/小B_review_impl-clipboard-restore-race.md`）

| 級別 | finding | 處置 |
|---|---|---|
| LOW | `restore_after_keys` 是恆等函式，其測試在「送鍵失敗不排程」的回歸下仍會綠，達不到驗收 9 的消融標準 | 收：刪函式與測試，`paste_text` 直接以 `registered_generation` 排程，理由寫成註解。驗收 9「送鍵失敗 → 仍登記 pending」改由程式結構（排程不讀 `paste_err`）＋審查保證 |

小B 另確認：流程逐條符合 v2；睡眠執行緒不碰鎖；generation／序號／沿用快照三個守衛各有拿掉就變紅的測試；Windows 靜態看可編譯（`ClipboardSnapshot` 型別別名、`Clone`、`GetClipboardSequenceNumber` 路徑與 feature）。

## 計劃閘結果（2026-10-27）

審查全文：`docs/小C_review_plan-clipboard-restore-race.md`、`docs/小B_review_plan-clipboard-restore-race.md`。

| 來源 | finding | 處置 |
|---|---|---|
| 小B HIGH／小C MED | 背景任務先判定「要還原」再排進主執行緒，中間若下一筆 `paste_text` 已寫入，舊快照會蓋掉新轉錄 | 收：背景執行緒只 sleep；檢查、還原、清 pending 全在 `run_on_main_thread` 閉包內一次做完 |
| 小C HIGH | generation 放在可清空的 pending 裡會歸零，造成 ABA | 收：模組層單調遞增計數器，永不重設 |
| 小C HIGH | 序號守衛不是跨 process 原子操作 | 收：規格改稱「盡力保護」，不承諾絕不覆蓋 |
| 小C HIGH | 「貼上失敗就立即還原」會蓋掉期間的複製；Windows SendInput 可能已送出一半 | 收（使用者裁示）：失敗也走同一條延遲＋序號守衛還原 |
| 小C HIGH | 連續貼上時，慢的目標 app 可能讀到下一筆轉錄 | 收為已知限制（下一筆要等錄音＋轉錄數秒，實務罕見） |
| 兩人 MED | 延遲測試 `200..=2000` 接受 200 | 收：改為 `>= 1000` |
| 兩人 MED | 寫入成功前就清 pending | 收：`set_text` 成功後才接手／取代 pending |
| 小C MED | 狀態轉移不完整 | 收：見下方狀態轉移表 |
| 小B MED | 規格漏了 Windows 焦點還原 | 收：原樣保留 |
| 小B MED | arboard Windows 整個生命週期佔住剪貼簿 | 不收（查 arboard 3.6.1 原始碼：`Clipboard::new()` 不開剪貼簿，每次操作開關）；但還原閉包內另開新 `Clipboard` 本來就是做法 |
| 兩人 | Windows 序號 0 | 收：0 視為未知，不排還原 |
| 兩人 | 結束時補還原 | 不做：會在退出瞬間重演競態 |
| 小C LOW | IPC 完成語意 | 收：補 `ipc.md` 的 `paste_text` 列 |
| 兩人 LOW | 1000ms 未量測 | 收：1000 是下限，驗收失敗直接調大，不必重審 |

## 要解決什麼

1.3.3 起，macOS 使用者回報：轉錄完 HUD 顯示綠色打勾，但游標處沒打出字；剪貼簿紀錄軟體裡有這段文字。時好時壞，常見「第一句打不出、第二句可以」。

**成因（已由使用者實測對上）**：使用者打開「將轉錄文字複製到剪貼簿」（`restoreClipboard: false`）後，連續使用數小時不再發生。

```
paste_text（restore = true，1.3.3 起所有人的預設）
  快照原剪貼簿 → set_text(轉錄) → sleep 50ms → 送 Cmd+V → sleep 200ms → clearContents + 寫回快照 → return Ok → HUD 綠勾
                                               │
                                               └─ 目標 app 若在 ~250ms 後才讀 pasteboard（冷的 webview／Chromium 非同步讀取）
                                                  → 讀到的是還原後的舊內容或空的 → 什麼都沒打出來
```

1.3.3（`435aa79`）沒改 50／200ms，而是把「貼完還原」改成全員預設（`useSettingsStore.ts:485` 一次性遷移）。

## 方案 A：延後、背景、序號守衛的還原

| | 做法 | 為什麼選／不選 |
|---|---|---|
| **A（採用）** | 送出 Cmd+V 後立即回傳；1000ms 後在主執行緒檢查並還原，只還原「仍是我們寫入那一版」的剪貼簿 | 打字速度不變、綠勾快約 200ms；目標 app 的讀取時間從 200ms 拉到 1000ms |
| B | 只把延遲改 800 | command 在主執行緒同步阻塞更久，下一筆 `paste_text` 也被卡住；仍會蓋掉期間的複製 |
| C | 預設改回保留在剪貼簿 | 消除這個還原競態，但收回 1.3.3 的改進 |
| D | `NSPasteboardItemDataProvider` 偵測讀取 | 剪貼簿紀錄軟體會先讀，訊號分不出是誰；提供資料也可能動到 changeCount |

### 狀態

```rust
struct RestoreState {
    next_generation: u64,          // 單調遞增，永不重設
    pending: Option<PendingRestore>,
}
struct PendingRestore {
    generation: u64,
    snapshot: <平台快照型別>,        // macOS Vec<PasteboardItemSnapshot>；Windows WindowsClipboardSnapshot
    written_seq: ClipboardSeq,      // 寫入轉錄後立即讀到的序號（非 0）
}
static RESTORE_STATE: Mutex<RestoreState>
```

序號：macOS `[[NSPasteboard generalPasteboard] changeCount]`；Windows `GetClipboardSequenceNumber()`，回 0 視為未知（`None`）。

### paste_text（同步 command，主執行緒）

`restore = true`：
1. 鎖 `RESTORE_STATE`。讀目前序號 `cur`。
   - pending 存在且 `cur == pending.written_seq`：原始快照 = **沿用 pending.snapshot**（剪貼簿仍是上一筆轉錄）
   - 否則：原始快照 = 對目前剪貼簿重新快照
   - **此時還不動 pending**
2. `set_text(轉錄)`。失敗 → 不動 pending（上一筆的還原照常）、解鎖、回錯。
3. 讀寫入後序號 `w`。分配 `gen = next_generation; next_generation += 1`。
   - `w` 已知：`pending = Some { gen, 原始快照, w }`
   - `w` 未知（Windows 0）：`pending = None`（不還原，轉錄留在剪貼簿）
4. 解鎖。（鎖不跨 sleep、不跨送鍵）
5. sleep 50ms →（Windows：照現有程式先 `restore_target_window` + 50ms）→ 送 Cmd+V／Ctrl+V。
6. 若步驟 3 有登記 pending：`std::thread::spawn` 一條只 sleep `RESTORE_DELAY_MS` 的執行緒，醒來呼叫 `app.run_on_main_thread(move || try_restore(gen))`。**送鍵失敗也一樣排程**（失敗前使用者可能已複製別的、Windows 可能已送出一半按鍵）。
7. 送鍵失敗 → 回 `KeyboardSimulation` 錯；成功 → 回 Ok。

`restore = false`：
1. `set_text(轉錄)`。失敗 → 回錯（pending 不動）。
2. 成功後鎖住、`pending = None`（使用者要保留轉錄；舊任務本來也會因序號不符放棄）。
3. 送鍵，回傳。**restore = false 永遠不還原，失敗也不還原。**

### try_restore(gen)（主執行緒閉包內，一次做完）

鎖 `RESTORE_STATE`：

| 條件 | 動作 |
|---|---|
| pending 為 None，或 `pending.generation != gen` | 什麼都不做（已被較新的一筆接手或取消；**不碰較新的 pending**） |
| generation 相符，目前序號 `== pending.written_seq` | 還原快照（另開新的 `Clipboard`），`pending = None` |
| generation 相符，序號不同或未知 | 不還原，`pending = None`（使用者／別的程式已改寫，不能蓋） |
| 還原失敗 | log error，`pending = None`（不重試） |

檢查與還原之間沒有事件迴圈 pump；但其他 process 仍可能在這幾毫秒間寫入，**此守衛是盡力保護，不是絕對保證**。

### 改動點

| 檔案 | 改什麼 |
|---|---|
| `src-tauri/src/plugins/clipboard_paste.rs` | `RESTORE_DELAY_MS` 200 → 1000，註解改寫；新增上述狀態、`current_clipboard_seq()`、`try_restore()`；`paste_text` 改為上述流程；`clipboard` 變數在 return 前 drop。抽出不碰 OS 的純狀態轉移函式供測試（例如 `begin_paste(state, cur_seq) -> Original`、`commit_written(state, snapshot, w) -> Option<gen>`、`decide_restore(state, gen, cur_seq) -> Action`），平台 I/O 只是薄殼 |
| `src-tauri/Cargo.toml` | Windows `windows` features 加 `Win32_System_DataExchange`（只依賴已啟用的 `Win32_System`，`Cargo.lock` 不變） |
| 測試（同檔） | `RESTORE_DELAY_MS >= 1000`；狀態轉移表格測試（見驗收 9） |
| `.claude/rules/ipc.md` | `paste_text` 列補 `restoreClipboard: bool` 參數，回傳註明「Ok＝已嘗試送鍵；還原在背景約 1 秒後」 |
| `.claude/rules/windows.md` | 「貼上與選取探測」段補一條：貼完還原是延遲、主執行緒、序號守衛；**不要再把還原放回 command 內同步 sleep** |

### 不動

- 50ms 寫入後等待、`simulate_paste_via_cgevent` 四事件送法、Windows 焦點還原與 `SendInput`
- HUD、觸發鍵、前端、設定與 1.3.3 遷移、`capture_selected_text_via_clipboard`

## 已知取捨

- 轉錄後約 1 秒內自己按 Cmd+V，會貼出轉錄文字
- 目標 app 超過 ~1 秒才讀仍會失敗（驗收失敗就調大常數，不必重審）
- 連續貼上時，若第一筆的目標 app 慢到第二筆寫入後才讀，會讀到第二筆；只保證最後還原成**第一筆之前**的原內容
- 序號守衛是盡力保護：其他 process 在檢查與寫入之間的幾毫秒內寫入仍會被蓋掉
- App 在等待中結束：還原遺失，剪貼簿留著轉錄文字；**不在 Exit 補還原**
- 快照是盡力而為：macOS 拿不到資料的 lazy type 會略過；Windows 只有文字或圖片（圖片優先）

## 驗收

1. macOS：在使用者原本會失敗的 app 閒置數分鐘後講第一句，連續 10 輪都打得出字（smoke test，不是可靠度證明）；剪貼簿事後是原內容
2. 原剪貼簿為：文字、富文字、圖片、Finder 多個檔案、空的 → 貼上正確，約 1 秒後還原
3. 兩句間隔很短連續講：兩句都打出，最後還原成**第一句之前**的原內容
4. 轉錄後 1 秒內自己複製別的（含複製相同文字）：還原被跳過，剪貼簿是自己剛複製的
5. 「將轉錄文字複製到剪貼簿」開啟：轉錄留在剪貼簿；中途切換 true→false→true 不會還原錯內容
6. 綠勾出現時間不晚於現在；品質／修正監控照常啟動
7. Quit／更新重啟落在等待期間：不當機，剪貼簿留著轉錄文字
8. Windows：CI clippy／test 綠；實機請回報者驗 1、3、4、5（含圖片、空剪貼簿）
9. 單元測試（純狀態轉移，各守衛拿掉時對應測試要變紅）：
   - 一般：登記 pending，到期序號相符 → Restore，pending 清空
   - 舊計時器遇到較新的 pending（generation 不符）→ Noop，較新 pending 原封不動
   - ABA：A 登記 → restore=false 清空 → C 登記 → A 的計時器 → Noop（C 不被提早還原）
   - 序號被外部改寫（含相同文字但序號變）→ Skip，pending 清空
   - 連續貼上：序號仍等於 pending.written_seq → 沿用舊快照；不等 → 重新快照
   - `set_text` 失敗 → pending 不變
   - 寫入後序號未知 → 不登記 pending
   - 送鍵失敗 → 仍登記 pending（與成功相同）
   - `RESTORE_DELAY_MS >= 1000`
10. `cargo clippy --workspace --all-targets -- -D warnings`、`cargo test`、`pnpm test`、`npx vue-tsc --noEmit` 全綠
