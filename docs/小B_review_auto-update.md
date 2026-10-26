# 小B 審查：自動更新實作（`docs/plan-auto-update-1.3.md` v2）

審查日 2026-10-26。只讀 `feat/auto-update` 工作樹，未改程式、未 commit。本機沒有 Rust，沒有跑 `cargo clippy` / `cargo test`；下面 Rust 與 workflow 的結論來自靜態對照（updater 2.10.0、`tauri-action@v0` = 0.6.2 的 `action.yml` / `upload-version-json.ts` / `config.ts`）。

## [HIGH] 手動「開始更新」在第一個 await 之前沒有鎖住交易

`src/MainApp.vue:299-316`

`handleManualUpdate` 通過 `canStartInstall`（狀態仍是 `confirming`）之後，先 `await import()`，再 `await ensureUpdateInstallLocation()`，對話框還開著，`updateState` 到第 315 行才變成 `downloading`。第二次點擊（或第一個 IPC 還沒回來時的再點）仍看得到 `confirming`，會再進一次，對同一個 `pendingUpdate` 呼叫兩次 `downloadInstallAndRelaunch()`。macOS 上 updater 2.10.0 的安裝是先把現有 `.app` 移走；兩次 `install()` 疊在一起，就是這次用安裝位置檢查要避開的「App 被移走」路徑。

自動安裝 `handleAutoInstall`（`src/MainApp.vue:237-241`）在 await 之前就把狀態設成 `installing`，沒有這個洞。

修正：通過 guard 後、任何 `await` 之前同步寫入 `updateState = "downloading"`。位置檢查失敗時先 `discardPendingUpdate()`，再設回 `idle`。呼叫 `downloadInstallAndRelaunch()` 之前再讀一次 `isVoiceFlowBusy(voiceFlowStatus.value)`，忙碌就設回 `confirming` 並留著對話框，不要下載、不要安裝。

```ts
async function handleManualUpdate() {
  if (!canStartInstall(updateState.value, voiceFlowStatus.value)) return;
  updateState.value = "downloading";
  try {
    const { downloadInstallAndRelaunch, discardPendingUpdate } =
      await import("./lib/autoUpdater");
    if (!(await ensureUpdateInstallLocation())) {
      showManualUpdateDialog.value = false;
      availableVersion.value = "";
      await discardPendingUpdate();
      updateState.value = "idle";
      return;
    }
    if (isVoiceFlowBusy(voiceFlowStatus.value)) {
      updateState.value = "confirming";
      return;
    }
    showManualUpdateDialog.value = false;
    await downloadInstallAndRelaunch();
  } catch (err) {
    // 既有的 updateFailed + idle
  }
}
```

## [MED] 自動失敗的「前往下載頁」只存在 2.5 秒，而且這次執行不會再出現

`src/composables/useFeedbackMessage.ts:5`（`FEEDBACK_DISPLAY_DURATION_MS = 2500`）、`src/MainApp.vue:195-197`、`src/MainApp.vue:230-232`、`src/MainApp.vue:473-487`

自動檢查／下載失敗會呼叫 `reportAutoFailureOnce()`，然後 `updateFeedback.show("error", …)`。這個 composable 2.5 秒後把 `message` 清掉，按鈕跟文案一起消失。gate 已經消耗，之後的自動失敗依規格靜默，手動檢查才會再出現。使用者只要沒在 2.5 秒內點到，這次執行就沒有下載頁入口。

修正：自動失敗不要走會自動清掉的 `show()`。加一個不計時的錯誤列（或給 `show` 一個 `persistent` 參數），留到使用者關掉，或留到下一次檢查成功。手動失敗維持現在的 2.5 秒提示。

## [MED] 發版說明仍寫 pubkey 是空的

`docs/deployment-guide.md:297` 寫「本版先留 `""`」。`src-tauri/tauri.conf.json:66` 已經是 minisign 公鑰字串（`untrusted comment: minisign public key` 的 base64，公開值）。`release.yml:149-157` 會在 pubkey 為空時失敗。

修正：改成「`plugins.updater.pubkey` 已填入 `~/.tauri/typek.key.pub` 的全文；是那一段字串，不是路徑，不要再加引號或換行。」

同檔 `src/lib/autoUpdater.ts:17-18` 的註解也寫 pubkey 仍為空，一併改掉，避免之後有人把設定清回去。

## [LOW]

