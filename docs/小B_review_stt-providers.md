# 小B 審查：STT provider 實作（`feat/stt-providers` 未提交工作區）

> 對照 `docs/plan-stt-providers.md` v2。本機沒有 Rust toolchain，**沒有跑** `cargo clippy`／`cargo test`。下列編譯／clippy 結論來自靜態對讀（含 `-D warnings` 會升級的預設 warn）。前端 vue-tsc／eslint／vitest 依 Claude 已綠，此處不重跑。

## [HIGH]

1. **`needless_pass_by_value` 會讓 `cargo clippy --workspace --all-targets -- -D warnings` 失敗（macOS 與 Windows 都編這支函式）。**  
   `src-tauri/src/plugins/transcription.rs:764` `attempt_byteplus_request(wav_data: Vec<u8>, …)` 全程只把 `&wav_data` 交給 `build_byteplus_request`（約 773 行），沒有 move。此 lint 屬 style、預設 warn，crate 沒有允許它。  
   **修法：** 參數改 `wav_data: &[u8]`。`attempt_request`（約 853 行）改成 `attempt_byteplus_request(&wav_data, transcription_state, params).await`。

2. **同一 lint，只在 macOS（含 `x86_64-apple-darwin` clippy）。**  
   `transcription.rs:1190` `transcribe_audio_apple(wav_data: Vec<u8>, …)` 只在 `parse_wav_format`／`wav_audio_duration_ms`／`TempWavFile::create` 借 `&wav_data`，之後才 `.await`。Windows 因 `#[cfg(target_os = "macos")]` 不會編到。  
   **修法：** 參數改 `wav_data: &[u8]`。`transcribe_audio`（約 1272 行）改成 `transcribe_audio_apple(&wav_data, &params).await`。

3. **macOS 內建的「歷史重新辨識」成功也會被當成幻覺丟掉。**  
   `transcription.rs:1334-1336` Apple 在算能量之前就 `return retranscribe_apple(...)`。`run_apple_transcription`（1183-1184 行）把 `peak_energy_level`／`rms_energy_level` 寫死 `0.0`。  
   `useHistoryStore.ts:798-806` 用這兩個值呼叫 `detectHallucination`。`hallucinationDetector.ts:22` 與 `:232-233`：`peak < 0.01` 即 Layer 2a，**任何非空文字都判 `no-speech-detected`**。即時路徑與 HUD 重送用的是錄音器能量，不受影響；Groq／BytePlus 的歷史路徑在 1346 行有補能量。  
   副作用：`useHistoryStore.ts:789` 在幻覺判斷之前就 `recordWhisperUsage`，所以辨識成功、文字卻被丟、用量仍寫入。  
   **修法（對齊下方 Groq／BytePlus）：**

```rust
#[cfg(target_os = "macos")]
if provider == SttProvider::Apple {
    let (peak_energy_level, rms_energy_level) = compute_wav_energy(&wav_data);
    let mut result = retranscribe_apple(file_path, &wav_data, &params).await?;
    result.peak_energy_level = peak_energy_level;
    result.rms_energy_level = rms_energy_level;
    return Ok(result);
}
```

   即時路徑維持 0（註解寫明能量來自錄音器），不要改 `run_apple_transcription` 的預設。

## [MED]

1. **歷史重新辨識吞掉新錯誤文案。** `useHistoryStore.ts:775-777` 任何 `retranscribe_from_file` 失敗都回 `errorKey: "history.retranscribeFailed"`。`HistoryView.vue:161-163` 只翻譯這個 key。BytePlus 金鑰無效、55 秒語言包、授權失敗在歷史頁都變成「辨識失敗，請重新錄音」。即時路徑與測試連線有走 `getTranscriptionErrorMessage`。  
   **修法：** `HistoryRetryResult` 加可選 `errorMessage`。catch 裡設 `getTranscriptionErrorMessage(err)`。`HistoryView.vue` 有 message 就直接顯示，否則才 `t(errorKey)`。

