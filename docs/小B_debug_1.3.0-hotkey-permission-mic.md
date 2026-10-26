# TypeK 1.3.0 診斷：快捷鍵、輔助使用、設定頁麥克風

診斷日：2026-10-26。只讀程式與公開文件，**沒有改過程式、沒有建置、沒有安裝、沒有在本機啟動 TypeK**。Kevin 的 Mac（Darwin 27）上的 `codesign`、TCC、選單列麥克風，此處都標 **未確認**。

對過 `v1.3.0` 與目前 `main`（`tauri.conf.json` 版本已是 1.3.1）：`hotkey_listener.rs`、`AccessibilityGuide.vue`、`SettingsView.vue` 的預覽啟動、`audio_recorder.rs` 都沒有 diff。下面行號是目前 `main`，行為與發出的 1.3.0 相同。

---

## 問題 1 與 2 是同一件事

每次啟動都出現「需要輔助使用權限」，代表 `AXIsProcessTrusted()` 回傳 `false`。快捷鍵聽的是同一把權限上的 `CGEventTap`。權限沒真正生效時，tap 建不起來，右 Option、其他鍵、長按、短按都不會開始錄音。設定頁能顯示「右 Option／按住」只代表設定有存進去，不代表 tap 活著。

### 最可能原因（由高到低）

**1. ad-hoc 簽章的 cdhash 變了，TCC 舊列還顯示開著。**

- 正式包是 ad-hoc：`src-tauri/tauri.conf.json:82` `signingIdentity: "-"`。`identifier` 是 `com.kekukeku.typek`（同檔第 6 行）。`.github/workflows/release.yml:119-147` 只有在 Apple secret **有值**時才匯出；依專案決定這些 secret 維持空白，CI 不會改成 Developer ID。minisign 只簽更新包，不是 Apple code signature。
- Apple TN3127：ad-hoc（Xcode 的 Sign to Run Locally）的 designated requirement 綁那一個版本。macOS 用 DR 判斷「這次的 App 是不是上次授權的那一個」。沒有穩定 DR 就無法跨版本沿用授權。麥克風是文件裡的例子，輔助使用走同一套 code identity。  
  https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- ad-hoc 的 DR 實際長這樣：`designated => cdhash H"…"`。二進位差一個 byte，cdhash 就變，舊的 `csreq` 對不上。系統設定仍可顯示該 App、開關仍是開，API 卻是否。實例：https://nick-liu.com/posts/tcc-cdhash-trap/ ；Apple DTS 對「覆蓋安裝後 Screen Recording 重問」的回答也指向 TN3127：https://developer.apple.com/forums/thread/795739
- 程式只問 `AXIsProcessTrusted()`（`src-tauri/src/plugins/hotkey_listener.rs:580-586`）。這個 API **不會**讀系統設定那個開關，也分不出「沒加進清單」和「清單裡開著但 csreq 是舊的」。
- 啟動時若不信任，會呼叫 `AXIsProcessTrustedWithOptions(AXTrustedCheckOptionPrompt)` 再睡 1 秒（同檔 `616-633`、`1414-1425`）。App 已經在清單裡時，這個 prompt 常常不再跳系統對話框。所以 Kevin 看到的是 App 自己的 `AccessibilityGuide`，不是新的系統詢問。
- 無論信任與否，接著都 `start_event_tap`（`1426`）。tap 是 `CGEventTapLocation::Session` + `ListenOnly`（`776-779`）。失敗只 `log::error` 並 `emit("hotkey:error")`（`985-997`），**沒有重試**。`reinitialize_hotkey_listener`（`1038-1057`）要等 `AXIsProcessTrusted()` 變 `true` 才會拆掉舊 tap 再做一次，而且它不等 tap 結果就回 `Ok(())`。Guide 的輪詢（`src/components/AccessibilityGuide.vue:32-48`、`58-63`）因此永遠等不到「已授權」，也不會重建 listener。
- 這段 `hotkey:error` 發生在 JS 掛上監聽之前的機會很高：tap 在 plugin setup 裡建立，logger 與視窗都更晚。`useVoiceFlowStore.ts:1841-1858` 的 HUD 錯誤只有監聽之後收得到。Kevin 沒提到 HUD 錯誤，與「啟動當下的失敗事件被吃掉、之後只剩 Guide」相符。**未確認**他的畫面上有沒有閃過 HUD。
- 麥克風正常，和上面不矛盾。TN3127 的檢查是逐項服務。新 cdhash 的麥克風通常會再問一次；他允許之後，選單列才會顯示 TypeK 正在使用麥克風。輔助使用的列還在，prompt 被壓掉，開關看起來一直開著。專案內先前結論同一方向：`docs/小B_review_plan-auto-update-1.3.md` 第 50–53 行。
- 為什麼「1.0 以前可以」：`1dd8264` 把 bundle id 從 `com.sayit.app` 改成 `com.kekukeku.typek`（當時版本號 0.14.1，早於 tag `v1.0.0`）。SayIt 的授權不會落到 TypeK。1.0 之後每次發版都是新的 ad-hoc cdhash。`82cfd0f`（1.2.2）又把執行檔從 crate 名 `sayit`（`src-tauri/Cargo.toml` 的 `name` 仍是 `sayit`）改成 `mainBinaryName: "TypeK"`。這再換一次 bundle 裡的主程式路徑。熱鍵邏輯沒有跟著改：`hotkey_listener.rs` 最後一次修改就是 `1dd8264`，`v1.0.0` 到目前 `main` 都沒再動這個檔。

