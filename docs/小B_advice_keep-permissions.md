# 小B 建議：更新後保留 macOS 權限

日期：2026-10-26。只寫這份建議，沒有改過程式、沒有建立憑證、沒有跑建置。Kevin 的限制：不申請付費 Apple Developer Program。

其他 App 更新後權限還在，是因為它們有一張穩定的 **Developer ID**。那張證需要付費帳號，也才能公證。不付費時，做得到的是一張自己簽的「程式碼簽章」憑證，讓 TCC 改認憑證、不再認每次建置的 cdhash。Gatekeeper 第一次打開 DMG 的那一下不會因此消失。

---

## 建議順序

1. **做：長命的自簽 Code Signing 憑證，CI 用同一張簽每個 macOS 正式包。** 工作量是一張憑證、兩個新的 GitHub secret、`release.yml` 加一段只在 macOS job 跑的匯入。不必改 Rust，也不必改 minisign。先在 Kevin 的 Mac 上用這張憑證簽兩次、走一次 App 內更新，確認 `AXIsProcessTrusted()` 仍為 true，再對使用者發布。
2. **不做：免費 Apple ID 的 Personal Team。** 描述檔 7 天過期，而且只能裝到已登記的裝置，使用者的 Mac 打不開。
3. **維持現狀當對照：ad-hoc（`signingIdentity: "-"`）。** 每次更新都要在「裝置控制與資料存取」按 − 再 +。這是今天的行為，不是保留權限的做法。

配套（不是替代）：從 ad-hoc 換到這張憑證的**那一個版本**，每個人仍要 − 再 + 一次。那次之後的更新才沿用。Guide 文案要講這一句。這次不改 UI。

---

## 1. 自簽憑證為什麼有機會留住權限

TCC 存的是 designated requirement（DR），不是「TypeK 這個名字」或開關本身。下一版必須滿足當初授權時寫進資料庫的那條 DR。Apple TN3127 用麥克風當例子，輔助使用走同一套 code identity。

現在的正式包是 ad-hoc。DR 是 `designated => cdhash H"…"`。cdhash 蓋過程式與 `Info.plist`（TN3126），版號一改就變。系統設定仍可顯示 TypeK、開關仍是開，`AXIsProcessTrusted()` 卻是 false。這次 1.3.0 就是這個症狀。

改用憑證簽、又不自己寫 DR 時，`codesign` 預設把 DR 釘在憑證葉雜湊上。Nick Liu 在 2026-05 量到的形狀是：

```text
designated => identifier "…" and certificate leaf = H"…"
```

葉雜湊跟這張憑證走，不跟二進位走。同一張憑證簽 1.4 與 1.5，DR 相同，舊的 `csreq` 仍接受。DTS（Quinn，2022-12，forums/thread/721745）的說法是：要穩定身份，不要 ad-hoc；身份看的就是 TN3127 的 DR。yabai 作者的經驗是：路徑不變、每次用同一張自簽憑證重簽，輔助使用會留著。

麥克風是同一條 DR。TN3127 的例子就是麥克風資料庫。預期是：第一次仍會跳出系統詢問；之後的更新不再問。輔助使用沒有那種自動對話框，所以壞掉時比較像「開關開著但 API 是否」。

**未確認（發布前必須做的實驗）：** 上面的實測都是「在自己的 Mac 上重簽、再跑」。TypeK 是 GitHub Actions 簽、使用者機器上沒有私鑰。葉雜湊的檢查用的是簽章裡嵌進去的憑證，理論上使用者不必安裝這張證。這件事沒有在 macOS 27 的「裝置控制與資料存取」上、也沒有用 tauri-plugin-updater 2.10.0 原地換 `.app` 驗證過。實驗失敗就停，不要發。

使用者不必、也不該把這張憑證裝進自己的鑰匙圈。裝了也不會變成公證，Gatekeeper 仍不認。

---

## 2. 在現有 Tauri 2.10 裡要怎麼接

鎖的版本：`@tauri-apps/cli@2.10.0`、`tauri` 2.10.2（`Cargo.lock`）。下面兩段是這個 tag 的行為。

### 不要把 p12 放進 `APPLE_CERTIFICATE`

`tauri-bundler` 看到 `APPLE_CERTIFICATE` 與 `APPLE_CERTIFICATE_PASSWORD` 都有值，就呼叫 `Keychain::with_certificate`。2.10.2 的 `identity::list` 只認得 Common Name 含這些前綴的證：

