# 計畫：1.3.0 App 內自動更新（不做 Apple 簽章）

> **狀態：定稿 v2（2026-10-26），交小D 實作，小B 檢查。**
> 審查：小C `docs/小C_review_plan-auto-update-1.3.md`、小B `docs/小B_review_plan-auto-update-1.3.md`。
> 驗證限制：本機沒有 Rust；Rust 只在 GitHub Actions 驗。Kevin 不做本機測試。

## 需求（Kevin，2026-10-26）

> 以後，我這個 App 一旦有什麼更新的時候，安裝我這個 App 的用戶要怎麼可以在自己的 App 就能夠進行更新，而不用刪除再重裝？
> 我不會打算申請付費的 Apple 開發者帳號，以此為出發點設計。

## 前提

- 永遠不做 Apple Developer ID 簽章與公證；macOS 維持 ad-hoc（`signingIdentity: "-"`），`APPLE_*` secrets 維持空白
- 更新簽章用 Tauri minisign 金鑰（免費）
- 1.2.2 以前沒有更新功能：使用者要手動裝一次 1.3.0；1.3.0 起 App 內更新
- 端到端更新要等 1.3.1 才能實測（Kevin 不做本機測試，不另做測試頻道）

## v1 → v2 取捨

| 議題 | 小C | 小B | 採用 |
|---|---|---|---|
| macOS 更新失敗可能刪掉 App（updater 2.10.0） | 記錄限制、提供手動復原 | 升到 2.13.2 | **不升版**：升版要改 `Cargo.lock`／`pnpm-lock.yaml`（hook 保護、本機無 Rust）。改以「安裝位置檢查」只允許 `/Applications`、`~/Applications` 且可寫、非 Translocation，讓 `rename` 落在同一卷，避開已知觸發（跨卷 `EXDEV`）；殘餘風險與手動復原寫進文件。升版列為後續工作 |
| 三平台 `latest.json` 互踩 | 序列化發布 | 同 | build matrix 設 `max-parallel: 1`，`retryAttempts: 3` |
| `latest.json` 驗證時機 | 公開前 | 公開前 | `publish-release` 在 `--draft=false` **之前**驗證，失敗就留草稿 |
| 自簽憑證減少 TCC 重置 | 不納入 | 可試、未確認 | **不納入 1.3.0**（另需 p12 管理）；之後另案評估 |
| 端到端測試 | 發版前兩包測 | 等 1.3.1 | **等 1.3.1**（Kevin 不做本機測試） |
| `installMode`、`includeUpdaterJson` | 預設即可 | 預設即可 | **不寫**；只加 `updaterJsonPreferNsis: true` |
| 新的 MainApp 元件測試 | 補交錯情境 | 不必為文案 mount | 只為交錯／阻擋邏輯補測試，抽成可單測的模組 |

## 範圍

### 1. 金鑰（一次性，Kevin 做）

1. Kevin 在終端機執行（密碼只有 Kevin 知道）：

```bash
cd "/Users/kevinkuo/Library/Mobile Documents/com~apple~CloudDocs/Documents/Github project/TypeK" && node_modules/.bin/tauri signer generate -w ~/.tauri/typek.key
```