- `src/MainApp.vue:327-332`：手動取消先把 `updateState` 設回 `idle`，再 `await` `close()`。15 分鐘計時若正好在 `close()` 期間到期，自動檢查會在舊 Update 還沒釋放時開始。先 `await discardStagedUpdate()`，成功後再設 `idle`。位置檢查失敗的路徑用上面 HIGH 的順序即可。
- `docs/deployment-guide.md:141`：`updaterJsonPreferNsis` 只決定 Windows 的 `windows-x86_64` 指向 `-setup.exe`。macOS 仍是 `.app.tar.gz`。註解改成「Windows 的 primary key 用 NSIS」。
- `docs/deployment-guide.md:227`：腳本說明仍是舊的 `^[0-9]+\.[0-9]+\.[0-9]+$`。`scripts/release.sh:18-26` 已拒絕前導 0，並且新版號必須大於 `tauri.conf.json`。把這兩條寫進第 4.2 節。
- `docs/deployment-guide.md:266`：檢查清單其餘例子是 `0.9.5`，第 6 點寫死 `1.3.0`。改成同一個版號。
- 七份 README 的「更新」放在 Windows 小節之前，且沒寫「應用程式資料夾」只限 macOS。Windows 不需要這個資料夾。各加半句「僅 macOS」。
- 計畫範圍外、仍與程式不符，這次不必為了它們改範圍：`docs/source-tree-analysis.md`（4 小時、Apple notarize）、`docs/architecture-frontend.md`（`window.confirm`）、`docs/project-overview.md`（notarize）。`.claude/rules/release.md` 與 `.claude/rules/ipc.md` 已與程式一致。

## 已核對、沒有擋編譯或下一版發布的問題

**Rust**（`src-tauri/src/lib.rs:171-274`、測試 `1157-1215`，在 `#[cfg(test)] mod tests` 內）

- `classify_bundle_path` 在所有平台都編譯。順序是 AppTranslocation → `/Volumes/` → 不在 `/Applications` 或 `$HOME/Applications` → 上層目錄寫入探測 → `ok`。非 macOS 的指令直接回 `ok: true`，與 `.claude/rules/ipc.md:23` 一致。
- `.app` 用 `current_exe()` 的祖先裡第一個副檔名 `app`，對應 `Contents/MacOS/<bin>` 再往上到 bundle，與 updater 2.10.0 的安裝目標相同。
- 寫入探測用 `create_new` 後刪除；`/Applications/TypeK.app` 的父目錄是 `/Applications`。Windows 測試不碰真實 `/Applications`：`/Volumes` 與 AppTranslocation 在字串上提前返回；`ok` / `not_writable` 用 temp 目錄。未見預設 clippy（`-D warnings`，不含 pedantic）會擋的寫法。
- `serde(rename_all = "camelCase")` 的 `bundlePath` 與 `src/lib/updateGuard.ts:11-15` 一致。自訂指令沿用現有做法，沒有進 `capabilities/default.json`（既有指令同樣不進）。

**`release.yml`**

- `strategy.max-parallel: 1` 在 `build` 上（`:18-21`）。checkout（`:48`）在 `workflow_dispatch` 用 `inputs.tag`，tag push 時 `inputs.tag` 為空、落到 `github.ref`。這個 workflow 有定義 `workflow_dispatch` inputs，tag push 不會因 `inputs` context 直接無效。
- 「Verify version」（`:68-82`）在 metadata 之後，比對 `package.json`、`tauri.conf.json`、`Cargo.toml`。
- 「Refuse published tag」（`:84-98`）用 `GH_TOKEN` + `gh release view --json isDraft`；不存在就繼續，已公開（`isDraft != true`）就失敗。草稿看得到，因為 `permissions.contents: write`。
- 「Require updater key」（`:149-157`）在「Export optional signing secrets」寫入 `GITHUB_ENV` 之後。空的 `TAURI_SIGNING_PRIVATE_KEY` 或空的 `plugins.updater.pubkey` 會失敗，訊息指向 §5.4。
- `tauri-action@v0`（0.6.2）有 `updaterJsonPreferNsis`、`retryAttempts`；`includeUpdaterJson` 預設 true，沒有誤寫成 `uploadUpdaterJson`。`createUpdaterArtifacts: true` 讓 `unzippedSigs === true`，再加上 prefer NSIS，`windows-x86_64` 會指向 `*-setup.exe`，不是 `.msi`。
- 「Verify latest.json」（`:241-280`）在 `gh release edit --draft=false`（`:282-288`）之前：`jq -e`、version、三個平台的 url/signature、url 含 `/download/$RELEASE_TAG/`、Windows 以 `-setup.exe` 結尾。失敗則 job 停，release 留草稿。`pub_date` 由 action 用 `toISOString()` 寫入，是合法 RFC3339。
- 「Check public latest」（`:290-307`）不帶 token，不符只 warning、`exit 0`。
- `VITE_AUTO_UPDATE_ENABLED: "true"` 只在這個 step（`:171`）。前端 `=== "true"` 對得上。