2. **文字整理卡在「轉錄不是 Groq」時，金鑰欄底下仍用舊提示。** `SettingsView.vue:1692-1694` 在完整 Groq 金鑰欄（1685 行 `v-else`）裡繼續顯示 `settings.provider.groqNote`／`groqNoteNotSet`。未設定時七語系都寫「請先到上方語音轉錄填入」（例 `zh-TW.json:77`），但此時上方是 BytePlus 或 macOS，金鑰欄就在同一張卡。已設定時則寫「使用語音轉錄的 Groq API Key」，與此欄不再共用。1676-1681 行（轉錄仍是 Groq）維持舊提示是對的。  
   **修法：** `v-else` 分支改顯示 `settings.apiKey.instruction`，或拿掉這段 `<p>`。不要改 1676 行那支。

3. **歷史路徑沒有計畫 §E 要求的契約測試。** `tests/unit/use-history-retry.test.ts` 只補了 `getSttApiKey`／`hasSttCredential`／`selectedSttProviderId` mock，沒有斷言 `provider`、`transcriptionLocale`、`interfaceLocale`、apple 空金鑰放行、byteplus 金鑰、非 groq 不傳 `whisperPrompt`／`modelId`、非 groq 不簡轉繁。即時與 HUD 在 `tests/unit/use-voice-flow-store.test.ts` 有斷言。能量 bug 也沒有測試能抓到（歷史測試 mock 的 result 自帶 peak）。

## [LOW]

1. **逾時後暫存 WAV 可能在 Speech 還沒收尾時被刪。** `apple_speech.m:151-154` 逾時只 `[task cancel]` 就 return。Rust `TempWavFile`（`transcription.rs:1144-1147`）在 `transcribe_audio_apple` 的 `.await` 結束後 `remove_file`。正常完成與錯誤返回都會刪，這點符合計畫；cancel 是非同步的，檔案可能仍被框架打開。若要收緊：cancel 後再等一次短 semaphore，或把 `TempWavFile` 的 Drop 延到確認 task 結束。FFI 釋放本身是對的：成功路徑 `CStr::from_ptr` → `to_string_lossy().into_owned()` → `typek_apple_speech_free`（1114-1118 行），沒有 `CString::from_raw`。

2. **文件仍寫錯參數名與過期註解。** `.claude/rules/ipc.md:50` 與 `docs/api-contracts-backend.md:142` 的 `retranscribe_from_file` 寫 `path`。Rust 參數是 `file_path`（`transcription.rs:1297`），前端送 `filePath`（`useHistoryStore.ts:757`、`useVoiceFlowStore.ts:1527`）。這是舊文件，實作沒有跟著改壞。`api-contracts-backend.md:132`「undefined → Rust fallback `zh`」與現碼不符：`language == None` 時 Groq 不帶 language 欄（681-683 行）。契約也沒寫 BytePlus `20000003` 的 `noSpeechProbability: 1.0`。

3. **英文副標少了「台灣」。** `en.json:223` `providerHint.byteplus` 是 “Paid · Traditional Chinese output”。zh-TW 基準是「付費 · 可輸出台灣繁體」。其餘六語有台灣／繁體。日文 `ja.json:239` 授權「未決定」譯成「未設定」。

4. **`test_whisper_connection` 的 `#[allow(clippy::too_many_arguments)]`（1386 行）是空的。** 參數 6 個，lint 門檻是「超過 7」。不會因此失敗。`transcribe_audio`／`retranscribe_from_file` 各 10 個，allow 與上一行註解符合 §A1。

5. **BytePlus 請求 JSON 測試沒有逐列打 JSON。** 語言表每一列在 `byteplus_language_config` 測試（1620 行起）有覆蓋；JSON 本體只斷言 zh-TW、en、auto。行為與 §A3 表一致，含熱詞前 50、空清單不帶 `corpus`、`whisper_prompt` 不進 BytePlus。

## 已核對、不必再改