2. GitHub → Settings → Secrets and variables → Actions：`TAURI_SIGNING_PRIVATE_KEY`＝`~/.tauri/typek.key` 檔案內容（整份原樣貼上，不要多空行）、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`＝密碼
3. 私鑰檔與密碼另存密碼管理器
4. Claude 只讀 `~/.tauri/typek.key.pub` 填進 `tauri.conf.json`

### 2. 設定（小D）

- `src-tauri/tauri.conf.json`：
  - `plugins.updater.endpoints`：`["https://github.com/kekukeku/TypeK/releases/latest/download/latest.json"]`
  - `plugins.updater.pubkey`：維持 `""`（Kevin 產生金鑰後由 Claude 填）
  - `bundle.createUpdaterArtifacts`：`true`
- `.github/workflows/release.yml`：
  1. `build` 的 `strategy` 加 `max-parallel: 1`
  2. checkout 指定 ref：`ref: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref }}`
  3. 「Resolve release metadata」後加「Verify version」：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 的版本都等於 `RELEASE_VERSION`，否則 `exit 1`
  4. 加「Refuse published tag」：`gh release view "$RELEASE_TAG" --json isDraft`，若 release 存在且 `isDraft == false` 就 `exit 1`（已公開版本不重建）
  5. 「Export optional signing secrets」**之後**加「Require updater key」：`TAURI_SIGNING_PRIVATE_KEY` 為空、或 `tauri.conf.json` 的 `plugins.updater.pubkey` 為空 → `exit 1`，訊息指向 `docs/deployment-guide.md` §5.4
  6. 「Build and release」env 加 `VITE_AUTO_UPDATE_ENABLED: "true"`；`with` 加 `updaterJsonPreferNsis: true`、`retryAttempts: 3`
  7. `publish-release` 在 `gh release edit --draft=false` 之前加「Verify latest.json」：`gh release download "$RELEASE_TAG" -p latest.json`，用 `jq` 檢查：
     - `version` 等於 tag 去掉 `v`
     - `platforms` 有 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`，每個 `url`、`signature` 非空
     - 每個 `url` 含 `/download/$RELEASE_TAG/`
     - `windows-x86_64.url` 以 `-setup.exe` 結尾
     - 任何一項不符 → `exit 1`（release 留草稿）
  8. 公開後加「Check public latest」：未帶 token 的 `curl -fsSL https://github.com/kekukeku/TypeK/releases/latest/download/latest.json`，`version` 要等於本版；不符只印警告（已無法撤回）
- `scripts/release.sh`：拒絕不合法 SemVer（`^[0-9]+\.[0-9]+\.[0-9]+$`，不接受前導 0）與不大於目前版本的版號

### 3. App 端（小D）

新增 `src/lib/updateGuard.ts`（純函式、可單測）與 Rust 指令，`MainApp.vue` 改用：

1. **安裝位置檢查**（macOS）：新 Rust 指令 `get_update_install_location() -> UpdateInstallLocation { ok: bool, reason: "ok" | "translocated" | "read_only_volume" | "unsupported_location" | "not_writable", bundlePath: String }`
   - 由 `std::env::current_exe()` 往上兩層取 `.app`
   - 路徑含 `/AppTranslocation/` → `translocated`；在 `/Volumes/` 下 → `read_only_volume`；不在 `/Applications/` 或 `$HOME/Applications/` → `unsupported_location`；`.app` 的上層目錄不可寫（用 `std::fs::metadata` 加嘗試建立再刪除一個暫存檔判斷）→ `not_writable`
   - 非 macOS 一律 `ok: true`
   - 自動與手動流程在**下載前**呼叫；不 ok 時不下載不安裝，顯示對話框：「TypeK 目前不在『應用程式』資料夾，無法自動更新。請結束 TypeK，把 TypeK 拖到『應用程式』資料夾，再從那裡打開。」＋「前往下載頁」按鈕（`https://github.com/kekukeku/TypeK/releases/latest`）
   - `ipc.md` 契約表新增這一列
2. **單一交易**：`updateState` 加 `"confirming"`；自動檢查 await 期間就設 `"checking"`；手動確認框開著時維持 `"confirming"`；任何非 `idle` 狀態下，timer 觸發的自動檢查直接跳過
3. **Update 物件**：`autoUpdater.ts` 換掉或放棄舊 `pendingUpdate` 時呼叫 `close()`；失敗路徑清空並 `close()`
4. **逾時**：`check({ timeout: 30_000 })`；`download(undefined, { timeout: 300_000 })`
5. **錄音／轉錄中不安裝**：MainApp 監聽 `VOICE_FLOW_STATE_CHANGED`（經 `useTauriEvents.ts`），最新狀態不是 idle 時：
   - 自動流程下載完成後不跳安裝對話框，等狀態回 idle 再跳
   - 「安裝並重啟」「開始更新」按鈕 disabled，旁邊小字「錄音或轉錄中，完成後即可安裝」
