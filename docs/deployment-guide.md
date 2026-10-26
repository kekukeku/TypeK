# Deployment Guide

> CI/CD pipeline、自動更新、發版流程（維持不做 Apple 簽章與公證）
> 更新日期：2026-10-26 · 版本：1.3.0

---

## 一、CI/CD 概覽

```
push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────────────────────┐
 │  ci.yml  │         │       release.yml               │
 │  ──────  │         │  ────────────────────────────   │
 │ vue-tsc  │         │  Job: build (matrix · 3)        │
 │ vitest   │         │   ├── macOS aarch64-apple-darwin│
 │ cargo    │         │   │  （Intel Mac 1.3.3 起不打包）  │
 │  check   │         │   └── Windows x64               │
 │ (mac+win)│         │                                 │
 └──────────┘         │  + tauri-action                 │
                      │   - Updater .sig                │
                      │   - latest.json                 │
                      │  + Sentry sourcemap upload      │
                      │     (mac arm64 only)            │
                      │  + 上傳穩定檔名（gh release）   │
                      │                                 │
                      │  Job: publish-release           │
                      │   Verify latest.json            │
                      │   gh release edit --draft=false │
                      │   Check public latest.json      │
                      └─────────────────────────────────┘
```

---

## 二、ci.yml（每次 push / PR）

### 2.1 Frontend job (`check`, ubuntu-latest)
```
1. checkout
2. setup-node (從 .nvmrc → 24)
3. pnpm setup
4. pnpm install --frozen-lockfile
5. npx vue-tsc --noEmit       ← 型別檢查
6. pnpm exec eslint src       ← ESLint
7. pnpm test                  ← Vitest unit + component
```

### 2.2 Rust job (`rust-check`, matrix)
```
matrix:
  - macos-latest
  - windows-latest

steps:
  1. checkout
  2. dtolnay/rust-toolchain@stable
  3. swatinem/rust-cache@v2 (workspaces: src-tauri)
  4. cargo clippy --workspace --all-targets -- -D warnings (working-directory: src-tauri)
  5. cargo test --workspace (working-directory: src-tauri)
```

### 2.3 CI 現況

`ci.yml` 已跑 vue-tsc、ESLint、Vitest、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test`（macOS + Windows）；Intel Mac 自 1.3.3 起不支援，不另驗 x86_64。Playwright E2E 仍只在本機跑，未整合 CI。

---

## 三、release.yml（tag push v*）

### 3.1 觸發

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag: { description: 'Tag to build (e.g. v0.2.0)', required: true }
```

### 3.2 Build matrix（3 個平台）

| Platform        | Args                              | Stable Name                  | Sourcemaps |
| --------------- | --------------------------------- | ---------------------------- | ---------- |
| macos-latest    | `--target aarch64-apple-darwin`   | `TypeK-mac-arm64.dmg`        | **true**（唯一上傳） |
| windows-latest  | （空）                             | `TypeK-windows-x64.exe`      | false      |

### 3.3 Release metadata 解析

```bash
# 從 tag 或 workflow_dispatch input 取
RAW_TAG="${tag#refs/tags/}"
RELEASE_VERSION="${RAW_TAG#v}"

# 推到 GITHUB_ENV：
RELEASE_TAG=v0.9.5
RELEASE_VERSION=0.9.5
SENTRY_RELEASE=typek@0.9.5
VITE_SENTRY_RELEASE=typek@0.9.5
```

### 3.4 主要 step：`tauri-apps/tauri-action@v0`

注入下列 env：

```
# 必要：Updater 簽章（minisign）
TAURI_SIGNING_PRIVATE_KEY              ← Updater 簽署私鑰（secret 內容為檔案全文）
TAURI_SIGNING_PRIVATE_KEY_PASSWORD     ← 私鑰密碼

# Apple 簽章／公證：維持不做，以下 secrets 保持空白（空白時不注入）
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID

# Sentry（選配）
SENTRY_DSN, VITE_SENTRY_DSN
SENTRY_ENVIRONMENT=production
VITE_SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=typek@<version>
VITE_SENTRY_RELEASE=typek@<version>
VITE_SENTRY_SOURCEMAPS_ENABLED=<matrix.upload_sourcemaps>
```

with：

```yaml
tagName: ${{ env.RELEASE_TAG }}
releaseName: "TypeK v${{ env.RELEASE_VERSION }}"
releaseBody: "See the assets to download and install this version."
releaseDraft: true              ← 先建 Draft，驗證 latest.json 後才 publish
prerelease: false
updaterJsonPreferNsis: true     ← Windows 的 primary key 用 NSIS -setup.exe（macOS 仍是 .app.tar.gz）
retryAttempts: 3
args: ${{ matrix.args }}
```