**2. 只把開關再撥一次，修不好這列。**

macOS 27 把舊的「隱私權與安全性 → 輔助使用」改名為 **Device Control and Data Access（裝置控制與資料存取）**。Kevin 的截圖與這份文件一致：https://support.symless.com/hc/en-us/articles/35743428145169-Troubleshooting-macOS-Device-Control-and-Data-Access-previously-Security-Privacy-in-Accessibility （2026-09-22；macOS 27 Golden Gate）。同一頁寫：開關可以是開的，系統卻忽略它；修法是完全退出、按 **−** 移除、再重新加入。側邊欄另一個「輔助使用」（縮放、VoiceOver）**不是**這張 App 清單：https://docs.indiegoodies.com/pastepal/Mac/features/permissions （2026-10-20）。

現在的文案會把人留在壞掉的開關上：

- `src/i18n/locales/zh-TW.json:351-361`：步驟 2 是「在清單中找到 TypeK 並勾選」；步驟 3 承諾「回到 App，系統將自動偵測並啟用」。
- `updateHint` 已經寫「剛更新 TypeK 的話，需要重新授權；這是 TypeK 沒有 Apple 簽章的限制。」步驟卻沒叫人移除再加回。開關已開時，勾選沒有第二次可做的動作，輪詢也永遠看不到 `true`。

**3. Input Monitoring（`kTCCServiceListenEvent`）是下一道閘，不是這次的主因。**

Listen-only tap 在歷史上會對到 Input Monitoring；Accessibility 另算。Apple DTS（2026-05，https://developer.apple.com/forums/thread/828052）的說法是：Accessibility 同時涵蓋 post 與 listen，授權真正生效後 listen-only tap 就能建立；還要再要一份 Input Monitoring 的情況他們認為不成立。`CGPreflightListenEventAccess` / `CGRequestListenEventAccess` 仍是 listen 服務自己的 API（https://developer.apple.com/forums/thread/735204 ，Quinn / Eskimo，2023-08）。

TypeK **沒有**呼叫這兩個 API。以 DTS 2026-05 的口徑，Device Control 一旦真正信任，不該再另要 Input Monitoring。Kevin 現在是 `AXIsProcessTrusted() == false`，還沒走到這一步。

macOS 27 有一則 MDM 討論：`AXIsProcessTrusted()` 已是 `true`，`CGEventTapCreate` 仍另跳 Device Control（https://developer.apple.com/forums/thread/836770 ，2026-08，beta 6 改名）。那是描述檔情境，不是 Kevin 這種「開關開著但 AX 為 false」。消費者這顆開關是否把 Accessibility 與 PostEvent 合成一項，**未確認**。

