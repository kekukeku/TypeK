# 小B 審查：`docs/plan-auto-update-1.3.md`

審查日 2026-10-26。只讀計畫與現況，未改程式、未產生金鑰、未跑 Rust。
查閱日皆為 2026-10-26。未在 Kevin 的 Mac／Windows 上實機安裝更新的，標 **未確認**。

鎖定版本：workflow 用 `tauri-apps/tauri-action@v0`，該 tag 的 `package.json` 是 **0.6.2**（commit `84b9d35`，2026-03-14）。Rust 端 `src-tauri/Cargo.lock:6235` 是 **tauri-plugin-updater 2.10.0**（`Cargo.toml:23` 的 `~2.10.0` 鎖在 2.10.x）。

## 1. 五題

### 1. 不做 Apple 簽章時，覆蓋 App 有沒有權限／Gatekeeper／Translocation 問題？要不要偵測？

要偵測，而且要在呼叫 `install()` 之前。

計畫第 32 行寫 updater 會覆蓋 `/Applications/TypeK.app`。2.10.0 的安裝路徑是「目前執行檔」往上找到的那個 `.app`，不是寫死的 `/Applications`。

- 路徑演算法：`extract_path_from_executable`。`Contents/MacOS/<bin>` 再往上兩層。  
  https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/updater.rs#L1348-L1372
- 安裝：先把現有 `.app` `rename` 到 `$TMPDIR`，再把解壓出來的新目錄 `rename` 回去。權限不足（`PermissionDenied`）才改走 AppleScript：`rm -rf '<現有.app>' && mv -f '<新目錄>' '<現有.app>'`，並 `with administrator privileges`（會跳管理員密碼）。其他錯誤直接失敗。  
  同檔 `#L1212-L1304`，密碼對話在 `#L1255-L1269`。

因此：

- App 在 `/Applications`、使用者是 admin（該目錄通常 `root:admin` 可寫）：同一顆磁碟上的 `rename` 可以成功，不會先問密碼。
- App 在 `/Applications`、使用者不是 admin：第一個 `rename` 失敗後跳出管理員密碼。取消則舊 App 還在（第一個 `rename` 沒成功）。密碼對話成功但 `mv` 失敗時，2.10.0 可能把 App 刪掉，見下方 [HIGH] 插件版本。
- App 在 `~/Applications` 或使用者家目錄：一般可寫，不需要管理員。
- **App Translocation**：從 DMG、下載資料夾等帶 `com.apple.quarantine` 的位置直接打開時，執行路徑在 `/private/var/folders/.../AppTranslocation/.../d/TypeK.app`，那個磁碟是唯讀。更新會改到這條暫時路徑，失敗，或根本改不到使用者之後會再開的那一份。下次打開仍是舊版。DMG 磁碟（`/Volumes/...`）同樣不可寫。
- 計畫要加的偵測：`current_exe` 路徑含 `AppTranslocation`，或 `.app` 不在 `/Applications` 也不在 `~/Applications`，或該目錄不可寫。這種情況不要呼叫 `install()`。對話框請使用者結束 App、把 `TypeK.app` 拖進「應用程式」或「個人應用程式」再打開那一份。這是 1.3.0 就要有的，不能等 1.3.1 才發現更新沒裝到。

Gatekeeper／「已損毀」：

- 第一次用瀏覽器載 DMG 安裝 1.3.0，隔離屬性還在，ad-hoc 過不了 Gatekeeper。使用者仍要「強制打開」。計畫第 15 行已涵蓋。這段沒有因為做了 updater 而消失。
- 更新本體是 App 用 reqwest 下載，tar 解到暫存目錄再 `rename`。這段程式沒有呼叫設定 `com.apple.quarantine` 的 API（同上 `install_inner`）。新目錄是另一個 inode，舊 bundle 上的隔離屬性不會跟著走。Gatekeeper 的「已損毀／無法驗證開發者」是在有隔離屬性時才擋。依這個安裝方式，覆寫成功後不應再出現第一次安裝那個對話。**未確認**：沒有在實機對更新後的 bundle 跑 `xattr -l`。1.3.1 驗收要補這條，不能只看 App 開得起來。

### 2. 輔助使用權限每次更新失效，有沒有不靠付費帳號的減輕辦法？