- **cfg／Windows：** `extern "C"`、`apple_speech` 模組、`TempWavFile`、locale 對照都在 `#[cfg(target_os = "macos")]`。非 macOS 的 Apple 在 `check_provider_prerequisites`（146-147 行）先回 `ProviderUnsupported`，空金鑰不會先變 `ApiKeyMissing`。`#[cfg(not(target_os = "macos"))] test_apple_provider_unsupported_before_api_key_check`（1566 行）給 Windows `cargo test`。`lib.rs:511-512` 兩個新指令全平台都有函式，非 macOS 回 `ProviderUnsupported`。`build.rs` 用 `CARGO_CFG_TARGET_OS` 而不是 `#[cfg]`；`build_apple_speech` 從 `main` 的 runtime `if` 呼叫，Windows 上不是 dead code。`&object_path`／`&library_path` 是既有 `PathBuf` 的單層借用，2024-05 之後的 `needless_borrows_for_generic_args` 不對這種寫法報警告。
- **FFI：** `apple_speech.m` 五個符號與 `transcription.rs:1046-1058` 一致（`i32`、`*const c_char`、`*mut c_char`、`*mut i32`）。`request_auth`、`transcribe`、測試連線的 locale 檢查都在 `spawn_blocking`。`apple_speech_auth_status` 維持同步，符合計畫。
- **BytePlus：** URL、`X-Api-Key`／`X-Api-Resource-Id: volc.seedasr.auc_turbo`／`X-Api-Request-Id`／`X-Api-Sequence: -1`、WAV fmt（bits≠16 或聲道不是 1／2 → `Unsupported WAV format`）、語言表、熱詞、標頭 `X-Api-Status-Code`（401 與 `45000010` 不重試、`20000000` 成功且 NSP `None`、`20000003` 空字串 + `Some(1.0)`、`55000000–55999999` 為 `ServerError`、429／5xx 可重試、其餘 `ProviderError` 不重試）。測試連線把 `45000002` 當金鑰有效（1451-1456 行）。`FileTooLarge` Display 沒有 Groq。檔案上限 Groq 25MB、BytePlus 100MB。
- **`no_speech_probability: Option<f64>`：** 無 `skip_serializing_if`。Groq 回 `Some`。日誌 `None` 印 `n/a`（909-911 行）。序列化測試含 `0.01` 與 `null`。前端 `number | null`，`toFixed` 有空值分支，Layer 2b 在 `!== null` 才看 NSP（`hallucinationDetector.ts:236`）。
- **三條 invoke：** 即時、HUD 重送、歷史都傳 `provider`／`transcriptionLocale`／`interfaceLocale`／`getSttApiKey()`；`whisperPrompt` 與 `modelId` 只在 groq；字典詞三家都傳；apple 不被空金鑰擋住；簡轉繁只在 groq。`main-window.ts:70` 改看 `hasSttCredential`。
- **設定：** `sttProviderId` 缺值／非法／非 Mac 的 apple → groq；非 Mac 寫回是 `store.set` + `store.save`、不 emit（`useSettingsStore.ts:299-305`、1573-1578）。`hasApiKey` 仍是 Groq。`hasSttCredential`／`getSttApiKey`／`refreshSttApiKey` 符合 §B。`SettingsKey` 含 `sttProvider`、`byteplusApiKey`。
- **設定頁：** Mac `grid-cols-3`、Windows `grid-cols-2`，樣式沿用文字整理卡。副標、BytePlus 主控台連結與新加坡上傳說明、Apple 授權三態與 `x-apple.systempreferences:…Privacy_SpeechRecognition`、非 groq 左欄唯讀、onboarding 只在 groq 且沒有 Groq 金鑰、測試連線 `disabled` 看 `hasSttCredential` 並帶 locale。徽章在各 provider 區塊（金鑰或授權），不在卡標題。
- **用量：** apple `apple-speech`、byteplus `seed-asr-fast`；`apiPricing.ts` 成本 0 且不套 10 秒地板。`DAILY_QUOTA_USAGE_SQL`（`useHistoryStore.ts:151-153`）只加總兩個 Groq Whisper id。Dashboard 在 provider 不是 groq 時不放入 Whisper 額度維度（`DashboardView.vue:91`）。
- **errorUtils：** Display 字串與七語系 key 對得上（`Provider authentication failed (BytePlus)`、`BytePlus transcription failed (code …)`、`Apple speech error (…)`、`This transcription provider is not supported`）。`fileTooLarge` 七語系都沒有 Groq。
- **建置與文件主體：** `Info.plist` 的 `NSSpeechRecognitionUsageDescription` 與計畫英文一致。CI `push.branches` 含 `feat/**`，macOS job 有 `x86_64-apple-darwin` clippy。`ipc.md` 有三個指令的新參數與兩個 Apple 指令。