`Developer ID Application:`、`Apple Development:`、`Apple Distribution:`、`Mac Development:`、`Mac App Distribution:`、`iOS Distribution:`、`iOS App Development:`

而且憑證主體必須有 OU（Team ID），否則這張證被丟掉，建置在 `ResolveSigningIdentity` 失敗。一張正常的自簽證（CN = `TypeK Code Signing`、沒有 Team ID）走這條路**簽不起來**。

不要把 CN 改成 `Developer ID Application: …` 去騙這個解析器。公證文件寫明：自簽證會被公證拒絕（「not signed with a valid Developer ID certificate」）。名字長得像 Developer ID、鏈卻不是 Apple 的，有機會讓 Gatekeeper 走出「已簽但未公證」那條更硬的拒絕。**未確認** macOS 27 會不會因此變成「已損毀」。不值得冒這個險。

### 六個 `APPLE_*` secret 維持空白

`docs/deployment-guide.md` 列的六個是：

| Secret | 這次 |
| --- | --- |
| `APPLE_CERTIFICATE` | 空白。填了會走上面那個只認 Apple 前綴的匯入 |
| `APPLE_CERTIFICATE_PASSWORD` | 空白。同上 |
| `APPLE_SIGNING_IDENTITY` | 空白。CN 不是機密，由 workflow 寫進 `GITHUB_ENV`，不要做成 secret |
| `APPLE_ID` | 空白 |
| `APPLE_PASSWORD` | 空白 |
| `APPLE_TEAM_ID` | 空白 |

2.10.2 的 `notarize_auth()`：三個公證變數都沒有 → `MissingCredentials` → log 一句 skipping notarization，**繼續建置**。`APPLE_ID` 與 `APPLE_PASSWORD` 有值但 `APPLE_TEAM_ID` 沒有 → `MissingTeamId` → **整個 macOS job 失敗**。三個都有值 → 送公證，自簽證會被拒，job 失敗。

另外三個文件裡的公證變數也不要設：`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH`。有值也會去公證。

`APPLE_SIGNING_IDENTITY` 這個**環境變數**（不是那個同名 secret）會蓋過 `tauri.conf.json` 的 `signingIdentity`。正式文件：https://v2.tauri.app/reference/environment-variables/ 。所以設定檔可以繼續留 `"-"`，本機 `pnpm tauri build` 仍是 ad-hoc。CI 寫入環境變數之後才改用憑證。本機 ad-hoc 包與正式包是兩個身份，不能拿來驗「更新後權限還在」。

p12 用兩個新 secret，不要塞進那六個名字：

- `TYPEK_CODESIGN_P12`：p12 的 base64（單行）
- `TYPEK_CODESIGN_P12_PASSWORD`：匯出時設的密碼

minisign 的 `TAURI_SIGNING_PRIVATE_KEY` 維持原樣。兩把鑰匙各管一件事。

### Gatekeeper 會不會更糟

不會變成「已公證、直接打開」。自簽過不了 Gatekeeper。從瀏覽器下的 DMG 仍帶隔離屬性，第一次仍要到隱私權與安全性按「仍要打開」。這和現在的 ad-hoc 是同一類，Tauri 的 ad-hoc 說明也寫了這件事。

有機會更糟的情況只有簽章本身壞掉（被系統當成損毀、設定裡沒有「仍要打開」）。憑證鏈完整、`codesign --verify` 通過時，預期仍是「無法驗證開發者」，不是「已損毀」。**未確認** macOS 27 的原文。第一個實驗包用瀏覽器下載 DMG 看一次對話框，再決定要不要發。

App 內更新是另一條路。updater 2.10.0 用 reqwest 下載，不是瀏覽器下載，一般不會自己打上隔離屬性；它換上的是 CI 已經簽好的 `.app`，不會在使用者機器上重簽。minisign 只驗 tar.gz，與 Apple 簽章無關，更新流程可以維持。**未確認** 2.10.0 換上的 `.app` 在 macOS 27 會不會被系統補上隔離。驗收時走真正的「檢查更新」，不要再拖一次 DMG。

### Hardened Runtime

2.10.2 的 `sign()` 在 `hardened_runtime` 為真時加 `--options runtime`。這個鍵的 serde 預設是 true（PR #10199）。TypeK 的 `tauri.conf.json` 沒寫它，所以正式簽章會帶 runtime。`Entitlements.plist` 現有的麥克風與 Apple Events 會跟著簽進去；沒有 App Sandbox。

先不要改成 false。若實驗包簽完打不開（library validation），再把 `hardenedRuntime` 設為 false 重做一次實驗。現有 ad-hoc 包是否已經帶 `flags=runtime`，用 `codesign -dv` 看，**未確認**。