`strategy.max-parallel: 1`：三個 matrix job 序列化，避免同時讀寫同一個 `latest.json`。
`VITE_AUTO_UPDATE_ENABLED: "true"` 只在 release 建置注入；本機開發預設關閉。

### 3.5 Sourcemap upload（mac arm64 only）

```bash
npx @sentry/cli releases new "$SENTRY_RELEASE" || true
npx @sentry/cli sourcemaps upload dist/assets \
  --release "$SENTRY_RELEASE" \
  --url-prefix "~/assets" \
  --validate \
  --wait
npx @sentry/cli releases finalize "$SENTRY_RELEASE" || true
```

> 為什麼只在 mac arm64 跑？避免重複上傳同份 sourcemap（兩個 mac build 與 Windows build 共用同一份前端 bundle）。

### 3.6 上傳穩定檔名

GitHub Release 的 default asset 命名為 `TypeK_0.9.5_aarch64.dmg` 等版本號內嵌格式 — 這對「永遠最新版」連結（`releases/latest/download/...`）不友善。

額外步驟把 dmg / exe 重新命名後上傳：

```bash
# macOS
DMG=$(find src-tauri/target -path "*/bundle/dmg/*.dmg" | head -1)
cp "$DMG" "${{ matrix.stable_name }}"
gh release upload "$RELEASE_TAG" "${{ matrix.stable_name }}" --clobber

# Windows (PowerShell)
$exe = Get-ChildItem ... -Filter "*-setup.exe" | Select -First 1
Copy-Item $exe.FullName "${{ matrix.stable_name }}"
gh release upload "$env:RELEASE_TAG" "${{ matrix.stable_name }}" --clobber
```

### 3.7 Job 2：`publish-release`

公開前先下載 draft 的 `latest.json` 驗證，失敗就維持 draft：

```bash
gh release download "$RELEASE_TAG" -p latest.json --clobber
# version 等於 tag 去掉 v
# darwin-aarch64 / darwin-x86_64 / windows-x86_64 都有非空 url、signature
# 每個 url 都含 /download/$RELEASE_TAG/
# windows-x86_64.url 以 -setup.exe 結尾
```

驗證通過才公開：

```bash
gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false
```

公開後再以匿名 `curl` 讀 `https://github.com/kekukeku/TypeK/releases/latest/download/latest.json`，版本不符只印 warning（此時已無法撤回）。

> 等 build job 全跑完再 publish — 確保不會出現「半完成」release；已公開的 tag 會被 `Refuse published tag` 拒絕重建，修復一律發更高版號。

---

## 四、發版流程（人工 + 自動）

### 4.1 前置作業

```
1. 確認 main 上的所有 PR 都已合併
2. 更新 CHANGELOG.md：
   ## [0.9.5] - 2026-05-01
   ### Added
   ### Fixed
   ### Changed
3. git add CHANGELOG.md && git commit -m "docs: changelog v0.9.5"
4. git push
```

### 4.2 執行 release 腳本

```bash
./scripts/release.sh 0.9.5
```

腳本會：
1. 驗證版本號是 `X.Y.Z`（不接受前導 0，例如 `01.2.3`），且必須大於 `tauri.conf.json` 目前的版本
2. 確認 CHANGELOG.md 包含 `## [0.9.5]` 區塊
3. 確認 working tree 乾淨
4. 確認 tag `v0.9.5` 不存在
5. 確認在 git branch 上（非 detached HEAD）
6. **同步更新四個檔案**的版本號：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`（搜 `name = "sayit"\nversion = "..."`）
7. `git commit -m "chore: bump version to 0.9.5"`
8. `git tag v0.9.5`
9. `git push origin <branch>` + `git push origin v0.9.5`（**分開 push**，避免 GitHub Actions tag 事件遺失）

### 4.3 自動建構（GitHub Actions）

tag push 後自動觸發 `release.yml`：
- `Refuse published tag`／`Verify version` 先擋錯版本與已公開 tag
- 三個 build job 序列化跑（mac arm64 / mac x64 / windows）
- 完成後 `publish-release` 驗證 `latest.json`，再將 Draft Release 改為 Published

時間：~ 15-25 分鐘（不含 Apple notarize；已不做簽章與公證）

### 4.4 驗證 Release

```
1. GitHub Releases 頁面確認 v0.9.5 已 Published
2. 檢查附件：
   - TypeK-mac-arm64.dmg（穩定檔名）
   - TypeK-windows-x64.exe
   - 自動命名版（TypeK_0.9.5_*.dmg / .exe）
   - latest.json（updater）
   - 對應的 .sig 檔（updater 簽名）
