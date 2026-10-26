# 自簽 CI 審查

範圍：未提交的 `.github/workflows/release.yml`（Export 上方註解、Import／Verify／Remove temporary keychain）、`docs/deployment-guide.md` §5.1、`.claude/rules/release.md` 的 secrets 行。對照 `docs/小B_advice_keep-permissions.md` §3.3，以及 `@tauri-apps/cli` 2.10.0 → `tauri-bundler` 2.8.0 → `tauri-macos-sign` 2.3.3 的簽章路徑。

本機（macOS 27）用另一張自簽證（CN `TypeK Review Signing`，LibreSSL legacy p12：MAC SHA1、憑證 `pbeWithSHA1And40BitRC2-CBC`、私鑰 `pbeWithSHA1And3-KeyTripleDES-CBC`）照 workflow 順序匯入臨時鑰匙圈：未加 `add-trusted-cert`、`find-identity` 不加 `-v`（顯示 `CSSMERR_TP_NOT_TRUSTED`，仍列得出身分）。`codesign --force -s "TypeK Review Signing" --entitlements Entitlements.plist`（不帶 `--keychain`，與 `Keychain::sign` 在 `path = None` 時相同）簽 DMG，exit 0，`codesign --verify --verbose=2` 通過。沒有 `errSecInternalComponent`。測試完已刪臨時鑰匙圈與測試私鑰；login 搜尋清單只剩 `login.keychain-db`。正式憑證只讀公開欄位：CN `TypeK Code Signing`、EKU Code Signing、SHA-1 `4524A36EE9ABDFB6D9E150137EE105956E7CFEDE`、notAfter 2036-10-23。

沒有 [HIGH]、沒有 [MED]。

## 會不會簽上「TypeK Code Signing」

會。Export（`release.yml:122`）在六個 `APPLE_*` 為空時不寫 `APPLE_CERTIFICATE`，所以 `sign::keychain` 走 `with_signing_identity`，`codesign` 不帶 `--keychain`，只搜尋 user search list。Import 把臨時鑰匙圈放在清單最前（`:193`），並先做 `set-key-partition-list`（`:190`）。`APPLE_SIGNING_IDENTITY=TypeK Code Signing` 在 `:199` 寫進 `GITHUB_ENV`，下一個 `tauri-action` 步驟才看得到；CLI 會蓋掉 `tauri.conf.json` 的 `signingIdentity "-"`。身分有空格，這行不加引號才是對的。`security import` 不帶 `-t agg` 仍會匯入憑證與私鑰（本機測過）。p12 是 LibreSSL 3.3.6 的 legacy 格式，正是 `security import` 吃的格式；OpenSSL 3 的 PBES2/AES 才是會失敗的那種，這份 secret 不是。

`.app` 會帶 `--options runtime` 與 entitlements（`is_an_executable && hardened_runtime`，預設 true）。DMG 不帶 runtime，但仍會帶 entitlements；`identity != "-"` 時 bundler 會簽 DMG。本機用同一組參數簽過，不會讓 macOS job 失敗。DMG 簽的是容器，不改裡面已簽好的 `.app`。Runner 是 macos-26、這次實驗是 macOS 27；若 CI log 出現 `errSecInternalComponent`，再依 §3.3 只對臨時鑰匙圈加 `add-trusted-cert`。現在不要先加。

## Verify 找不找得到、簽錯會不會失敗

找得到，簽錯會失敗。兩個 macOS job 都是 `src-tauri/target/<rust_target>/release/bundle/macos/TypeK.app`（自 `src-tauri/target` 算深度 5，`maxdepth 6` 涵蓋 arm64 與 x86_64）。`codesign --verify` 不執行 Mach-O，x86_64 app 在 arm runner 上可以驗。ad-hoc 的 designated requirement 是 cdhash，對不上 `:238` 的 identifier + 小寫葉雜湊，job 會失敗。本機 `codesign -d -r -` 印的是小寫 hex，與 `EXPECTED_LEAF` 一致。

[LOW] `.github/workflows/release.yml:233` `find | head -1` 不保證順序。現在每個 job 只建一個 triple，而且 `swatinem/rust-cache` v2.9.3 在存 cache 前只留 `build`、`.fingerprint`、`deps`，`bundle/` 不會被還原，所以今天不會驗錯另一顆 app。`/bin/bash` 3.2 的 `pipefail` 加 `head` 也不會因為 SIGPIPE 失敗。仍應釘死路徑：

```bash
APP="src-tauri/target/${{ matrix.rust_target }}/release/bundle/macos/TypeK.app"
if [ ! -d "$APP" ]; then
  echo "::error::TypeK.app not found at $APP"
  exit 1
fi
```