6. **失敗顯示**：自動檢查或下載失敗，每次 App 執行只顯示一次 `updateFeedback`（error），之後靜默；手動失敗照舊顯示。「更新失敗，請手動下載」旁加「前往下載頁」按鈕
7. **權限提醒**（只在 macOS 顯示，七語系，共用一個 key `mainApp.update.macPermissionHint`）：「如果更新後快捷鍵沒反應，請到 系統設定 → 隱私權與安全性 → 輔助使用，把 TypeK 移除後重新加入並打開。」加在「更新已就緒」與「發現新版本」兩個對話框說明下方
8. `AccessibilityGuide.vue` 加一句（七語系）：「剛更新 TypeK 的話，需要重新授權；這是 TypeK 沒有 Apple 簽章的限制。」
9. Windows：`install()` 會由安裝器結束 App 並重開，`request_app_restart` 不會執行，維持現有程式碼、註解寫明；第 5 點已確保不在錄音中（系統靜音中）安裝

### 4. 文件（小D）

- `docs/deployment-guide.md` §5.4 改「已啟用（1.3.0 起）」：金鑰產生與 secrets、私鑰遺失＝已安裝版本無法驗證新版＝手動重裝一次（不寫輪替流程）、Apple 簽章維持不做與 `APPLE_*` 維持空白、updater 2.10.0 macOS 失敗可能移除 App 的殘餘風險與手動復原（重新下載 DMG 安裝，設定與字典保留）、只能發更高版號修正，不會降版
- `docs/deployment-guide.md` 其餘提到公證等待、13 個 secrets 為必要的地方改成符合「不簽章」：必要 secrets 是 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；Sentry 選配；Apple 不用
- `.claude/rules/release.md`：刪 `window.confirm` 已知限制；檢查時機改「啟動 5 秒後、每 15 分鐘」、位置 `MainApp.vue`；「自動更新」改已啟用；加「release 資產必須有通過驗證的 `latest.json`」；Pipeline 圖拿掉 Apple Signing／Notarization
- README 七語系各加短短一節「更新」：1.3.0 起在 App 內更新（側邊欄「檢查更新」或自動通知）；1.2.2 以前請下載新版覆蓋安裝一次（不用先刪 App）；更新後快捷鍵沒反應的處理；App 要放在「應用程式」資料夾才能自動更新
- `README.md` 等七份的「發版」段：自動更新已啟用

### 5. 測試（小D）

- `tests/unit/update-guard.test.ts`：位置判斷（translocated／`/Volumes`／不支援位置／OK）、「非 idle 不安裝」、「自動檢查在非 idle 跳過」、「每次執行只顯示一次自動失敗」
- `tests/unit/auto-updater.test.ts` 補：替換 `pendingUpdate` 時舊的被 `close()`、失敗時 `close()`、`check`／`download` 帶 timeout
- `tests/component/AccessibilityGuide.test.ts` 補新句子
- Rust：`get_update_install_location` 的路徑分類拆成純函式 `classify_bundle_path(path, home) -> reason` 做單元測試（Windows 也要能編）

## 不做

- Apple 簽章、公證、自簽憑證
- 升級 updater 外掛版本（改 lock 檔；另案）
- 自架更新伺服器、beta 頻道、強制更新、靜默安裝、自動降版
- 發版前的兩包端到端測試

## 驗收

1. `npx vue-tsc --noEmit`、eslint、`npx vitest run` 全綠；七語系 JSON 合法
2. 功能分支 `feat/auto-update` CI 全綠（macOS、Intel clippy、Windows）
3. Kevin 產生金鑰、設好 secrets，Claude 填 pubkey
4. 1.3.0 發版：`publish-release` 的 `latest.json` 驗證通過才公開；公開後匿名可下載 `latest.json` 且版本是 1.3.0
5. **未驗證、等 1.3.1**：macOS ARM／Intel、Windows 的 App 內實際更新、重啟後只有一個行程且版本正確、`xattr` 沒有 quarantine、輔助使用是否需重給