`signingIdentity: "-"`（`tauri.conf.json:80`）做不到固定身份。`codesign -s -` 的 designated requirement 預設釘在該次建置的 **cdhash**。cdhash 每次建置都變，TCC 把新 bundle 當成另一個程式。固定 bundle id（已是 `com.kekukeku.typek`）不會讓 ad-hoc 的 cdhash 維持不變。Tauri 的 ad-hoc 說明只把 `"-"` 定義成偽身份，沒有「固定 cdhash」這個開關：https://v2.tauri.app/distribute/sign/macos/（頁面標 Last updated: May 17, 2026）。

有人用 `codesign -s -` 再塞一條 `designated => identifier "..."` 主張 TCC 會穩。那不是 Tauri bundler 的行為，也和 cdhash requirement 的常見結果相反。**未確認**，不要寫進這次計畫。

不付費、做得到的減輕：用一把**長命的自簽 Code Signing 憑證**（Keychain「程式碼簽章」範本，不必是 Apple Developer ID）。同一張憑證簽每一次 build，designated requirement 改釘憑證葉雜湊，輔助使用／麥克風才有機會跨版留著。Tauri 用 `signingIdentity` 或環境變數 `APPLE_SIGNING_IDENTITY` 指定鑰匙圈身份；CI 用 `APPLE_CERTIFICATE`（p12 的 base64）與 `APPLE_CERTIFICATE_PASSWORD` 匯入。同上 macOS 簽章頁。

限制要寫進計畫，否則會被做成「順便公證」：

- 自簽過不了公證，也過不了 Gatekeeper。第一次從瀏覽器安裝仍要強制打開。付費帳號仍是唯一能拿掉這步的路。這條不推翻 Kevin「不申請付費帳號」。
- 公證會在 `APPLE_ID`／`APPLE_PASSWORD`／`APPLE_TEAM_ID`（或 App Store Connect API 金鑰）有值時被 bundler 送出。自簽 p12 只填憑證與 `APPLE_SIGNING_IDENTITY`，那三個維持空白。填了會在 release 送公證然後失敗。
- 兩個 macOS matrix job 都要匯入同一張 p12。updater 不會在使用者機器上重簽，tar.gz 裡的簽名就是 CI 簽的。
- p12 遺失：使用者要重新授權一次。minisign 私鑰遺失：舊版永久無法驗證新版，只能手動重裝。兩把鑰匙分開保管。
- **未確認**：沒有用 TypeK 的 bundle 實測「自簽後 TCC 列跨版仍有效」。機制是憑證葉雜湊穩定；上線前要用 1.3.0→1.3.1 在同一台 Mac 看輔助使用開關是否還算數。

若維持純 ad-hoc，計畫第 33 行應改成確定句，不要寫「很可能」「麥克風可能」：

- 輔助使用：新 cdhash **不會**跳出系統詢問。舊開關看起來還開著也不算數，必須從清單移除再加回。現有 `AccessibilityGuide` 的步驟是對的。
- 麥克風：`cpal` 錄音走 TCC 麥克風（`Entitlements.plist:5` 的 `device.audio-input`）。新身份後系統通常會再問一次。**未確認**詢問是否每次都出現。
- 貼上是 `CGEvent` 模擬 Cmd+V（`clipboard_paste.rs`），走輔助使用，不走「自動化」的 AppleEvents。`Entitlements.plist` 雖有 `apple-events`，使用者文案不要寫自動化權限。

### 3. `releaseDraft: true` 時，`latest.json` 會不會被 `releases/latest` 提早讀到？

草稿階段不會。公開當下有別的風險。

GitHub REST「Get the latest release」：latest 是最近的**非預發布、非草稿** release。草稿不能設成 latest。`make_latest` 在新發布時預設 `true`。  
https://docs.github.com/rest/releases/releases （回應範例的 `X-GitHub-Api-Version: 2026-03-10`）

現況 `release.yml:125` 先草稿、`release.yml:189` 才 `gh release edit --draft=false`。草稿存在時，`releases/latest/download/latest.json` 仍指向上一個已公開 release。1.3.1 還在建置時，已裝 1.3.0 的人不會讀到半套 manifest。下載 URL 也被 tauri-action 改成 tag 路徑（`/download/vX.Y.Z/`），不是 `releases/latest/download/<安裝檔>`（`tauri-action` v0 `src/upload-version-json.ts` 約 192–197 行）。草稿資產對外 404，已公開的舊 `latest.json` 不會指到草稿檔。

剩下的風險：