## 結論

clippy 兩處 `Vec<u8>` 所有權，以及 Apple 歷史重送的能量 0，都會讓這條分支在 CI 或實機上失敗。先修 [HIGH] 再推。

結論：NOT READY

## 複審（第 2 輪）

只核對上一輪點名的修正。本機沒有 `rustc`／`cargo`（`src-tauri/target` 也不存在），沒有跑 `cargo clippy`／`cargo test`。編譯結論是依 edition 2021 對 `transcription.rs` 的控制流閱讀。前端 vue-tsc／eslint／vitest 沿用 Claude 的結果（43 檔／700 測試），這輪沒有重跑。

### HIGH1／HIGH2：`needless_pass_by_value` 與簽名

上一輪把 `clippy::needless_pass_by_value` 當成 style、預設 warn，會讓 `cargo clippy -- -D warnings` 失敗。那個判斷不對。Claude 的說法成立。

Clippy master 清單（2026-10）把這條 lint 標成 **pedantic、allow**（pre 1.29.0 起就在這個群組；原始碼的 `declare_clippy_lint!` 第二個參數是 `pedantic`）。`pedantic` 不在 `clippy::all`。`-D warnings` 只把目前已經是 warn 的 lint 升成 deny，不會打開 allow-by-default。CI（`.github/workflows/ci.yml` 第 53、66 行）就是 `cargo clippy --workspace --all-targets -- -D warnings`，含 macOS host 與 `x86_64-apple-darwin`。crate 沒有 `#![warn(clippy::pedantic)]`，也沒有 `[lints.clippy]`。舊的 `Vec<u8>` 簽名不會讓這條 CI 變紅。預設會響、名字相近的是 `large_types_passed_by_value`（perf、warn），門檻 256 bytes；`Vec<u8>` 是三個字長，同樣不會中。

簽名仍已照修法改完：

- `attempt_byteplus_request(wav_data: &[u8], …)`（763 行）。`build_byteplus_request` 收 `&[u8]`，JSON 在 `.send().await` 之前組完。`attempt_request` 的 BytePlus 臂傳 `&wav_data`（854 行）。Groq 臂仍 move `Vec<u8>`，所以 `attempt_request` 維持 by value。
- `transcribe_audio_apple(wav_data: &[u8], …)`（1189 行）。`parse_wav_format`、`wav_audio_duration_ms`、`TempWavFile::create`（`fs::write` 把位元組寫進暫存檔）都在 `.await` 之前結束借用。即時路徑傳 `&wav_data`（1273 行）。

### 借用／move：macOS 與 Windows

`retranscribe_from_file`：

- `file_path` 先被 `std::fs::read(&file_path)` 與 `log::info!` 借用，兩個敘述結束後借用釋放。
- macOS 的 Apple 分支把 `file_path` move 進 `retranscribe_apple`（再 move 進 `spawn_blocking`），`wav_data` 只被借走，然後 `return`。後面的 `send_transcription_request(wav_data, …)` 只在沒進這條分支時 move `wav_data`。`file_path` 之後不再使用。兩條路徑不會交錯 move。
- Windows 把 macOS 那個 `if` 整段拿掉。`file_path` 只剩借用。Apple 分支直接回 `ProviderUnsupported`，不碰 `file_path` 與 `wav_data`。`peak_energy_level`／`rms_energy_level` 是 `Copy`，非 Apple 路徑會寫回結果，不會變成未使用變數。`check_provider_prerequisites` 在非 macOS 對 Apple 回 `Err` 是執行期檢查，後面的 `if` 對編譯器仍可達，不會觸發 `unreachable_code`。

