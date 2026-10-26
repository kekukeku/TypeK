小C 審查：`docs/plan-auto-update-1.3.md`

審查／來源查閱日：**2026-10-26（Asia/Taipei）**。結論：先修正下列 HIGH 項，再啟用發版；不能以「下載成功、簽章正確」代表使用者已完成更新。

本次只審查並寫此檔。依據目前工作樹、`Cargo.lock:6234` 的 updater **2.10.0**、Tauri **2.10.2**、pnpm lock 的 CLI **2.10.0**；action 查閱 `v0` 原始碼（可移動 ref，正式實作應固定經驗證的 commit）。未建置、未安裝、未產生金鑰、未觸發 CI／發版；macOS／Windows 實機結果均**未確認**。

**1. 問題一：macOS 覆蓋、權限、Gatekeeper、Translocation**

- **[HIGH] 不是固定覆蓋 `/Applications/TypeK.app`，也不能保證更新後不被攔截。** `plan-auto-update-1.3.md:32,108`：外掛由執行檔位置推算目前 `.app`，在該位置替換。程式沒有主動設定 quarantine，但這只支持「此下載流程未主動加入」，不能推出「系統永不攔截」；Apple 還會追蹤下載程式所寫檔案的來源。minisign 只驗更新包來源，不會取得 Developer ID、公證或 TCC 信任。將原句改為「預期可原地更新；是否再次出現系統攔截須以支援的 macOS 實測」。來源：[updater 2.10.0][U]、[Apple Gatekeeper][G]。
- **[HIGH] 要偵測不適合更新的位置，但不要把非管理員一律判定失敗。** `plan-auto-update-1.3.md:108`：2.10.0 移動舊 App 遇到 `PermissionDenied` 會以 AppleScript 要求管理員授權；沒有管理員憑證或取消時仍會失敗。App Translocation／DMG 是另一種問題：隨機唯讀位置無法靠這個流程正常原地更新。安裝前檢查實際 bundle 路徑與唯讀狀態，遇到這些位置提示「將 TypeK 拖到 Applications，退出後從該處重新開啟」。允許正常可寫的 `~/Applications`；不要硬編碼目標、不新增 sudo/helper，也不要以關閉 Gatekeeper 或廣泛清除 quarantine 作為正常流程。來源：[外掛替換與提權][U]、[Tauri 路徑解析][PATH]、[Apple Translocation 說明][T]。

**2. 問題二：不用付費帳號能否減少輔助使用權限失效？**

- **[MED] 固定 identifier 或反覆 `codesign -s -` 不能提供跨版本簽署身分。** `plan-auto-update-1.3.md:33,109`：Apple 說明 ad-hoc 的 designated requirement 綁定特定程式版本。保留 `com.kekukeku.typek`、App 名稱與安裝位置有助減少額外變因，卻不能承諾保留 TCC。TypeK 各 macOS 版本的 Accessibility／麥克風實際失效頻率**未確認**，不要改寫成「每次必定失效」。來源：[Apple TN3127][DR]。
- **[MED] 現行前提下，採權限檢查與恢復引導；不要宣稱所有無付費方案都不可能。** `plan-auto-update-1.3.md:68`、`src/components/AccessibilityGuide.vue:32,58`：已有輪詢與 hotkey listener 重建，沿用即可。文案改為「若更新後無法使用快捷鍵，請重新授予輔助使用權限」，不要在初次安裝／使用者自行撤銷權限時也斷言「因更新失效」。重新加入後驗證快捷鍵、輸入文字、錄音；必要時完整退出再開。麥克風須另行處理，AX guide 不涵蓋它。
- **[LOW] 免費自簽憑證是不同方案，這版不納入。** Apple 文件允許自簽憑證建立可辨識後續版本的 DR，但不能因此推定現行 TCC 一定保留，也不會通過 Gatekeeper 公證要求。若未來放寬「永遠 ad-hoc」才值得獨立驗證；目前不要加憑證管理、自訂弱 DR 或自動 `tccutil reset`。來源：[Apple Code Signing Tasks][SELF]。TypeK 自簽憑證方案的 TCC 成效：**未確認**。

**3. 問題三：draft → publish 與 `latest.json`**