貼上是另一條路：`clipboard_paste.rs` 用 `CGEvent` 送 Cmd+V，歷史上屬 PostEvent，UI 也在輔助使用底下。權限修好後要另測貼上。**未確認** 1.3.0 在他機器上貼上是否也壞。

**4. 近期程式沒有把熱鍵啟動邏輯改壞。**

| 變更 | 結論 |
| --- | --- |
| 1.2.2 `mainBinaryName: TypeK`（`82cfd0f`） | 換了主程式檔名，cdhash / 路徑身份變了。沒改 tap 或 AX 檢查。 |
| 1.3.0 updater（`ba26947`） | 沒改 `hotkey_listener.rs`。取代 `.app` 等於再換一次 ad-hoc 身份。他這次是 DMG 拖進 `/Applications`，效果相同。 |
| `Info.plist` 的麥克風／語音辨識用途字串 | 只影響麥克風與 Speech 提示，不參與 `AXIsProcessTrusted`。 |
| `build.rs:45-48` 弱連結 Speech、`native/apple_speech.m` | 從 1.2.0 起。App 開得起來、Guide 收得到布林值，代表 `AXIsProcessTrusted` 有被呼叫且沒有 dyld 崩掉。弱連結解釋不了「回傳 false」。 |
| `Entitlements.plist` | 只有 `device.audio-input` 與 `apple-events`，沒有 App Sandbox。沙箱不是這次的原因。麥克風圖示也說明這支二進位的麥克風 TCC 是通的。 |
| 右 Option 鍵碼 | `macos_keycodes::OPTION_R = 61`（`569`），FlagsChanged 路徑有比對（`893-896`）。他說任何鍵都不行，不像單一鍵碼錯誤。這段比對 **未確認** 在 tap 活著時是否仍正確；權限失敗已足夠解釋「全部沒反應」。 |

啟動日誌也幫不上忙：`lib.rs:626-628` 寫明 plugin setup 的 log 發生在 logger 掛上之前。`FILE_LOG_ENABLED` 預設 `false`（`logging.rs:16-18`）。所以「Failed to create CGEventTap」這行，**就算從終端機啟動也不會留下**。視窗起來之後的 `check_accessibility_permission_command` 才進得了檔。tap 是否真的 `Err(())`，在看到那行之前是推論，標 **未確認**。

---

## 現在在 Kevin 的 Mac 上怎麼做

先完全退出（選單列圖示 → 結束，不要只關視窗）。下面指令只讀簽章，或只清 **這一個** bundle id 的授權。不要 `xattr -cr`、不要改 `TCC.db`、不要關 SIP。

1. 確認跑的是 `/Applications` 裡的新執行檔，不是 DMG、不是 App Translocation、也不是舊的 `sayit`：

```bash
ps -axo pid,command | grep '/TypeK'
ls -l "/Applications/TypeK.app/Contents/MacOS"
codesign -dv --verbose=4 "/Applications/TypeK.app"
codesign -d -r - "/Applications/TypeK.app"
```

路徑應含 `/Applications/TypeK.app/Contents/MacOS/TypeK`。`codesign` 應看到 `Signature=adhoc`、`TeamIdentifier=not set`，以及 `designated => cdhash H"…"`。若路徑含 `AppTranslocation`，退出，確認 App 在 `/Applications`，再從 Finder 打開。

2. 清掉對不上的輔助使用列，再重新加入。`tccutil` 的服務名稱在 macOS 27 **未確認**是否改過；UI 改名不代表服務 id 改了。指令失敗就改走手動 −／+，不要加 `sudo` 去刪資料庫。

```bash
tccutil reset Accessibility com.kekukeku.typek
```

若「隱私權與安全性」裡還有獨立的「輸入監控／Input Monitoring」，再執行：

```bash
tccutil reset ListenEvent com.kekukeku.typek
```

3. 打開 TypeK。Guide 出現時按「開啟系統設定」，或自己去 **系統設定 → 隱私權與安全性 → 裝置控制與資料存取**。不要去側邊欄那個「輔助使用」。

- 若 TypeK 還在清單：選它，按 **−** 移除。
- 按 **+**，選 `/Applications/TypeK.app`，把開關打開。
- 再完全退出，從 Finder 重新打開。