**`scripts/release.sh:18-26`**

拒絕前導 0（`0.2.0`、`10.0.0` 可以；`01.2.3`、`1.02.3`、`1.2.3-rc.1` 不行）。用整數 tuple 比較，`1.2.10 > 1.2.2`、`1.10.0 > 1.9.9` 成立；等於或較小的版號拒絕。`python3 -c` 的版號在 `sys.argv[1]`、`sys.argv[2]`（`argv[0]` 是 `-c`）。

**前端其餘狀態**

- 自動檢查在 await 之前就設 `checking`（`src/MainApp.vue:184-186`）。非 `idle` 時 `canStartAutoCheck` 直接返回。手動確認維持 `confirming`（`:284`）。
- `src/lib/autoUpdater.ts:25-34,50-61,80-82,103-105,124-126`：換掉、檢查失敗、下載失敗、安裝失敗都會 `close()`。`check({ timeout: 30_000 })`、`download(undefined, { timeout: 300_000 })` 與插件 2.10 的簽章一致（`download(onEvent?, options?)`）。
- 錄音／轉錄：聽 `VOICE_FLOW_STATE_CHANGED`（`:368-372`）。下載完若不是 idle，設 `autoInstallPromptPending`，回到 idle 才跳對話框（`:175-179,219-221`）。兩個對話框的安裝鈕 `:disabled="isInstallBlocked"`，旁邊是 `installBlockedByVoiceFlow`。
- 位置不 ok 或指令丟錯：不下載，開安裝位置對話框（`:127-141,208-212,306-311`）。Windows 的 `install()` 之後仍呼叫 `request_app_restart`，註解寫明安裝器會先結束行程（`src/lib/autoUpdater.ts:91-92,111`）。
- 七個 locale JSON 合法，鍵集合都是 410，`{version}` 都在。`accessibility.updateHint` 與 `mainApp.update.macPermissionHint` 七語都有。zh-TW 與計畫原文一致。七份 README 的側邊欄按鈕名稱與各語 `checkUpdate` 一致（例如「檢查更新」／「Check for Updates」／「更新を確認」）。`signingIdentity` 仍是 `"-"`（`tauri.conf.json:82`）。

結論：NOT READY

## 複審（第 2 輪）

複審日 2026-10-26。對照 `feat/auto-update` @ `ba26947`，只看上一輪點名的修正。本輪重跑 `vitest run`：44 files / 712 tests 通過。測試裡沒有 MainApp 的更新狀態機，這 712 個測不了下面兩件事。未重跑 vue-tsc / eslint。

### 上一輪 HIGH：連點安裝 — 主路徑已補上

`src/MainApp.vue:304-318`、`322-324`。`canStartInstall` 只接受 `confirming` / `ready-to-install`（`src/lib/updateGuard.ts:38-44`）。

`handleManualUpdate` 通過 guard 後、任何 `await` 之前就把 `updateState` 設成 `downloading`。第二下看到 `downloading` 會直接 return，不會對同一個 `pendingUpdate` 再呼叫一次 `downloadInstallAndRelaunch()`。

位置不 ok：先關確認框、清版本、`await discardPendingUpdate()`，再設 `idle`。等待 `close()` 時狀態仍是 `downloading`，15 分鐘自動檢查進不來。

語音在這段等待裡變忙：設回 `confirming` 並 return，確認框留著，不呼叫 `downloadInstallAndRelaunch()`。這條單獨看是對的。

### [MED] 取消跟還在跑的「開始更新」會互相踩狀態

`src/MainApp.vue:307-328` 與 `339-349`。

確認框在 `import()` 與位置檢查結束前一直開著，「取消」點得到。取消會先 `await discardStagedUpdate()`（裡面把 `pendingUpdate` 清成 null 再 `close()`），然後才設 `idle`。`handleManualUpdate` 從 `await` 回來時不看狀態是不是還在 `downloading`，也不看確認框關了沒有。