- **[HIGH] 新建 draft 不會成為公開 latest；計畫的驗證位置放反了。** `plan-auto-update-1.3.md:61`、`.github/workflows/release.yml:169-189`：保留 `needs: build`，先以有權限的 GitHub API／CLI 讀指定 draft 的資產，驗證完成才執行 `--draft=false`。公開後再以匿名請求確認 `/releases/latest/download/latest.json`；此時的失敗只是事故告警，無法撤回已下載的更新。GitHub latest 排除 draft／prerelease，不能假設任意發布順序都等於 SemVer 最大值。來源：[GitHub Releases API][GH]。
- **[HIGH] action 會合併 JSON，但不是原子合併。** `.github/workflows/release.yml:18-39,111`：`includeUpdaterJson` 預設 true；action 讀既有 JSON、合併本 job 平台、刪舊資產再上傳。三個 matrix job 可互相覆寫或碰撞，成功建置也不能取代最終 manifest 驗證。最小做法是序列化此發布步驟；若不拆 job，可用 `max-parallel: 1`，代價是三平台建置變慢。缺平台一律留 draft，不要自己另造一套 manifest 產生器。來源：[action inputs][A]、[upload-version-json.ts][JSON]。
- **[HIGH] 重跑已公開 tag 不受 `releaseDraft: true` 保護。** `.github/workflows/release.yml:7-11,125,157,167`：action 搜尋相同 tag 時會沿用既有 release，沒有保證它仍是 draft；`--clobber` 也會覆寫資產。發布前拒絕修改已公開版本，並避免同 tag workflow 同時執行；修復用新版本。來源：[getOrCreateRelease][CREATE]。

發布前 gate 至少驗證：tag／App／manifest 版本一致；兩個 Darwin 架構與 Windows 實際選用項目齊全；每個 URL 指向**同一 tag 的版本化資產**、架構與安裝格式正確；`signature` 是 `.sig` 的內容且與該檔案配對；用內嵌公鑰驗證實際更新包。Draft 的公開下載 URL 尚不可匿名使用，應經 authenticated asset API 檢查，再於 publish 後驗匿名下載。不要只檢查三個 key 存在。

**4. 問題四：`true` 還是 `v1Compatible`？**

- **[LOW] 選 `true`，刪除相容格式的實作分支。** `plan-auto-update-1.3.md:56,111`：TypeK 沒有需要服務的 Tauri v1 updater 用戶。macOS 是 `.app.tar.gz`＋其 `.sig`；Windows v2 直接使用 NSIS `.exe`／MSI `.msi`＋各自 `.sig`，不是必須再包 zip；DMG 是手動安裝用。`.sig` 由打包簽署流程產生，action 將內容填進 JSON，客戶端通常不另抓 `.sig`。來源：[Tauri updater 格式][DOC]、[action JSON 產生流程][JSON]。

**5. 問題五：其他必要修正／缺漏**