## Windows 與 updater

新步驟都是 `runner.os == 'macOS'`。Windows 不會設 `APPLE_SIGNING_IDENTITY`，`patch_binary` 只在 linux/windows 編譯進去。NSIS／minisign 路徑沒動。

`.app.tar.gz` 包的是已簽名的 app。`macos::app::bundle_project` 在回傳前就 `sign`（公證憑證不足則 log `skipping app notarization` 後繼續）。`bundle_project` 跑完各 package type（含 DMG 的容器簽章）之後才呼叫 `updater_bundle`，tar 的是 bundles 裡的 `.app`，不是 DMG。`createUpdaterArtifacts` 仍是 true。macOS 的 binary 還原寫回的是 Cargo 產出的那份，不是 `.app` 裡那份。

## APPLE_* guard

以「六個 secret 為空、Export 在 Import 之前」來說，guard 是對的。空值在 `:140` 被跳過，不會誤失敗。`APPLE_CERTIFICATE` 會讓 bundler 改走 `with_certificate`（只認 Apple CN 前綴）；`APPLE_ID` 配上密碼且沒有 team 會是 `MissingTeamId` 直接失敗建置。這兩個都已匯出，Import 看得到。

[LOW] `.github/workflows/release.yml:176` 的 `APPLE_API_KEY` 從未被 Export（`:135-137` 只有那六個）寫進環境，這個條件現在是死的。不要把 `APPLE_API_KEY` 寫進 `GITHUB_ENV`。要讓檢查成真，只在 Import 的 `env:` 讀 secret，並把已匯出的另外四個名字一并擋下：

```bash
if [ -n "${APPLE_CERTIFICATE:-}" ] || [ -n "${APPLE_CERTIFICATE_PASSWORD:-}" ] \
  || [ -n "${APPLE_SIGNING_IDENTITY:-}" ] || [ -n "${APPLE_ID:-}" ] \
  || [ -n "${APPLE_PASSWORD:-}" ] || [ -n "${APPLE_TEAM_ID:-}" ] \
  || [ -n "${OPT_APPLE_API_KEY:-}" ]; then
  echo "::error::APPLE_* signing/notarization secrets must stay empty (self-signed certificate cannot be notarized)."
  exit 1
fi
```

`APPLE_SIGNING_IDENTITY` 就算被 Export 設過，`:199` 也會覆寫成 `TypeK Code Signing`。

## 其餘

[LOW] `.github/workflows/release.yml:198` 在 import 全部成功後才寫 `TYPEK_SIGNING_KEYCHAIN`。`:186` 已建立鑰匙圈、後面命令失敗時，`:247` 的 `always()` 清不到。Runner 是一次性的。改法：`create-keychain` 成功後立刻 `echo "TYPEK_SIGNING_KEYCHAIN=$KEYCHAIN" >> "$GITHUB_ENV"`。

[LOW] `.github/workflows/release.yml:163`、`docs/deployment-guide.md:279` 寫「tauri-bundler 2.10」。實際是 CLI 2.10.0 的 bundler 2.8.0／`tauri-macos-sign` 2.3.3。只認 Apple 前綴這點相同。把版本改成上面這組。

[LOW] `docs/deployment-guide.md:280` 的「到 2036-10」與正式憑證 notAfter 2036-10-23 一致（notBefore 2026-10-26）。§5.1 其餘（DR 字串、不要放進 `APPLE_CERTIFICATE`、本機仍 ad-hoc、ad-hoc 換第一個自簽版要再授權一次）與 workflow 及 Kevin 的實驗一致。`.claude/rules/release.md:53`、`:59-66`、`:78` 把兩個 p12 secret 列為必要、六個 `APPLE_*` 維持空白，與 Import 缺 p12 就失敗的行為一致。

[LOW] 不在這次 diff、不影響結論：`docs/deployment-guide.md:286` 仍寫 workflow 不匯入、不 `codesign`；`:323` 只說 `signingIdentity` 維持 `"-"`；`:335` 仍寫必要 secret 2 個。建議 §5.2 改成「CI 用自簽證 `codesign`，不做 Developer ID、不公證」；`:323` 補上 CI 以 `APPLE_SIGNING_IDENTITY` 覆寫；第六節改成與 `release.md` 相同的 4 個必要 secret。另可補一句：DMG 容器也會被同一張自簽證簽上，打開 DMG 仍會看到未識別的開發者，`.app` 仍要「強制打開」。

`tauri-action` 在 Verify 之前就把資產放進 draft。Verify 失敗時 `publish-release` 不會公開，與 `:224` 的註解一致。

結論：READY