自簽不要加 `--timestamp`。TN3161 的安全時間戳是給 Developer ID、走 `timestamp.apple.com`。Tauri 2.10.2 的 `codesign` 參數裡也沒有 `--timestamp`。沒有時間戳時，憑證到期後新的簽章做不了；舊簽章會不會被 TCC 的葉雜湊檢查拒絕，**未確認**（`certificate leaf = H"…"` 比的是雜湊，不是有效期）。把有效期做長，避免在沒有資料時踩到期。

---

## 3. 實作步驟

### 3.1 在 Kevin 的 Mac 上做憑證（只做一次）

鑰匙圈存取 → 憑證助理 → 製作憑證：

1. 名稱：`TypeK Code Signing`（與下面的環境變數一字不差）
2. 識別身分類型：Self Signed Root
3. 憑證類型：**Code Signing**（不要選 SSL）
4. 勾選「讓我覆寫預設值」
5. 有效期 **3650 天**。做完點開憑證，確認「到期日」是大約十年後。憑證助理不覆寫時的預設天數，**未確認**（常見是 365 天）；不覆寫就不要用
6. 演算法用 RSA 2048 或 4096、SHA-256。若助理還提供 SHA-1，不要選。**未確認** macOS 27 的助理是否仍列出 SHA-1

憑證要能展開看到私鑰。`security find-identity -v -p codesigning` **不會**列出它（`-v` 只列受信任的身份，自簽根是 `CSSMERR_TP_NOT_TRUSTED`）。改查：

```bash
security find-identity -p codesigning | grep "TypeK Code Signing"
```

Nick Liu 同一篇：`codesign` 簽章時不看這張證在系統裡信不信任，它要的是私鑰。

匯出：選這張證（含私鑰）→ 輸出項目 → 個人資訊交換（.p12），設一組長密碼。不要把 p12、密碼、base64 檔提交進 repo。

```bash
openssl base64 -A -in TypeKCodeSigning.p12 -out /tmp/TypeKCodeSigning-base64.txt
```

內容貼進 GitHub secret `TYPEK_CODESIGN_P12`，密碼貼進 `TYPEK_CODESIGN_P12_PASSWORD`，然後刪掉 `/tmp` 那兩個檔。私鑰另存一份在密碼管理器。丟了 p12：已安裝的版本仍可跑，下一版簽不了，使用者要再授權一次。丟了 minisign：已安裝的版本永遠驗不過新版，只能手動重裝。兩件事分開放。

openssl 自製憑證可以，但比較容易缺 Code Signing 的 extended key usage，`codesign` 會拒絕。若不用鑰匙圈助理：

```bash
openssl req -new -newkey rsa:3072 -x509 -days 3650 -nodes \
  -keyout typek.key -out typek.crt \
  -subj "/CN=TypeK Code Signing" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"
openssl pkcs12 -export -legacy -inkey typek.key -in typek.crt \
  -out TypeKCodeSigning.p12
```

`-legacy` 是為了 GitHub runner 上的 `security import`。做完用 `codesign -s "TypeK Code Signing"` 試一次；失敗就回到鑰匙圈助理。私鑰檔用完即刪。

### 3.2 先在本機證明 TCC，再碰 CI

憑證已經在登入鑰匙圈時：

```bash
APPLE_SIGNING_IDENTITY="TypeK Code Signing" pnpm tauri build
```

不要設 `APPLE_CERTIFICATE`。對產出的 `.app`：

```bash
codesign -d -r - "/path/TypeK.app"
codesign --verify --verbose=2 "/path/TypeK.app"
```

通過條件：DR 含 `identifier "com.kekukeku.typek"` 與 `certificate leaf = H"…"`，沒有單獨的 `cdhash`；verify 通過；`Signature` 不是 `adhoc`。把那串 `H"…"` 記下來。

再改一個版號（或任何會進簽章的 byte）用同一張證重簽。兩次的 `H"…"` 必須相同。然後：

1. 第一次的 `.app` 放進 `/Applications`，從 Finder 打開（不要從 DMG 裡直接跑，避免 App Translocation）。
2. 裝置控制與資料存取：若清單裡已有 ad-hoc 的 TypeK，− 移除，再 + 加這一次的包。確認快捷鍵與麥克風。
3. 完全退出。用第二次的 `.app` **覆蓋** `/Applications/TypeK.app`（模擬更新，仍不要從 DMG 開）。
4. 再開。不碰系統設定。`AXIsProcessTrusted()` 應為 true，右 Option 能錄音，麥克風不應再問。