3. 確認 `latest.json` 的 version 與 tag 一致，且三個平台都有 url／signature
4. 下載 .dmg → 開啟；第一次仍需「強制打開」（不做 Apple 簽章與公證）
5. 檢查 Sentry：
   - Releases 頁面看到 typek@0.9.5
   - Sourcemaps 已上傳（前端 stack trace 應該有原始檔名）
6. 啟動 app → 設定頁面確認版本號顯示 0.9.5
```

---

## 五、Apple Code Signing & Notarization（維持不做）

### 5.1 現況

> **TypeK 不做 Apple Developer ID 簽章與公證**（沒有付費 Apple Developer Program 帳號），`APPLE_*` secrets 保持空白。使用者第一次打開仍需到「系統設定 → 隱私權與安全性」按「強制打開」。
>
> **1.3.2 起，macOS 正式版用自簽憑證「TypeK Code Signing」簽章**（`release.yml` 的 Import／Verify 兩步）：designated requirement 是 `identifier "com.kekukeku.typek" and certificate leaf = H"4524a36ee9abdfb6d9e150137ee105956e7cfede"`，綁憑證不綁每版 cdhash，所以更新後輔助使用（macOS 27 叫 Device Control and Data Access）與麥克風權限會保留（2026-10-26 Kevin 本機以 1.3.0→1.3.1 實驗證實）。
>
> - Secrets：`TYPEK_CODESIGN_P12`（p12 的 base64，單行）、`TYPEK_CODESIGN_P12_PASSWORD`。不要放進 `APPLE_CERTIFICATE`（tauri-cli 2.10.0 內的 tauri-macos-sign 2.3.3 只認 Apple 前綴憑證）
> - 憑證效期 10 年（到 2036-10）。p12 與密碼另存密碼管理器；**遺失或換憑證＝所有使用者要再「− 再 +」一次**，且要同步改 `release.yml` 的 `EXPECTED_LEAF`
> - 本機 `pnpm tauri build` 仍是 ad-hoc（`tauri.conf.json` 的 `signingIdentity "-"`），權限不與正式版共用
> - 從 ad-hoc 版（1.3.1 以前）更新到第一個自簽版時，使用者仍要「− 再 +」一次；之後的更新不用

### 5.2 簽署流程

1.3.2 起 `release.yml` 的 macOS job 會匯入自簽憑證「TypeK Code Signing」到臨時鑰匙圈，以 `APPLE_SIGNING_IDENTITY` 覆寫 `signingIdentity "-"` 讓 tauri-bundler `codesign`，打包後驗證 designated requirement 的 certificate leaf；不做 Developer ID、不公證。DMG 容器也會被同一張自簽憑證簽上，使用者打開時仍會看到「無法驗證開發者」，`.app` 第一次仍要「強制打開」。

### 5.3 必要 entitlements（`src-tauri/Entitlements.plist`）

要的權限（節錄）：
- `com.apple.security.cs.disable-library-validation`（cpal 動態載入 audio framework）
- `com.apple.security.device.audio-input`（麥克風）
- `com.apple.security.cs.allow-jit`（WebView）
- `com.apple.security.cs.allow-unsigned-executable-memory`（WebView）

### 5.4 自動更新簽名（1.3.0 起已啟用）

`tauri-plugin-updater` 用免費的 minisign 簽章，與 Apple 簽章無關。目前設定：

- `plugins.updater.endpoints`：`["https://github.com/kekukeku/TypeK/releases/latest/download/latest.json"]`
- `bundle.createUpdaterArtifacts`：`true`
- `plugins.updater.pubkey`：已填入 `~/.tauri/typek.key.pub` 的全文（是那一段字串，不是路徑；不要再加引號或換行）
- 前端自動更新開關：release.yml 注入 `VITE_AUTO_UPDATE_ENABLED: "true"`

金鑰產生（一次性，由 Kevin 執行；密碼不要寫進 repo）：

```bash
node_modules/.bin/tauri signer generate -w ~/.tauri/typek.key
```

GitHub Secrets（用 `gh secret set` 灌檔案內容，避免網頁貼上改掉換行）：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/typek.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

發版條件：

- `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 必須存在；`release.yml` 在打包前會檢查私鑰與 `pubkey` 非空，缺一就失敗
- `publish-release` 驗證 `latest.json` 通過才公開；已公開的 tag 不重建
- 私鑰或密碼遺失＝已安裝版本無法驗證新版，只能請使用者手動重裝一次（沒有輪替流程；舊私鑰還在時也不保證跳版使用者能無縫換 key）
- Apple Developer ID 簽章與公證維持不做、`APPLE_*` 維持空白；`tauri.conf.json` 的 `signingIdentity` 維持 `"-"`（本機用），CI 以 `APPLE_SIGNING_IDENTITY=TypeK Code Signing` 覆寫（見 §5.1）