`transcribe_audio`：macOS Apple 在自己的區塊裡 `take` 緩衝、傳 `&wav_data`、return；mutex guard 在 `.await` 前放開。Windows 的 Apple 分支在 `take` 之前就回 `ProviderUnsupported`。後面的 `wav_data` 是另一個綁定。沒有重複 move，也沒有 Windows 上的 dead binding。

### HIGH3

能量在兩個 `cfg` 分支之前就算好（1336 行）。macOS Apple 成功後覆寫 `peak_energy_level`／`rms_energy_level`（1340–1343 行）。Groq／BytePlus 仍在 `send_transcription_request` 之後覆寫。`run_apple_transcription` 維持 `0.0`（1183–1184 行）。即時路徑的註解還在（1272 行），錄音器能量的契約沒改。歷史頁 `detectHallucination` 因此拿得到 WAV 能量，有聲的成功結果不會再被 Layer 2a（`peak < 0.01`）當成無語音丟掉。

### MED1／MED2／MED3

- `HistoryRetryResult.errorMessage` 為可選。`retranscribe_from_file` 的 invoke 失敗在 `useHistoryStore.ts` 782–786 行帶 `getTranscriptionErrorMessage(err)`。`HistoryView.vue` 360 行是 `retryError.message ?? $t(retryError.key)`。沒有 message 的路徑（沒檔案、編輯模式、鎖、幻覺、重新整理）仍走 i18n key。Invoke 錯誤在 unlocked 裡就 return，外層 catch 不會把這段文案吞掉。
- 文字整理卡：`groqNote`／`groqNoteNotSet` 只留在 `selectedSttProviderId === 'groq'`（1680 行）。STT 不是 Groq 的獨立金鑰欄（1685 行 `v-else`）已拿掉那段 `<p>`。`.vue`／`.ts` 只剩這一處。
- `use-history-retry.test.ts` 三則與 store 一致：apple 空金鑰仍送出，帶 `transcriptionLocale`／`interfaceLocale` 與字典，不帶 `whisperPrompt`／`modelId`，不呼叫簡轉繁；byteplus 帶金鑰與 locale，同樣不帶 prompt／model、不簡轉繁；BytePlus 認證失敗時 `errorKey` 仍是 `history.retranscribeFailed`，`errorMessage` 有值，而且不是原始 Display 字串。`getTranscriptionErrorMessage` 會把該字串對到 `errors.transcription.byteplusAuth`。

### LOW2／LOW3

- `ipc.md` 第 50 行與 `docs/api-contracts-backend.md` 第 142 行已是 `file_path`，與 Rust 參數同名。這兩份文件本來就用 snake_case；前端 invoke 仍送 `filePath`，由 Tauri 對到 `file_path`。`language` 註解改成 null／undefined 時 Groq 不帶 language，對得上 680–683 行。契約寫了 BytePlus `20000003` → 空字串與 `noSpeechProbability: 1.0`，對得上 518–519 行；Apple 空結果的 `1.0` 也在同一句。
- `en.json` 的 `providerHint.byteplus` 是 “Paid · Taiwan Traditional Chinese output”。`ja.json` 的 `appleAuth.notDetermined` 是「未確認」，與同檔金鑰狀態用的「未設定」分開。

點名的修正都在。macOS／Windows 的 `file_path` 與 `wav_data` 借用沒有看得到的編譯錯誤或未使用變數。上一輪的 CI 阻擋判斷撤回。本機仍沒跑過 cargo。

結論：READY