第 4 步失敗：這條路在這臺 Mac 上不成立，停止，不要做 CI。第 4 步成功：葉雜湊這條 DR 在這臺機器上有效，剩下的是「CI 簽出來的葉雜湊是否同一張」。

簽的時候若出現 `unable to build chain to self-signed root` 並且 `errSecInternalComponent`，只在**這臺負責簽名的 Mac** 上把該證的「程式碼簽章」信任設成永遠信任，再簽一次。不要把這個信任步驟寫進給使用者的說明。

### 3.3 `release.yml`（macOS job）

放在現有「Export optional signing secrets」之後、「Build and release」之前。只有 `runner.os == 'macOS'` 執行。

1. `TYPEK_CODESIGN_P12` 或密碼為空 → `exit 1`。不要默默退回 ad-hoc，否則 CI 是綠的、使用者權限又斷。
2. base64 解出 p12。
3. `security create-keychain` 建臨時鑰匙圈、`unlock-keychain`。
4. `security import … -f pkcs12 -t agg -P "$TYPEK_CODESIGN_P12_PASSWORD" -T /usr/bin/codesign -k <臨時鑰匙圈>`。
5. `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <鑰匙圈密碼>`。沒有這步，CI 沒有 UI，`codesign` 會卡在私鑰授權或直接失敗。
6. `security list-keychain -d user -s` 保留 runner 原有的鑰匙圈，**並加上**這個臨時鑰匙圈。`with_signing_identity` 不會傳 `--keychain`（2.10.2 `keychain.rs` 的 `path` 是 None），`codesign` 只搜尋清單。
7. 寫入環境，不要寫 secret：

```bash
echo "APPLE_SIGNING_IDENTITY=TypeK Code Signing" >> "$GITHUB_ENV"
```

8. 確認這一階段**沒有**把 `APPLE_CERTIFICATE` 寫進環境。六個 secret 維持空白時，現有的 export step 本來就不會寫。

建置 log 應出現 `Signing with identity "TypeK Code Signing"`，以及 `skipping app notarization`。兩個 macOS job（arm64 與 x64）用同一張 p12。發布前對兩個 `.app` 各跑一次 `codesign -d -r -`，葉雜湊必須相同。

Windows job 不要匯入這張證。

若 log 是 `errSecInternalComponent` / `unable to build chain`，再在同一步對**臨時鑰匙圈**加 `security add-trusted-cert -d -r trustRoot -p codeSign`。這是 CI 補救，**未確認** 現在的 `macos-latest` 是否需要。不要先加。

`signingIdentity` 維持 `"-"`。`createUpdaterArtifacts` 維持 true。bundle id 維持 `com.kekukeku.typek`。DR 裡有 identifier，改 bundle id 會把授權全部弄斷。

### 3.4 對使用者發布前的最後一次

用 CI 產物，不要用本機 ad-hoc：

1. 瀏覽器下載 DMG，拖進 `/Applications`。記下 Gatekeeper 的原文。
2. − 再 + 一次（這是從 ad-hoc 換身份的那一次，預期要做）。
3. 只靠 App 內更新裝下一個版號。
4. 不碰系統設定。快捷鍵、貼上、麥克風都要測。

通過之後，Guide 仍要留「若開關開著但快捷鍵沒反應，− 再 +」給換證、或實驗判斷錯誤時用。不要在 App 裡呼叫 `tccutil`。

---

## 4. Personal Team（不做）

免費 Apple ID 在 Xcode 裡是 Personal Team。Apple 帳號說明（developer.apple.com/help/account/basics/about-your-developer-account，此處 2026-10-26 讀到的頁面）：

- App ID 最多 10 個，7 天後過期
- 測試裝置最多 3 臺，7 天後過期
- 讓 App 能裝上裝置的描述檔，核發後 7 天過期，到期要重編、重裝

同一頁的功能表把「Mac software notarization」放在付費方案才有的那一欄。Developer ID 的建立說明也在付費帳號的 Certificates 裡。免費帳號沒有 Developer ID，不能公證。

這種簽章是 Apple Development，加上只含已登記裝置的描述檔。別人的 Mac 不在名單裡，amfid 不讓它跑。就算只給 Kevin 自己用，7 天後 App 也開不了；描述檔或憑證一換，DR 再變一次，TCC 又斷。比 ad-hoc 更不適合 TypeK 的 GitHub Release。

---

## 5. 其他路