只把已經開著的開關關掉再打開，常常不會重寫 csreq。Synergy 在 macOS 27 的步驟也是 − 之後再加回來。

4. 驗收：Guide 不再出現；按住右 Option 會開始錄音、放開會停。開「文字編輯」，說一句，確認會貼上。兩件都要過。Guide 消失但快捷鍵仍沒反應時，再看有沒有獨立的 Input Monitoring 清單。

5. 若要留下證據：設定 →「除錯記錄（進階）」打開，完全退出再打開一次，按「開啟記錄資料夾」。檔案是：

`~/Library/Logs/com.kekukeku.typek/typek.log`

（Tauri `app_log_dir()`：`~/Library/Logs/{bundle id}`，檔名基底 `logging.rs:26` 的 `typek`。）

找 `AXIsProcessTrusted = false`。這行是視窗起來後的檢查，開關仍顯示開著時即可對上原因 1。檔案**不會**有啟動當下那次 tap 失敗。記錄含轉錄文字；看完把開關關掉，程式會刪掉記錄檔。

下次更新（含 1.3.0 → 1.3.1）仍是新的 ad-hoc cdhash，這份授權預期再失效一次。**未確認**，要等他那次更新後才算數。

---

## 建議的程式修法（問題 1 與 2）

沒有公開 API 能讀「清單裡的開關是不是開的」。`TCC.db` 受系統保護，不該為了這個向使用者要全磁碟取用權。`AXIsProcessTrustedWithOptions` 在兩種失敗時都回 `false`，也看不見系統有沒有跳出對話框。所謂「偵測到列在清單且開著、但其實沒信任」只能做成 **文案＋行為**，不能做成讀 TCC。

1. `src/i18n/locales/*.json` 的 `accessibility`（七個語系一起改；zh-TW 用「臺」）：
   - 標題可維持「需要輔助使用權限」。
   - 內文點名 macOS 27 的路徑：**隱私權與安全性 → 裝置控制與資料存取**。加一句：側邊欄的「輔助使用」是縮放／VoiceOver，沒有 App 清單。舊系統才叫「輔助使用」。
   - 步驟改成：若 TypeK 已在清單且開關是開的，先按 **−** 移除；完全退出 TypeK；再打開，按 **+** 選「應用程式」裡的 TypeK，打開開關；回到 App。
   - 明確寫：開關已經開著也不算；只再點一次通常不夠。每次更新都會換掉沒有 Apple 簽章的身份。
   - 刪掉「勾選後回到 App 就會自動啟用」這種在壞列上做不到的承諾。自動關閉 Guide 只發生在 API 真的變 `true` **而且** tap 建成功。
2. `AccessibilityGuide.vue`：使用者按過「開啟系統設定」之後，若每 2 秒的輪詢仍是 `false`，換上一段更短的 `accessibility.staleGrant`（同樣是 − 再 +）。這是時間觸發的提示，不是讀到開關。第一次安裝、清單裡還沒有 TypeK 的人，同一段也成立：沒有列可刪時直接按 +。
3. `hotkey_listener.rs`：`start_event_tap` 用 channel 把建立成敗傳回；`reinitialize_hotkey_listener` 在失敗時回 `Err`，不要先 `Ok(())`。Guide 只有在成功時 `emit("close")`。tap 失敗且 AX 仍為 `false`，維持現在這段移除再加入的文案。若以後遇到 AX 已是 `true` 但 tap 仍失敗，另顯示一句請檢查是否還有獨立的輸入監控，並可呼叫 `CGRequestListenEventAccess()`。以 DTS 2026-05 的口徑，這條應很少走到。**未確認** macOS 27 消費者開關是否仍把 listen 包在 Device Control 裡。
4. `open_accessibility_settings`（`607`）仍開 `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`。Kevin 最後停在正確的那一頁，但是不是這條 URL 帶他過去，**未確認**。文案要讓他能手動走到「裝置控制與資料存取」。URL 若在 27 上開錯頁，再改 anchor，不要猜一個新的。
5. 不要在 App 裡呼叫 `tccutil`。不要為了跨版本權限去改 bundle id。
6. 真正讓「更新後不用再授權」的做法是穩定的簽章身份（自簽「程式碼簽章」憑證，DR 改綁憑證，而不是 cdhash）。Developer ID 才過得了 Gatekeeper。這條專案已決定這版不做，而且自簽能否在 Kevin 的 Mac 上跨版留住 TCC，**未確認**。見 TN3127 與 https://v2.tauri.app/distribute/sign/macos/ 。這次 UI 修法不取代它。