- 三個 matrix job 同時刪除再上傳 `latest.json`。`@v0`（0.6.2）沒有 2026-05-09 那筆隨機延遲（commit `98b1609`，在 `dev`，issue https://github.com/tauri-apps/tauri-action/issues/1270 ，寫的是 v0.6.1）。結果是 job 紅掉（404，可重跑），或後寫入的那份少一個平台。少平台時 `check()` 對那個架構是錯誤，不是安靜略過。官方 updater 頁寫明：靜態 JSON 會先驗證整個檔，再比版本。一個平台的 `url`／`signature` 是空的，所有平台的檢查一起失敗。https://v2.tauri.app/plugin/updater/
- 計畫第 61 行把檢查放在 `publish-release` **之後**。那時 `draft=false` 已經送出，job 失敗不會把 release 收回草稿。檢查要放在 `gh release edit --draft=false` **之前**，失敗就保持草稿。
- `gh release edit --draft=false` 沒有 `--latest`。API 對新發布預設 `make_latest=true`，man page 的發布範例也是這一行。**未確認** TypeK 這條指令在這個 repo 上是否真的變成 latest。驗收要打未登入的 `https://github.com/kekukeku/TypeK/releases/latest/download/latest.json`，並看 `gh release view <tag> --json isDraft,isLatest`。只列出該 tag 的資產會漏掉「檔在，但 latest 仍指向上一版」。

### 4. `createUpdaterArtifacts` 用 `true` 還是 `"v1Compatible"`？

用 **`true`**。不要用 `v1Compatible`。

https://v2.tauri.app/plugin/updater/ （查閱 2026-10-26；搜尋索引日期 2025-11-28，與當頁「v2 / v1 compatible」對照表一致）：

- `true`：v2 產物。macOS 是 `.app.tar.gz` + `.app.tar.gz.sig`。Windows 是安裝檔本身 + `.sig`（`*-setup.exe` + `*-setup.exe.sig`，以及 MSI 的 `.msi` + `.msi.sig`）。
- `"v1Compatible"`：給已經裝了 Tauri v1 updater 的使用者。Windows 再包一層 `.nsis.zip`／`.msi.zip`。文件寫此值會在 v3 移除。

TypeK 已出貨的版本 endpoints 是空的、前端開關是關的（`tauri.conf.json:62-69`，`autoUpdater.ts:17-18`）。沒有 v1 updater 客戶端。`v1Compatible` 只會讓 2.10 插件去吃 zip，和現在的 NSIS 直接安裝路徑岔開。

`windows.installMode: "passive"` 不用寫。2.10.0 的預設就是 `Passive`（`config.rs` 的 `#[default]`）。被動模式的 NSIS 參數是 `/P` 與 `/R`，另外固定加 `/UPDATE`。  
https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/config.rs#L14-L44  
https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/updater.rs#L801-L816

### 5. 還漏了什麼？

見第 2 節。必補的是：插件升到含 macOS 失敗還原的版本、公開前檢查 `latest.json`、Translocation／安裝位置偵測、Windows 實際走 NSIS 且 `install()` 會直接結束行程、minisign 金鑰用檔案灌進 secret、版本比對是 semver 大於現行版。

## 2. 問題

### [HIGH] macOS 更新失敗可以刪掉已安裝的 App

`tauri-plugin-updater` 2.10.0 把舊 `.app` 移進 `tempfile::TempDir`。第二步 `rename` 失敗時，函式返回，`TempDir` 的 `Drop` 把備份一起刪掉。安裝路徑上沒有 App，更新也沒裝上。跨磁碟（`$TMPDIR` 與 App 不在同一卷）的 `EXDEV` 是已知觸發。issue 寫明當時 v2 HEAD 與 2.10.0 都是這段程式：https://github.com/tauri-apps/plugins-workspace/issues/3505 （2026-07-18）。

2.13.2（2026-10-07）改成能原子交換的檔案系統就原子交換，否則還原舊 App，或留下 `<name> (previous version).app` 並回 `Error::PreviousAppNotRestored`：https://v2.tauri.app/release/updater/

`Cargo.toml:23` 的 `~2.10.0` 到不了 2.13。計畫要先放寬這個版本（JS `@tauri-apps/plugin-updater` 一起對到同一個 2.13.x），讓 CI 更新 `Cargo.lock`。本機沒有 Rust，這次審查沒有編譯。2.13.0 的 MSRV 是 1.90；`release.yml` 用 `dtolnay/rust-toolchain@stable`，2026-10 的 stable 高於 1.90。