**固定 cdhash。** 做不到。cdhash 是 CodeDirectory 的雜湊，涵蓋程式頁與 `Info.plist` 等封存資源（TN3126）。版號不同，雜湊就不同。可重現建置改變不了這一點。

**ad-hoc 但手寫 `designated => identifier "com.kekukeku.typek"`。** `codesign -r` 做得到，Tauri 2.10.2 沒有這個開關，要在 bundler 簽完後再簽一次。Hermes 的 PR 73681 主張這樣可以讓 DR 跨版相同。代價是：任何人都能 ad-hoc 簽一個同 bundle id、同一條 DR 的程式，繼承 TypeK 的輔助使用（全域按鍵）與麥克風，不必偷私鑰。自簽憑證至少要把私鑰留在 GitHub secret。這條不做。

**獨立 helper，二進位凍結、靠 cdhash 不變。** helper 一個 byte 都不能變，而且不能被 Tauri 重簽；2.10.2 會由內往外簽嵌進去的執行檔。麥克風在主程式的 `audio_recorder.rs`，helper 只蓋得到快捷鍵。工作量和一個新行程差不多。自簽憑證若第 3.2 節失敗，再考慮；現在不做。

**描述檔 / PPPC 預先授權。** 使用者要另外裝描述檔。近年 macOS 上，不少 TCC 項目只接受 MDM。體驗比 − 再 + 差。macOS 27 上使用者自己裝的描述檔能否寫入裝置控制，**未確認**。不做。

**借別人的付費 Developer ID。** 憑證被撤銷時，已簽的版本會一起開不了。也不在「不申請付費帳號」這條限制的本意裡。不做。

---

## 6. 風險

- **私鑰外洩：** 拿到 p12 的人可以簽一個滿足同一條 DR 的程式，在已經授權過的 Mac 上繼承輔助使用與麥克風。secret 只放 GitHub，限制能跑 Release workflow 的人。不要為了方便把 p12 放進 repo。
- **換證：** 葉雜湊一變，全員再授權一次。憑證做長、不要一年換一次。
- **第一個自簽版本：** 相對現在的 ad-hoc，這是新身份。發布說明要寫「這次更新後要到裝置控制與資料存取移除 TypeK 再加回來；之後的更新不必」。
- **本機開發：** `pnpm tauri dev` 與沒設環境變數的本機 build 仍是 ad-hoc，權限不會跟正式版共用。這是預期。
- **CI 第一次：** 最可能的失敗是臨時鑰匙圈沒進搜尋清單，或私鑰沒做 partition list。失敗應是 job 紅，而不是簽回 ad-hoc。

---

## 來源

- TN3127（DR 是跨版本的 code identity；ad-hoc 綁那一個版本；麥克風為例）：https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- TN3126（cdhash）：https://developer.apple.com/documentation/technotes/tn3126-inside-code-signing-hashes
- TN3161（Developer ID 的安全時間戳；`Signed Time` 不是安全時間戳）：https://developer.apple.com/documentation/technotes/tn3161-inside-code-signing-certificates
- 公證拒絕非 Developer ID（含自簽）：https://developer.apple.com/documentation/security/resolving-common-notarization-issues
- DTS，穩定身份而非 ad-hoc：https://developer.apple.com/forums/thread/721745
- 自簽證把 DR 從 cdhash 改成 `certificate leaf`（2026-05-10，文內實驗是本機重簽）：https://nick-liu.com/posts/tcc-cdhash-trap/
- yabai 自簽 Code Signing 憑證：https://github.com/koekeishiya/yabai/wiki/Installing-yabai-%28from-HEAD%29 ；同一張證加固定路徑才留得住權限：https://github.com/asmvik/yabai/issues/1968
- Personal Team 的 7 天限制：https://developer.apple.com/help/account/basics/about-your-developer-account
- Tauri 環境變數（`APPLE_SIGNING_IDENTITY` 蓋過設定；公證要 `APPLE_ID` 或 API key）：https://v2.tauri.app/reference/environment-variables/
- Tauri ad-hoc 仍要使用者到隱私權與安全性放行：https://v2.tauri.app/distribute/sign/macos/
- 對到 TypeK 鎖的版本的原始碼（tag `tauri-v2.10.2`）：`crates/tauri-bundler/src/bundle/macos/sign.rs`（`keychain()`、`notarize_auth()`）、`crates/tauri-bundler/src/bundle/macos/app.rs`（缺公證憑證就 skip，缺 Team ID 則失敗）、`crates/tauri-macos-sign/src/keychain/identity.rs`（只認 Apple 前綴，且要有 OU）