- 取消先回到 `idle`、語音仍是 idle：接著呼叫 `downloadInstallAndRelaunch()`。更新物件已經丟掉，通常丟出 `No pending update`，catch 顯示 2.5 秒的「更新失敗」。使用者按的是取消。
- 取消先回到 `idle`、語音已忙：`322-324` 再把狀態寫成 `confirming` 然後 return。確認框已經關掉，也沒有 pending update。`isUpdateBusy` 含 `confirming`，側邊欄「檢查更新」停用；`canStartAutoCheck` 只放行 `idle`。沒有路徑回到 `idle`。這次執行的更新 UI 卡住，要重開 App。
- 位置檢查先回來、下載已經開始，取消才 `close()`：下載與 `close()` 疊在一起。`downloadInstallAndRelaunch` 的 `install()` 讀的是模組上的 `pendingUpdate`，被清空後會丟錯並停住。上一輪「連點兩次 `install()`、macOS 把 App 移走」這條沒有回來。

從確認框直接按取消、且沒有另一筆「開始更新」在跑時，LOW 要的順序是對的：先 `await discardStagedUpdate()`，再設 `idle`，自動檢查不會在 `close()` 期間插進來。

修正：每個 `await` 之後若 `updateState !== "downloading"` 就 return，不要下載，也不要改成 `confirming`。只有狀態仍是 `downloading`、確認框還開著，才因為語音忙碌退回 `confirming`。

### [MED] 手動檢查找到更新時，持久失敗列不會清掉

`src/MainApp.vue:185-236`、`271-300`、`486-505`。

自動檢查／下載失敗改走 `showAutoUpdateFailure`，不走會在 2.5 秒後清掉的 `updateFeedback.show`（`useFeedbackMessage.ts` 仍是 2500ms）。列上是 `mainApp.update.updateFailed`、前往下載頁（`openDownloadPage`）、關閉（`dismissFailure`）。七個 locale 都有這個鍵：zh-TW「關閉」、zh-CN「关闭」、en「Dismiss」、ja「閉じる」、ko「닫기」、vi「Đóng」、th「ปิด」。鍵集合都是 411，`mainApp.update.*` 的佔位符一致。手動檢查失敗（`checkFailed` / `checkError`）與手動更新失敗（`updateFailed`）仍走 `updateFeedback`。

自動檢查只要不是 `error` 就在第 203 行清掉該列（已是最新，以及找到更新，都算）。手動檢查只在 `up-to-date`（第 284 行）清掉。`update-available`（第 287–290 行）會打開「發現新版本」，失敗列還留著。可重現：自動失敗列還在時按「檢查更新」且伺服器有新版，畫面上同時是「更新失敗，請手動下載」和「發現新版本」。

修正：手動檢查在非 `error` 時也清掉 `showAutoUpdateFailure`，跟自動檢查同一種判斷。`error` 與 catch 不要清。

### 上一輪另一則 MED、其餘 LOW — 已對上

- `docs/deployment-guide.md:297`：`plugins.updater.pubkey` 已填入 `~/.tauri/typek.key.pub` 的全文；寫明是那段字串，不是路徑，不要再加引號或換行。`src/lib/autoUpdater.ts:17-18` 改成公鑰已填、不要清空。`tauri.conf.json:66` 仍是那段 minisign 公鑰。
- `docs/deployment-guide.md:141`：Windows 的 primary key 用 NSIS `-setup.exe`，並寫明 macOS 仍是 `.app.tar.gz`。與 `release.yml` 的 `updaterJsonPreferNsis: true` 一致。
- `docs/deployment-guide.md:227`：版本號是 `X.Y.Z`、不接受前導 0、必須大於 `tauri.conf.json` 目前的版本。與 `scripts/release.sh:18-26` 一致。
- `docs/deployment-guide.md:266`：檢查清單第 6 點是 `0.9.5`，與同節其餘例子相同。
- 七份 README（`README.md`、`README.en.md`、`README.ja.md`、`README.ko.md`、`README.th.md`、`README.vi.md`、`README.zh-CN.md`）的更新段都在 Windows 小節之前，並寫明要放進應用程式資料夾才能自動更新的是 macOS。

結論：NOT READY

## 複審（第 3 輪）