2.13.3（2026-10-10）把 `minisign-verify` 升到 0.3，拒絕非標準 Ed25519 `S`。**未確認**現在這支 tauri-cli 2.10.0 產出的 `.sig` 是否都能過。保守鎖 **2.13.2**，或在 CI 用測試金鑰做一次簽章驗證再決定要不要 2.13.3。不要為了這個在本機產生正式金鑰。

成功安裝之後，2.10 的備份目錄仍會被 `TempDir` 清掉。沒有「自動退回上一版」。壞掉但已替換成功的版本，只能再發更高版號，或請使用者重裝 DMG／exe。updater 預設只接受較新的 semver，不會降版（`updater.rs:532`：`release.version > current_version`）。文件要寫這句。`docs/deployment-guide.md` 第九節「不要刪 release、改發下一版」與此相符，保留。

### [HIGH] 三平台 `latest.json` 要在公開前驗證，而且 `@v0` 會互相覆寫

計畫第 60–61 行。`includeUpdaterJson` 在 `@v0` 的 `action.yml` 預設 `true`。輸入名稱是 `includeUpdaterJson`。`uploadUpdaterJson` 是之後 `dev`／1.0 的改名。寫錯名字不會啟用上傳。

每個 job 會下載現有 `latest.json` 再合併自己的平台，然後整檔重傳。平行 job 仍會互踩（上一則 HIGH 的 issue #1270，修復不在 0.6.2）。`retryAttempts` 預設 0；issue 說設 3 只能降低 404，沒有延遲就消不掉。可以設，不能拿它當合併正確的證明。

公開前（仍是草稿、用 `GITHUB_TOKEN` 讀得到）確認：