- **[HIGH] Windows 安裝會直接退出，現有自訂清理不會照常執行。** `plan-auto-update-1.3.md:34,82`、`src/lib/autoUpdater.ts:71-72,85-87`、`src-tauri/src/lib.rs:469,676-736`：updater 啟動安裝器後 `std::process::exit(0)`，後面的 JS restart 不會執行。外掛有 Tauri `cleanup_before_exit`，但不是 TypeK 的 `RunEvent::Exit` 清理。錄音中的系統靜音恢復（`audio_control.rs:21`）可能漏掉。應在交給安裝器前停止／保存工作並完成必要清理，禁止錄音／轉錄／輸出中安裝；測試分平台，不能把 mock 的 download→install→restart 當 Windows 驗收。來源：[外掛 Windows 流程][U]、[預設 before-exit hook][ULIB]、[Tauri cleanup][APP]。
- **[MED] NSIS 行為與 manifest 選擇需寫準。** `src-tauri/tauri.conf.json:70` 是 `targets: "all"`，不只有 NSIS。action 的通用 `windows-x86_64` 預設偏好 MSI；updater 2.10.0 優先找 `windows-x86_64-nsis`／`-msi`，再回退通用 key。若決定主推 NSIS，明寫 `updaterJsonPreferNsis: true`，並驗證具名項目；若仍發 MSI，不能默默丟掉其更新路徑。Passive 對 NSIS 是 `/P /R`，另加 `/UPDATE`，成功後由安裝器重開 App；不是 JS 重開，也不是重啟電腦。來源：[action 選項][A]、[外掛 installMode][CFG]、[NSIS 成功處理][NSIS]。
- **[MED] 刪除「SmartScreen 通常不跳」的預期。** `plan-auto-update-1.3.md:34`：TypeK 此路徑是否跳出提示**未確認**；minisign 不等於 Windows Authenticode，Smart App Control／企業政策仍可能阻擋。驗收包含一般使用者、現有安裝範圍、UAC 取消、安裝器失敗與手動復原；不能期待已退出的 App 顯示所有安裝錯誤。來源：[Microsoft SmartScreen／Smart App Control][MS]。
- **[HIGH] macOS 沒有完整 rollback 保證。** `plan-auto-update-1.3.md:71`：2.10.0 的一般路徑先把舊 App 移到暫存，再移入新版；後一步失敗沒有顯式還原。提權路徑則先刪舊目標再移新版。暫存備份不等於持久救援包，也沒有「新版啟動失敗自動回退」。需記錄此限制，實測空間不足／唯讀／授權取消／替換失敗；提供同架構已知可用的手動安裝包及保留資料的修復步驟。正式 latest 改回舊版不會讓已升級用戶自動降版，優先發布更高版本修復包。來源：[macOS 安裝與版本比較實作][U]。
- **[HIGH] macOS 重啟實作要驗證「新程序持續活著」，不能只驗 invoke。** `src-tauri/src/lib.rs:458,719-736`：目前在舊程序退出前 spawn，再 `_exit(0)`；錯誤只寫 log。更新會替換執行檔，必須驗證重啟路徑、版本，以及與 single-instance 的互動；是否會啟錯路徑／被舊 instance 擋住，本次**未確認**。若失敗，使用者須能從安裝位置重新開啟。不要為本計畫盲目改成 `process.relaunch()`，現有退出流程會截斷 Tauri 內建重啟。
- **[HIGH] 自動／手動流程有可見的交錯漏洞。** `src/MainApp.vue:98-108,179-186`、`src/lib/autoUpdater.ts:10,30-38,83-86`：自動檢查在 await 期間仍是 `idle`；手動確認框開著時也回到 `idle`。另一輪 check 可替換全域 `pendingUpdate`，導致畫面版本、下載物件與安裝物件不一致。最小修正：共用一個 in-flight／確認中狀態，整筆交易固定同一 Update；失敗後清理、解鎖。用 deferred promise 測「自動 check 中點手動」「確認框開著碰到 timer」「下載中另一次 check」。
- **[MED] Update resource 需釋放；背景下載不是持久暫存。** `src/lib/autoUpdater.ts:33,38,40-43`：覆寫／放棄 Update 沒有 `close()`，失敗也可能殘留舊 pending。外掛把已下載 bytes 留在 Rust resource；不會因 JS 變數被換掉就自動釋放，也不能期待退出後保留。替換／取消／失敗時釋放已不使用的物件，重開 App 就重新檢查下載；不必另建磁碟快取。來源：[Update.close 與 guest API][JS]、[Rust resource 管理][CMD]。
- **[MED] 錯誤處理與逾時不是現成齊全。** `src/MainApp.vue:105,123-126,188`、`src/lib/autoUpdater.ts:30,57`：自動 check 的 error 直接被略過，下載錯誤只進 log/Sentry；因此計畫 `:71` 的「沿用 updateFeedback」不涵蓋自動流程。保留背景不打擾，但提供可重試的狀態與固定 Releases 連結；辨別下載／驗簽失敗、授權取消、已替換但重開失敗，勿一律宣稱原版完好。對 check 與 download **分別**設定合理 timeout，避免手動 UI 一直忙碌；下載 timeout 不能只靠 check 選項。來源：[guest API timeout 選項][JS]。
- **[HIGH] 手動 workflow 可能把錯的程式碼掛到 tag。** `.github/workflows/release.yml:43,48-59,122`：`inputs.tag` 只拿來命名，checkout 未指定該 tag；手動執行時可能建置所選分支，卻發布成另一版本。checkout 必須對應 tag，建置前驗證 package／Tauri config／Cargo 版本與 tag，並以 action 的 appVersion／manifest 再交叉確認。`scripts/release.sh:17-24` 只驗外形，沒有保證版本遞增，也接受 `01.3.0` 這類非標準 SemVer。至少拒絕不合法／非遞增正式版，且不新增前端版本比較器。
- **[MED] 版本判斷應留給外掛；補邊界案例，不靠字串比較。** `src/lib/autoUpdater.ts:30` 使用 `check()` 即可，外掛預設以 SemVer 判斷遠端大於目前版本。同版／較舊版不更新；`1.10.0 > 1.9.0`；正式版高於同版本 prerelease。保持預設不降版；測到錯誤 manifest、缺平台、HTTP 404／離線時應顯示失敗而非「已是最新」。更高版本號的 prerelease 仍可能通過 SemVer，比較器不代替 release 的穩定版篩選。來源：[Tauri 版本規則][DOC]、[updater 檢查實作][U]。
- **[MED] 金鑰遺失與正常輪替不能寫成同一件事。** `plan-auto-update-1.3.md:47,75`：私鑰或必要密碼完全遺失且無備份時，確實無法再供舊客戶端驗簽，需手動覆蓋安裝新信任根。舊私鑰仍在時，技術上可用舊 key 簽「內嵌新 pubkey」的橋接版；但單一 latest 一旦切到新 key，跳過橋接版者仍失敗，不能宣稱全用戶無縫輪替。1.3 保留同一 key＋離線加密備份即可；文件另記洩漏時停發、撤除有問題的資產、通知及新 key 手動復原，不能假裝只換 GitHub Secret 就會更新客戶端信任。來源：[Tauri 簽章與遺失限制][DOC]；橋接與跳版限制為依該信任模型的推論。
- **[HIGH] 端到端測試不能留到正式 1.3.1 才開始。** `plan-auto-update-1.3.md:90,104`：可由 GitHub Actions 產兩個版本的安裝包，測試包用獨立 HTTPS fixture 指向已簽署資產，不經正式 latest、不需要產品級 beta 頻道或本機 Rust。至少先驗 macOS ARM／Intel、Windows NSIS 的實際升級；包含首次瀏覽器下載→安裝→授權→更新→重新啟動，確認版本、快捷鍵、麥克風、文字輸出、設定／歷史保留，以及上述失敗情境。只有 Kevin 的一台 Mac 通過，不代表另外兩平台已通過；未測平台明列**未確認**。