複審日 2026-10-26。對照 `feat/auto-update` @ `5abd7ba`（工作樹乾淨），只看第 2 輪兩則 [MED]。這次沒有重跑 vitest／vue-tsc／eslint；測試仍不涵蓋 MainApp 的更新狀態機。結論來自 `src/MainApp.vue`、`src/lib/updateGuard.ts`、`src/lib/autoUpdater.ts`，以及 reka-ui 2.8.2 的受控對話框：`DialogRoot` 在父層傳了 `open` 時 `useVModel` 不是 passive，寫入只 `emit('update:open')`。

### [MED] 取消跟還在跑的「開始更新」— 已補上

`src/MainApp.vue:305-336`、`347-356`。`canStartInstall` 仍只接受 `confirming` / `ready-to-install`（`src/lib/updateGuard.ts:38-44`）。

`handleManualUpdate` 在任何 `await` 之前把 `updateState` 設成 `downloading`，第 2 輪補上的連點鎖還在。取消第一行就同步關掉確認框，`discardStagedUpdate()` 結束後才設 `idle`；等 `close()` 時狀態仍是 `downloading`。只看 `updateState !== "downloading"` 會漏掉這段。`isStillThisTransaction` 要狀態仍是 `downloading`、確認框還開著。`import()` 與 `ensureUpdateInstallLocation()` 之後各查一次，不過就 return：不下載、不設 `confirming`、不進 catch，不會跳出 2.5 秒的「更新失敗」。

- 取消先發生、`close()` 還沒結束：確認框已關，兩次檢查都 return。`downloadInstallAndRelaunch()` 不會跟 `discardPendingUpdate()` 疊在一起。取消函式在 `close()` 成功或失敗之後都會設回 `idle`，側邊欄不會停在 `downloading`。
- 取消已回到 `idle`、語音仍忙：檢查失敗就 return，不會把狀態寫回 `confirming`。確認框已關、pending update 已丟時，不會再把「檢查更新」和 15 分鐘自動檢查一起鎖死。
- 語音在等待中變忙、人沒取消：兩次檢查都過，而且位置 ok，才設回 `confirming` 並 return。確認框留著，不呼叫 `downloadInstallAndRelaunch()`。語音回到 idle 之後可以再按「開始更新」。
- 位置不 ok、人沒取消：仍先關確認框、清版本、`await discardPendingUpdate()`、再設 `idle`。等 `close()` 時狀態是 `downloading`，自動檢查進不來。
- 點「開始更新」不會把這筆交易判成已取消。`AlertDialogAction` 底層是 `DialogClose`，點下去會 `onOpenChange(false)`，但 `MainApp.vue:611` 只有 `:open`，沒有 `@update:open`。父層的 ref 不會被清掉。確認框要等位置 ok、語音不忙，才在 `downloadInstallAndRelaunch()` 之前關掉（第 335 行）。下載開始後畫面上沒有取消鈕。

位置檢查在回傳 false 之前就會打開安裝位置對話框（`ensureUpdateInstallLocation`）。人已經取消、結果又是不 ok 時，這次 return 不會再關那個對話框；上一輪也是這樣。這條不會因此去下載，也不會改成 `confirming`。

`get_update_install_location` 是同步的路徑判斷加一次寫入探測（`src-tauri/src/lib.rs:180-226`、`263-274`）。舊的那次 `await` 不會晚到使用者做完下一輪「檢查更新 → 開始更新」才回來，把新的 `downloading` 誤認成舊交易。這次沒有另加交易代號。

### [MED] 手動檢查找到更新時清掉持久失敗列 — 已補上

`src/MainApp.vue:283-300`。`update-available` 在同一段同步程式裡把 `showAutoUpdateFailure` 設成 false（第 288 行），接著寫版本、設 `confirming`、打開確認框。同一輪渲染不會同時留下「更新失敗，請手動下載」和「發現新版本」。

`UpdateCheckResult.status` 只有 `up-to-date` | `update-available` | `error`（`src/lib/autoUpdater.ts:4-8`）。前兩種會清失敗列；`else` 就是 `error`，catch 也不清。這跟自動檢查「不是 `error` 才清」（第 194–203 行）是同一種判斷。`up-to-date` 原本就會清，這次沒改掉。

失敗列只在自動檢查的 `error` / catch 打開，而且那兩條都先把狀態設回 `idle`。`ready-to-install` 的提早 return 碰不到還開著的失敗列。手動檢查失敗與手動更新失敗仍走 `updateFeedback`（2.5 秒）。使用者關掉「發現新版本」之後，這次執行不會把已經消耗掉的自動失敗列再顯示一次；自動檢查找到更新就清掉，也是這條規則。

結論：READY