- `version` 等於這次 tag 去掉 `v` 之後的版號，且是合法 semver。tauri-action 的 `version` 來自 `tauri.conf.json`，不是 tag 字串。`workflow_dispatch` 打到沒改版號的 commit 時，客戶端會認為沒有更新。
- `platforms` 至少有 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`，每個的 `url` 與 `signature` 都非空。
- `windows-x86_64` 的 `url` 以 `-setup.exe` 結尾。見下一則。
- 缺任一项就不要執行 `gh release edit --draft=false`。

金鑰空值檢查要放在 `release.yml:84`「Export optional signing secrets」**之後**、`tauri-action` 之前。放在 export 之前，secret 還沒進環境變數，檢查永遠失敗。

### [HIGH] Windows 會裝到哪一個安裝檔；`install()` 不會回到 `request_app_restart`

`bundle.targets` 是 `"all"`（`tauri.conf.json:70`），Windows 同時產 NSIS 與 MSI。`@v0` 在沒有設定 `updaterJsonPreferNsis` 時，該旗標是 **false**（`src/index.ts` 第 57–60 行註解仍寫「TODO: 以後 v2 再改成 true」）。primary key `windows-x86_64` 會優先指向 `.msi`（`upload-version-json.ts` 第 150–156 行）。

2.10 客戶端找 key 的順序是 `{os}-{arch}-{installer}`，然後才 `{os}-{arch}`（`updater.rs:578-586`）。用 NSIS 裝上的行程，bundle type 是 `nsis`，會先用 `windows-x86_64-nsis`。action 對每個安裝檔都會寫這個後綴 key。所以「從穩定檔名 `TypeK-windows-x64.exe` 裝上的人」仍會更新到 NSIS。會吃到 MSI 的是 bundle type 不是 nsis 的行程，以及只檢查 primary key 的人。

MSI 路徑是 `msiexec /i ... /passive /promptrestart ... AUTOLAUNCHAPP=True`（`updater.rs:818-833`）。`/promptrestart` 仍可能問要不要重開機。這和「被動、不問人」不一樣。

明寫 `updaterJsonPreferNsis: true`。驗收看 `windows-x86_64` 的 url。

Windows 的 `install_inner` 用 `ShellExecuteW` 啟動安裝檔，然後 `std::process::exit(0)`（`updater.rs:854-865`）。官方頁同一句：Windows 在安裝步驟會自己結束 App。JS `install()` 不會 resolve。`autoUpdater.ts:70-72` 與 `:86-87` 在 `install()` 之後的 `request_app_restart` 在 Windows 上不會執行。重開靠 NSIS 的 `/R`。

`std::process::exit` 不會跑 `lib.rs:717-736` 的 `RunEvent::Exit`（還原系統音訊、停掉熱鍵 tap、flush Sentry、自己 spawn）。更新當下若系統音訊被靜音，可能不會還原。**未確認**實機，機制來自這兩段程式。

SmartScreen：計畫第 34 行寫「通常不跳（未確認）」。維持未確認。每次建置雜湊都沒有信譽。reqwest 寫進暫存檔，程式沒有加 Mark-of-the-Web；沒有 MOTW 時藍色提示較少出現，不是保證。不要寫進使用者文件。

### [HIGH] 版本比較與壞 manifest

`check()` 用 semver，遠端版號必須**大於** App 內建版號（`updater.rs:532`）。開頭的 `v` 會去掉（`parse_version`，約 1438 行）。`1.3.0` 對上 `latest.json` 的 `1.3.0` 是沒有更新。`1.3.1-rc.1` 大於 `1.3.0`，一旦這種版號進了 latest，穩定版使用者也會被提供。穩定頻道不要放預發布版號。`release.yml:126` 的 `prerelease: false` 要維持。

`pub_date` 不是合法 RFC3339 時，整個 JSON 反序列化失敗，所有平台都檢查失敗（`updater.rs` 約 1397–1401 行）。

前端：自動檢查失敗只把狀態設回 `idle`（`MainApp.vue:123-126`），沒有 `updateFeedback`。簽章不符或 `latest.json` 壞掉時，使用者每 15 分鐘靜默失敗一次（間隔在 `MainApp.vue:78`）。手動檢查才看得到 `mainApp.update.checkFailed`（`zh-TW.json:458`）。計畫第 71 行的 Releases 連結要接到手動失敗，也要讓自動失敗至少顯示一次，否則「App 裡可以更新」在伺服器壞掉時沒有表面。

### [MED] 金鑰進 GitHub 的方式，以及檢查放錯步

計畫第 40–48 行的產生方式（Kevin 本機執行、只把 `.pub` 給實作、私鑰進密碼管理器）是對的。官方同一段：私鑰遺失就無法對已安裝的使用者發更新，簽名不能關。https://v2.tauri.app/plugin/updater/

補兩件：

- 用 `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/typek.key` 灌檔案內容。從網頁貼上會改掉換行，之後簽名失敗。密碼同樣用 `gh secret set`，不要進 repo、不要進這份審查。`-w` 維持 `~/.tauri/typek.key`，不要指到 iCloud 裡的專案目錄。
- `plugins.updater.pubkey` 是 `tauri signer generate` 印出的那一行（`.pub` 的內容），通常是整份 minisign 公鑰的 base64。不能填路徑。多一層引號或換行會讓 2.10 的 `base64` 解碼失敗，所有更新簽章驗證失敗（`updater.rs` 的 `verify_signature`）。
- 沒有「舊 App 已內建舊公鑰、新版改用新 minisign 仍能無縫更新」的路。公鑰編進 1.3.0。換鑰匙 = 已裝版本驗證失敗 = 手動重裝一次。文件只寫這句。不要再設計輪替流程。
- 空密碼的早期檢查只看得了「變數非空」，看不得「密碼打得開這把鑰匙」。打包尾端仍會失敗。早期檢查值得留，不要把它當成鑰匙正確。

### [MED] 重啟與 single-instance

macOS／Linux 要自己重開；Windows 不要。官方範例是 `install()` 之後呼叫 plugin-process 的 `relaunch()`。TypeK 改走 `request_app_restart`（`lib.rs:87-90`）是因為 `RunEvent::Exit` 裡的 `_exit(0)` 會截斷 Tauri 內建重啟（`lib.rs:717-736`）。這段保留。

`single-instance` 在 `lib.rs:458`。新行程若在舊行程還握著鎖時啟動，會被當成第二個實例，只把舊視窗叫出來然後自己退出；接著舊行程 `_exit(0)`，畫面上就沒有 App。spawn 後立刻 `_exit`，新行程要過幾百毫秒才起來，鎖多半已經放掉。CHANGELOG 寫過這個 `_exit` 路徑是為了修好「更新後不重啟」。1.3.1 仍要實測：更新完只有一個行程，而且是新版號。

### [MED] 文件會把錯的現況寫回去

`.claude/rules/release.md:96` 的 `window.confirm` 確實已過時。`autoUpdater.ts` 沒有 `window.confirm`，UI 在 `MainApp.vue` 的 `AlertDialog`。

同檔第 93 行仍寫「每 4 小時」且放在 `main-window.ts`。程式是 `MainApp.vue:77-78`：啟動 5 秒後，之後每 **15 分鐘**。改「已啟用」時把這行一起改掉，否則規則會繼續教錯。

`docs/deployment-guide.md` 第四節仍寫 notarize 等待、第五節仍把 Apple 簽章寫成下一步。這次只改 §5.4 的話，發版檢查清單還會要求 13 個 secret 與公證 DMG。§5.4 要寫明：Apple 簽章維持不做；updater 的兩個 secret 改為發版必要；Apple 那 6 個仍是空的。

### [LOW] 其他

- `release.md` 與 `docs/source-tree-analysis.md` 的「4 小時」是舊的。計畫不必擴大去改分析文件，除非這次本來就要碰。
- 自簽憑證若要做，是獨立於 minisign 的 p12。不要把 p12 放進 repo。
- CSP 的 `connect-src`（`tauri.conf.json:52`）不必加 GitHub。updater 是 Rust 的 reqwest，不走 webview。`capabilities` 的 `http:default` 也不必加。加了沒有幫助。
- 1.2.2 與更早沒有可用的 updater。必須手動裝一次 1.3.0。這句計畫第 15 行是對的。
- 1.3.0 公開後只能證明 manifest 與資產在。更新路徑要等 1.3.1。計畫第 90、104 行是對的。1.3.1 的實機清單要含：Arm64 與一台 Intel 或 Rosetta、App 在 `/Applications`、App 留在下載資料夾或 DMG（應被擋住）、非 admin 帳號、更新後 `xattr` 沒有 quarantine、輔助使用是否重置、Windows NSIS 是否重開且只有一個行程。

## 3. 可刪

- **刪** `plugins.updater.windows.installMode: "passive"`。2.10 預設就是 passive。留著不是錯，是空設定。
- **刪**「把 `includeUpdaterJson` 明寫出來」這項工作。`@v0` 預設已是 true。不要改名成 `uploadUpdaterJson`（那是這支 `@v0` 沒有的輸入）。改成只加 `updaterJsonPreferNsis: true`。
- **刪**計畫 §5 裡再寫一輪 `autoUpdater.ts` 單元測試。`tests/unit/auto-updater.test.ts:30-135` 已覆蓋：開關關掉不呼叫 `check`、無更新、有更新、例外、`download` 不安裝、`installAndRelaunch` 與 `downloadInstallAndRelaunch` 的順序。那份測試的 `install()` 是 mock，證明不了 Windows `process::exit`。不要加一個假的「Windows 也會呼叫 `request_app_restart`」斷言。
- **刪**為了兩句文案去 mount 整個 `MainApp.vue`。沒有現成的 MainApp 元件測試。對話框與 `AccessibilityGuide` 共用一個 i18n key（輔助使用要移除再加入；麥克風可能再問一次）。七語系沿用既有 JSON 合法性檢查。`AccessibilityGuide` 已有 `tests/component/AccessibilityGuide.test.ts`，有新句子再補那裡。
- **刪** CSP／`http:default` 白名單、自架更新伺服器、beta 頻道、強制更新、靜默安裝。計畫「不做」已列後三項，實作時不要加前兩項。
- **刪**文件裡的「金鑰輪替步驟」。只留「換 minisign 鑰匙 = 已安裝版本無法驗證 = 手動重裝一次」。

## 來源

| 來源 | 用在哪 |
| --- | --- |
| https://v2.tauri.app/plugin/updater/ 查閱 2026-10-26 | `true` vs `v1Compatible`、靜態 JSON、Windows 安裝會結束 App、私鑰遺失、`installMode` 預設 passive |
| https://v2.tauri.app/distribute/sign/macos/ Last updated May 17, 2026 | ad-hoc `"-"`、CI 的 `APPLE_CERTIFICATE`、公證要另備 Apple 憑證 |
| https://v2.tauri.app/release/updater/ 查閱 2026-10-26 | 2.13.2（2026-10-07）macOS 失敗不再刪 App；2.13.3（2026-10-10）minisign |
| https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/updater.rs | 安裝路徑、AppleScript、Windows `exit`、semver、平台 key |
| https://github.com/tauri-apps/plugins-workspace/issues/3505 2026-07-18 | 2.10.0 失敗刪 App |
| https://github.com/tauri-apps/tauri-action/blob/v0/action.yml 與 tag v0 = 0.6.2 | `includeUpdaterJson` 預設 true；`updaterJsonPreferNsis` 未設等於 false |
| https://github.com/tauri-apps/tauri-action/issues/1270 2026-02-05 | 平行上傳 `latest.json`；修復 commit 不在 0.6.2 |
| https://docs.github.com/rest/releases/releases API 2026-03-10，查閱 2026-10-26 | latest 不含草稿與預發布；`make_latest` 預設 |