**可刪／縮減的工作**

- **[LOW] 刪「等 1.3.1 才測」及為測試特別公開一個正式版本。** `plan-auto-update-1.3.md:90`；改發佈前兩包測試。
- **[LOW] 刪「換 key 一律重裝」、固定 ad-hoc 身分研究及重複做 updater 基礎能力。** `plan-auto-update-1.3.md:75,109`；不新增 SemVer 套件、更新伺服器、提權 daemon、自動降版／完整 rollback 框架或永久下載快取。保留簡單恢復文件與必要狀態修正。
- **[LOW] 不需重做已有測試。** `plan-auto-update-1.3.md:82` 所列 env／有無更新／check 例外／基本呼叫，`tests/unit/auto-updater.test.ts:30-164` 已覆蓋大部分。直接補交錯、失敗不安裝／不重啟、resource 釋放、平台差異；mock 測試無法取代 OS 驗收。
- **[LOW] `passive`、`includeUpdaterJson: true` 已是預設，明寫只作意圖說明。** `plan-auto-update-1.3.md:55,60`；不用為這兩項再做封裝。`updater:default` 已在 `capabilities/default.json:43`；這次不需要加權限或新依賴。
- **[LOW] README 七份各保留短更新指引即可，技術細節集中部署文件。** `plan-auto-update-1.3.md:67-78`：兩個對話框各一句條件式提醒即可，不要每次都塞完整 TCC 教學。手動升級說「下載新版覆蓋安裝」，不要求先刪 App／資料。不要在尚未實作時把文件改成「已啟用」。
- **[LOW] 順手更正現有錯誤文件，不保留兩套事實。** `.claude/rules/release.md:29-30,53,56-72,93,96` 仍寫 Apple 公證／必要 secrets、4 小時／舊入口及 `window.confirm`；實際為 `MainApp.vue:77-78` 的 5 秒／15 分鐘。`docs/deployment-guide.md:228,241,297` 的公證等待、應通過公證與 secrets 標題也與本案前提矛盾。這些是文件修正，無須趁此大改 CI 或清理無關依賴。

以上 HIGH 修正應列為啟用前門檻。Rust 修改由 GitHub Actions 的 macOS／Windows 檢查及 release 建置驗證；本報告未執行這些驗證，也未確認正式 Release 資產或 Secrets 狀態。

[U]: https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/updater.rs
[DOC]: https://v2.tauri.app/plugin/updater/
[G]: https://support.apple.com/en-ie/guide/security/sec5599b66df/web
[T]: https://developer.apple.com/documentation/fileprovider/nsfileprovidererror/code/providertranslocated?language=objc
[PATH]: https://github.com/tauri-apps/tauri/blob/tauri-utils-v2.8.2/crates/tauri-utils/src/platform.rs
[DR]: https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
[SELF]: https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html
[GH]: https://docs.github.com/en/rest/releases/releases#get-the-latest-release
[A]: https://github.com/tauri-apps/tauri-action/blob/v0/action.yml
[JSON]: https://github.com/tauri-apps/tauri-action/blob/v0/src/upload-version-json.ts
[CREATE]: https://github.com/tauri-apps/tauri-action/blob/v0/src/create-release.ts
[CFG]: https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/config.rs
[ULIB]: https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/lib.rs
[APP]: https://github.com/tauri-apps/tauri/blob/tauri-v2.10.2/crates/tauri/src/app.rs
[NSIS]: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.10.0/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
[MS]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
[JS]: https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/guest-js/index.ts
[CMD]: https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.0/plugins/updater/src/commands.rs