已知殘餘風險（updater 2.10.0）：

- macOS 更新失敗時（例如跨卷 `EXDEV`、授權取消）外掛可能把舊 App 移走後沒有還原，導致 App 消失。本版以「只允許 `/Applications`、`~/Applications` 且可寫、非 AppTranslocation」降低觸發機率，並未升級外掛（升級需改 `Cargo.lock`／`pnpm-lock.yaml`，列後續工作）。
- 手動復原：重新下載 DMG 覆蓋安裝即可；設定與字典保留。
- 更新後只能發更高版號修正，不會自動降版。

---

## 六、GitHub Secrets

必要（4 個）：

| Secret                                  | 用途                                            |
| --------------------------------------- | ----------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`             | Updater 簽署私鑰（minisign 私鑰檔全文）          |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`    | 私鑰密碼                                        |
| `TYPEK_CODESIGN_P12`                    | macOS 自簽「TypeK Code Signing」憑證 p12（base64 單行） |
| `TYPEK_CODESIGN_P12_PASSWORD`           | p12 密碼                                        |

選配（Sentry；沒有也能發版）：

| Secret                                  | 用途                                            |
| --------------------------------------- | ----------------------------------------------- |
| `SENTRY_DSN`                            | Rust 正式版 Sentry DSN                          |
| `VITE_SENTRY_DSN`                       | Frontend 正式版 Sentry DSN                      |
| `SENTRY_AUTH_TOKEN`                     | Sentry sourcemap upload token                   |
| `SENTRY_ORG`                            | Sentry organization slug                        |
| `SENTRY_PROJECT`                        | Sentry project slug                             |

Apple（`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`）：**不需要**，維持空白。

> dev / staging 環境用本機 `.env`（不入版本）；secrets 只在 release.yml 注入。

---

## 七、Sentry Release 規則（硬規則）

1. **Release 名稱固定**：`typek@<version>`（前端 + 後端必須相同）
2. **正式版 Sentry release 一律由 release.yml 產生**，前端與 Rust **不可** 各自手動指定不同名稱
3. **Sourcemap upload 只能走 release.yml 的 mac arm64 job**，不可繞過 workflow 手動上傳
4. **dev / staging 不上報**：Rust 端 `is_sentry_enabled()` 檢查 `production`；前端 `initSentryFor*()` 檢查 DSN

---

## 八、固定下載 URL（官網連結）

```
macOS ARM:
  https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg

Windows:
  https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe

Updater latest.json:
  https://github.com/kekukeku/TypeK/releases/latest/download/latest.json
```

---

## 九、回滾 / 撤回 release

```bash
# 1. 標記為 prerelease（不在 latest 連結）
gh release edit v0.9.5 --prerelease

# 2. 完全刪除（極端情況，會破壞 updater）
gh release delete v0.9.5
git push --delete origin v0.9.5
```

> ⚠️ 不要直接刪除 release — `tauri-plugin-updater` 已下載這個版本的使用者下次檢查更新會 404，而非降級。優先做法是發 v0.9.6 修復後通知使用者更新。

---

## 十、發版前的硬性檢查

```
□ git tag v<version> 不存在
□ package.json / tauri.conf.json / Cargo.toml / Cargo.lock 版本號一致
□ CHANGELOG.md 有 [<version>] 區塊
□ working tree 乾淨
□ CI 全綠（main 分支）
□ GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 已設
□ `plugins.updater.pubkey` 非空，且與簽章私鑰配對
□ ./scripts/release.sh 執行成功（版號合法且大於目前版本）
□ release.yml 三個 build job 全跑完
□ publish-release 已驗證 latest.json 才公開（Draft → Published）
□ 公開後匿名 latest.json 版本正確
□ 下載 .dmg / .exe 實機測試
□ Sentry sourcemap 已上傳（mac arm64）
```