---

## 問題 3：一進設定就開始麥克風測試

這與權限無關，是設定頁掛載時主動開了輸入串流。

`src/views/SettingsView.vue:1027-1031`：`onMounted` 載完裝置清單就 `startPreview(selectedAudioInputDeviceName)`。`useAudioPreview.ts:28-36` 呼叫 `start_audio_preview`。`audio_recorder.rs:137-179` 開一條 cpal 輸入串流，直到 `stop_audio_preview`。離開頁面才停（`SettingsView.vue:1054-1056`）。選單列出現 TypeK 的麥克風指示，和這條串流一致；他若當時停在設定頁，不必另找一支「偷偷錄音」的程式。正式錄音是別的指令，不會在「只是打開設定」時被這段呼叫。

重新整理裝置（`1009`）和改選裝置（`1021`）也會再 `startPreview`。重新整理是使用者按的按鈕，但仍不該在他沒要求測試時佔住麥克風。

音量條已經是 `v-if="isPreviewActive"`（`2127-2143`），沒在測就不該畫。

### 現在可以怎麼做

沒有開關可關。不要為了改別的設定而一直留在設定頁；離開該頁會停串流，指示應消失。若離開後指示還在，先完全退出 TypeK。cpal 在 macOS 上有已知的 stream 生命週期註解（`audio_recorder.rs:656`），指示是否會黏住，**未確認**。

### 建議的程式修法

- `SettingsView.vue` 的 `onMounted` 只留 `loadAudioInputDeviceList()`，不要 `startPreview`。
- 在「輸入裝置」卡、裝置選單下方加一顆按鈕。未測時「測試麥克風」，測試中「停止測試」。`aria-pressed` 綁 `isPreviewActive`。按下去才 `startPreview`／`stopPreview`。
- 音量條維持現在的 `v-if`。
- 測試進行中若改裝置或按重新整理，用新裝置重開預覽。沒在測時，這兩個動作都不要開麥克風。
- `onBeforeUnmount` 繼續 `stopPreview`，離開設定頁就放開裝置。
- 七個 locale 的 `settings.audioInput` 加上 `test`／`stopTest`。zh-TW：「測試麥克風」「停止測試」。
- `tests/component/SettingsView.test.ts` 目前只 mock `startPreview`（約第 99 行），沒斷言掛載時會呼叫。補兩則：掛載不呼叫；按下按鈕才呼叫。

---

## 來源

- TN3127（DR、ad-hoc 無法跨版本辨識身份）：https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- TN3126（cdhash）：https://developer.apple.com/documentation/technotes/tn3126-inside-code-signing-hashes
- Apple DTS，ad-hoc 更新後權限不沿用：https://developer.apple.com/forums/thread/795739
- Apple DTS，Accessibility 涵蓋 listen 與 post（2026-05）：https://developer.apple.com/forums/thread/828052
- ListenEvent 與 `CGRequestListenEventAccess`：https://developer.apple.com/forums/thread/735204
- macOS 27 改名與「開關開著仍無效、需 − 再 +」：https://support.symless.com/hc/en-us/articles/35743428145169-Troubleshooting-macOS-Device-Control-and-Data-Access-previously-Security-Privacy-in-Accessibility
- 側邊欄「輔助使用」不是 App 清單：https://docs.indiegoodies.com/pastepal/Mac/features/permissions
- 改名討論（Apple 支援文仍寫舊路徑）：https://discussions.apple.com/thread/256363811
- macOS 27 上 `CGEventTapCreate` 與 Device Control 的 MDM 討論：https://developer.apple.com/forums/thread/836770
- Tauri ad-hoc：https://v2.tauri.app/distribute/sign/macos/
