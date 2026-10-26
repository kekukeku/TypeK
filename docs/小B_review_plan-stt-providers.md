# 小B 審查：`docs/plan-stt-providers.md`（v1 草稿，2026-10-26）

只審查，未改程式。範圍是問題 1–4 與 6。問題 5（版面 demo）不回答。

BytePlus 對過官方樣本 `byteplus-sa/ComfyUI-BytePlus-ModelArk` commit `ccbf08b`（`nodes/constants.py`、`models_config.py`、`nodes_speech.py`、`speech_api.py`）。`docs.byteplus.com` 這次只回頁殼，沒有 schema 本文。火山引擎中國區 flash 文件的 resource id 與新加坡主機不同，下面分開寫。

---

## 1. Apple：`SFSpeechRecognizer`；語言包沒下載就報錯

維持 `SFSpeechRecognizer`（`plan-stt-providers.md:52-56`）。`SpeechAnalyzer` 只有 macOS 26、不能回灌到現有系統；長音訊的 `SpeechTranscriber` 沒有與 `contextualStrings` 對等的字典詞入口。字典詞是這次需求的一部分，不該為了新 API 拆掉。兩套並存會讓 CI 編不過的 Swift 表面積加倍。

語言包不在時直接失敗，回獨立錯誤碼（建議 `ON_DEVICE_PACK_MISSING`，與 `LOCALE_UNSUPPORTED` 分開）。文案請使用者到系統設定下載該語言的聽寫語言包，或改 Groq／BytePlus。

[HIGH] `plan-stt-providers.md:96` 與 `:128` 在 `supportsOnDeviceRecognition == false` 時改走 Apple 線上辨識。伺服器辨識單次請求上限約一分鐘，超過會失敗或被截斷；音訊會上傳到 Apple。這和「內建、不佔空間」以及長錄音（Groq／BytePlus 走得完）不一致。設定頁一句靜態說明不夠：使用者選了 macOS 內建，長錄音仍會在沒有專用錯誤的情況下失敗。`requiresOnDeviceRecognition = true` 且語言包不在時，用上面的錯誤碼，不要把同一個 `LOCALE_UNSUPPORTED` 拿來表示「語言不支援」和「語言包沒下載」。

若產品堅持沒下載語言包也要能轉：必須在送出前拒絕或切段超過約 60 秒的音訊，並在這次辨識的錯誤／確認文案寫明音訊會上傳。這條路徑不在建議實作裡。

[MED] `plan-stt-providers.md:94` 的 `requestAuthorization` 與 `DispatchSemaphore`。授權回呼要丟回主執行緒才會跳出系統對話框；`wait` 放在 `spawn_blocking` 的工作執行緒（`plan-stt-providers.md:98`）。wait 若落在主執行緒，對話框與 semaphore 互相卡住，直到逾時。

[MED] `plan-stt-providers.md:98` 暫存 WAV。檔名要唯一，所有返回路徑（含辨識失敗、逾時、Rust 錯誤）都刪除。用 `Drop` 守著檔案，不要寫死一個固定檔名。

[LOW] `src-tauri/Entitlements.plist` 沒有 App Sandbox。`NSSpeechRecognitionUsageDescription`（`plan-stt-providers.md:107`）足夠觸發 TCC。不要為了這次改動加上 sandbox entitlement。

---

## 2. `swiftc` 靜態庫過不了交叉編；改 Objective-C，並把 x86_64 放進 CI

[HIGH] `plan-stt-providers.md:102-105` 的連結不完整，`x86_64` 在現有 CI 裡不會被編到。

- `swiftc -emit-library -static` 只封自己的 object，不含 Swift runtime。這些 object 參考 `@rpath/libswiftCore.dylib`。`cargo:rustc-link-search` 不會讓 rustc 讀 Swift 的 autolink 檔，也不會自動拉 `libswiftCore`。
- 在 arm64 的 `macos-latest` 上交叉編 `x86_64` 時，必須 `xcrun --sdk macosx swiftc -target x86_64-apple-macos…`。toolchain 的 `usr/lib/swift/macosx` 常是 host 架構，搜尋順序又排在前面，會鏈到錯誤架構或根本沒有那個 slice。
- 就算鏈過，執行期常見 `Library not loaded: @rpath/libswiftCore.dylib`（沒有 `LC_RPATH`）。`-Wl,-rpath,/usr/lib/swift` 只在目標 macOS 自帶對應 Swift runtime 時有效。Xcode 26／Swift 6 寫死 `-target *-apple-macos10.15`（`plan-stt-providers.md:103`）沒有 back-deploy 函式庫時，舊系統載入失敗。
- `.github/workflows/ci.yml:33-57` 的 `rust-check` 沒有 `--target`，macOS job 只編 runner 的 host 架構（Apple Silicon）。`plan-stt-providers.md:136` 加上 `feat/**` 只讓功能分支跑同一份 host 檢查。第一次編到 `x86_64` 是發版 `.github/workflows/release.yml:29`（`--target x86_64-apple-darwin`）。

建議（仍不加 crate）：用 `xcrun clang` 編一份 Objective-C `.m`。`SFSpeechRecognizer`、`SFSpeechURLRecognitionRequest`、`contextualStrings`、`requiresOnDeviceRecognition`、`addsPunctuation` 都是 ObjC API。`libtool -static` 做成靜態庫，`cargo:rustc-link-lib=framework=Speech`／`Foundation`／`AVFoundation`。Tauri 已經連結 ObjC runtime，沒有 Swift runtime、沒有 rpath。`extern "C"` 與這些 link 行都放在 `target_os = "macos"`（build script 用 `CARGO_CFG_TARGET_OS`，這點計畫是對的）。

macOS CI 在現有 host job 之外加：

```bash
rustup target add x86_64-apple-darwin
cargo clippy --target x86_64-apple-darwin --workspace --all-targets -- -D warnings
```

Windows job 維持現狀，用來證明 Apple 符號沒有漏出 `cfg`。

若仍要 Swift：補上 `-sdk macosx`、明確 `-lswiftCore` 與它拉進來的那組 Swift 函式庫、rpath 或把 back-deploy 函式庫打進 bundle、部署版本對齊 app 而不是寫死 10.15，並且加上面的 `x86_64` job。這條仍然比 ObjC 脆。

[HIGH] Apple 的 `extern "C"` 若寫在沒有 `#[cfg(target_os = "macos")]` 的位置，Windows `rust-check`（`ci.yml:38`）會因未定義符號失敗。非 macOS 分支回 `ProviderUnsupported`（`plan-stt-providers.md:100`）是對的，符號本身不能進該分支。Windows 的 `cargo test` 要能斷言：provider 為 apple 時回 `ProviderUnsupported`，且不因為空的 `api_key` 先回 `ApiKeyMissing`。

[HIGH] `plan-stt-providers.md:93-95` 回傳 `strdup` 的指標。Rust 端要用匯出的 `typek_apple_speech_free` 釋放。`CString::from_raw` 走 Rust allocator，對 Swift／libc 的 `strdup` 是未定義行為。

[MED] `src-tauri/Cargo.toml` 的 release profile 開了 LTO。Swift object 和 LTO 一起鏈時常失敗；ObjC 靜態庫沒有這個問題。

[LOW] `Cargo.toml` 的 tokio 只開 `time`。`spawn_blocking` 需要 `rt`，目前多半由 tauri 的 feature 合併帶進來。CI 若報缺 `spawn_blocking` 再處理；不要為了猜測去改 `Cargo.toml`（hook 會警告）。

---

## 3. BytePlus 欄位

對的，計畫不用改：

- `X-Api-Sequence: -1`。樣本 `build_asr_request` 有設。
- `X-Api-Resource-Id: volc.seedasr.auc_turbo` 是樣本裡 `seed-asr-fast` 打新加坡 `voice.ap-southeast-1.bytepluses.com` + `/api/v3/auc/bigmodel/recognize/flash` 的值（`models_config.py` 的 `SEED_ASR_MODELS`）。中國區 flash 文件寫的是 `volc.bigasr.auc_turbo`，不要拿來「修正」這份計畫。
- `output_zh_variant` 的 `none`／`traditional`／`tw`／`hk` 在樣本 `SEED_ASR_ZH_VARIANTS`；非 `none` 才送出。
- 熱詞只在語言省略或 `zh-CN` 時送出，與樣本 `SEED_ASR_CONTEXT_LANGUAGES = ("auto", "zh-CN")` 以及 builder 在其他語言丟掉 `corpus` 一致。官方直傳上限是 5000 詞；沿用 `MAX_WHISPER_PROMPT_TERMS` 的 50 個在上限內。單字少於 10 字、禁標點是舊版熱詞表的規則，這次樣本沒有這條閘。實作不要自行加上。
- `20000003` 不在樣本的成功碼 `(0, 20000000)` 裡。計畫把它當成產品層的靜音成功（空字串 + `Some(1.0)`）是對的，但必須在錯誤／重試路徑之外處理。
- 主控台 URL 與樣本 `SPEECH_API_KEYS_CONSOLE_URL` 一致。`user.uid` 用 `typek` 可以。`model_name: bigmodel` 與 resource id 是兩個欄位，計畫都有。`audio.data` 與 `audio.url` 互斥。極速版格式是 raw／wav／mp3／ogg。

[HIGH] `plan-stt-providers.md:47` 與 `:109` 把 `result` 當成陣列並取第一個，單元測試還把「陣列 result」列成案例。樣本 parser 是 `result.get("text")`／`utterances`／`additions`，flash 文件範例也是物件 `{text, utterances}`。陣列形狀出現在標準版 submit／query 文件，不是這次的 flash。只做 `result[0]` 時，正式的物件回應會被解析成空文字。解析器以物件的 `result.text` 為主；若真的收到陣列，再取第一個元素的 `text`。測試兩種都要有，物件是主要案例。

[HIGH] 狀態在回應標頭 `X-Api-Status-Code`，HTTP 經常是 200。`plan-stt-providers.md:67` 說 `55000031` 視同 `ServerError` 走共用重試，`:108` 又把非成功碼塞進現有 `ApiError(status, body)`。現有重試看的是 HTTP 429／5xx（`transcription.rs:324-358`），`ApiError` 的 Display 是 `Groq API returned error ({http}): {body}`（`transcription.rs:54`）。HTTP 200 加 body 裡的 `55000031` 不會重試；`errorUtils.ts:63-71` 用第一個括號數字，會看到 200，然後落到一般失敗，看不到 `45000010`。

要做的事：

- 先讀標頭 `X-Api-Status-Code`（記錄 `X-Tt-Logid`，不要記錄 API key）。
- `20000000`：成功，`no_speech_probability = None`。
- `20000003`：空字串 + `Some(1.0)`，不重試。
- `55000031` 以及其餘 `550xxxx`：可重試。只列 `55000031`（`plan-stt-providers.md:67`）會漏掉同族的忙碌碼。
- `45000010` 與 HTTP 401：金鑰錯。Display 放固定字樣，讓 `errorUtils.ts:56` 不必猜括號裡的 HTTP 狀態。`45000001` 參數、`45000002` 空音訊、`45000151` 格式，各自固定字樣。`45000002` 不是靜音成功。
- `20000001`／`20000002` 是標準版 submit／query 的等待碼。極速版不應走輪詢；收到就當錯誤。

[HIGH] `plan-stt-providers.md:75-79` 與 `:99` 的 `auto` 列依賴「介面是不是 zh-TW」，但新參數只有 `transcription_locale`。`plan-stt-providers.md:120` 規定 auto 時前端傳字串 `"auto"`。Rust 沒有介面語言，無法決定 BytePlus 要不要送 `output_zh_variant=tw`，也無法決定 Apple locale。補一個 `interface_locale`，或改由前端傳已經解析好的有效 locale（auto 不再把字串 `"auto"` 送進 Rust）。缺省（舊前端沒帶）視同 groq 現況：`provider` 缺省 groq，`transcription_locale` 缺省時沿用現有 `language`。

[MED] `plan-stt-providers.md:73` 的 UUID 只有 32 個十六進位字元加連字號，沒有 version nibble `4` 與 variant `10xx`。請求 id 主要靠唯一；若伺服器驗 UUID v4，會被拒。在同一個手寫函式裡設這兩個 nibble 即可，不必加 crate。

[MED] `plan-stt-providers.md:74` 讀不到 `fmt ` 就填 16000／16／1。`encode_wav`（`audio_recorder.rs`）的 sample rate 可以是裝置原生速率，不是永遠 16000。標錯 rate 會把音訊拉長或壓短。解析失敗就回錯誤。TypeK 自己的 WAV 是 16-bit mono；bits 不是 16 或 channel 不是 1／2 也回錯誤。`hound` 已是直接依賴，用手寫 parser 可以，前提是測試含非 16000 的 `fmt `。

[MED] 共用 `MAX_AUDIO_FILE_SIZE` 25MB（`transcription.rs:13`）與 `FileTooLarge` 文案（`transcription.rs:48`，`errorUtils.ts:58`）。BytePlus 極速版是 100MB／2 小時，25MB 對短口述仍夠，但錯誤文案會把 BytePlus／Apple 的失敗說成 Groq 的上限。Apple 的實際上限是上面的約一分鐘，不是 25MB。上限與文案要依 provider 分。

[MED] 連線測試送 1 秒靜音（`plan-stt-providers.md:90`，現有實作 `transcription.rs:525-528` 用 `encode_wav`）。`20000000` 與 `20000003` 都算金鑰有效。全零 WAV 也可能回 `45000002`（空音訊）。`45000002` 在連線測試要顯示「金鑰已被接受、音訊被拒」或改送一段非靜音的極短 WAV，不要顯示金鑰無效。

[MED] `output_zh_variant=tw`（以及 Apple `zh-TW`，輸出常常已是繁體）之後，簡轉繁仍會再跑一次：`useVoiceFlowStore.ts:1158`、`:1518`，`useHistoryStore.ts:765`。OpenCC 對已經是繁體的字會再做一輪一對多轉換。BytePlus 這次已經輸出 `tw`、或 Apple locale 是 `zh-TW` 時，跳過這三次 raw text 轉換。`enhancer.ts:244` 轉的是 LLM 輸出，維持不變。

[LOW] `transcription.rs:52` 的 `RequestFailed` Display 仍寫 "Groq API request failed"。`errorUtils.ts:75-81` 會把它映成一般網路錯誤，使用者看不到 Groq。Apple／BytePlus 的傳輸失敗可以繼續走這條。金鑰與業務碼不要走這條。

---

## 4. `no_speech_probability: Option<f64>` 的連帶

計畫點到的前端是對的：`src/types/audio.ts:22`、`useVoiceFlowStore.ts:1188` 與 `:1195` 的 `toFixed`、`hallucinationDetector.ts:38` 與 `:236` 在 null 時跳過 Layer 2b。serde 維持欄位存在、值為 `null`。不要加 `skip_serializing_if`，否則前端拿到的是 `undefined`，型別對不上 `number | null`。

[HIGH] `transcription.rs:346` 的 `{no_speech_probability:.3}` 在 `Option<f64>` 上編不過。`attempt_transcription_request` 的回傳仍是 `(String, f64)`（`transcription.rs:194`、`:290`）。測試字面 `transcription.rs:613` 的 `no_speech_probability: 0.01` 要改成 `Some(0.01)`。Rust 單元測試要序列化一筆 `Some` 與一筆 `None`，斷言 JSON 是數字與 `null`。

[MED] `Some(1.0)` 只出現在文字已經是空的時候（`plan-stt-providers.md:70-71`）。空文字在幻聽偵測之前就返回：`useVoiceFlowStore.ts:1162`、`:1522`。非空的 Apple／BytePlus 文字 NSP 是 `null`，Layer 2b 不會觸發，只剩 Layer 1 與 2a。這是可接受的降級。不要為了讓 2b 運作，把成功結果填成 `1.0`。

計畫已列的前端測試要保留，並補 null 案例：`tests/unit/hallucination-detector.test.ts`、`tests/unit/use-voice-flow-store.test.ts`（多處 fixture 仍是數字，型別放寬成 `number | null` 後數字 fixture 仍可編過）、`tests/unit/use-history-retry.test.ts:85`。HUD 重送（`useVoiceFlowStore.ts:1537`）與歷史（`useHistoryStore.ts:785`）沒有 `toFixed`，但參數型別要接受 `null`。

---

## 6. 漏掉的呼叫點與測試

[HIGH] `plan-stt-providers.md:117` 的 `getSttApiKey()` 在 apple 回空字串。現有閘門是 `if (!apiKey)`：`useVoiceFlowStore.ts:1126-1138`、`:1482-1490`，`useHistoryStore.ts:733-738`。只把取值換成 `getSttApiKey()` 的話，macOS 內建永遠被當成缺金鑰。閘門用 `hasSttCredential`（apple 恆真）。Rust 側空 `api_key` 只在 groq／byteplus 拒絕（`transcription.rs:445`、`:480`、`:521`），而且要在 provider 判斷之後。

[HIGH] `plan-stt-providers.md:121`「目前檢查 Groq 金鑰的地方改看 `hasSttCredential`」範圍過大。要改的是轉錄入口：

- `src/main-window.ts:70` 啟動導向
- 上面三條轉錄路徑
- `SettingsView.vue:1269-1270` 測試按鈕的 `disabled` 與傳入的 key

不要改 Groq 金鑰卡與 onboarding（`SettingsView.vue:365-372`、`:1201`、`:1332`），也不要改 `hasApiKey`／`getApiKey` 的意義。LLM 在 provider 為 groq 時仍讀 Groq 金鑰（`useSettingsStore.ts:140`、`:206`）。

[HIGH] `refreshApiKey`（`useSettingsStore.ts:620-624`）只讀 `groqApiKey`。上面三條路徑在記憶體金鑰是空的時候會呼叫它。BytePlus 要有自己的 refresh，或讓這三條路徑依當前 provider 重讀對應的鍵。`loadSettings` 與 `refreshCrossWindowSettings`（`useSettingsStore.ts:1345` 起，`:1355` 只讀 `groqApiKey`）都要讀 `sttProviderId` 與 `byteplusApiKey`。

[HIGH] `src/types/events.ts:21` 的 `SettingsKey` 沒有 `sttProviderId`／`byteplusApiKey`。存檔若 `emit(SETTINGS_UPDATED)` 用新 key，`vue-tsc` 失敗。要嘛把這兩個字面量加進聯集，要嘛沿用既有 key 的形狀並在文件寫明。

[HIGH] 用量寫錯模型，額度也會把非 Groq 算進去。

- `transcriptions` 沒有 model 欄（`database.ts:114-127`）。模型在 `api_usage.model`。
- 即時寫入仍用 `selectedWhisperModelId`：`useVoiceFlowStore.ts:846-861`。
- 歷史重轉 `useHistoryStore.ts:771` 呼叫 `recordWhisperUsage`（`:652-669`），同樣寫 Whisper 模型 id，並用 `calculateWhisperCostCeiling`。
- `DAILY_QUOTA_USAGE_SQL`（`useHistoryStore.ts:142-150`）把當天所有 `api_type = 'whisper'` 加總，`MAX(audio_ms, 10000)` 的 10 秒地板適用每一筆。Apple／BytePlus 若仍寫 `api_type: "whisper"`，會計入 Groq 免費額度。
- 儀表板額度條用的是目前選中的 Groq Whisper 模型上限：`DashboardView.vue:86-100`。provider 不是 groq 時，這張額度卡要隱藏或標成只統計 Groq。
- `api_type` 的 CHECK 不含新類型（`database.ts:169`）。計畫說不加 migration，所以繼續用 `whisper`，查詢端用 model id 過濾（只統計 Groq 的 Whisper id）。`apple-speech` 與 `seed-asr-fast` 要進 `apiPricing.ts` 的查表並回 0。漏登記時 `calculateWhisperCostCeiling` 用 `0.111`／小時（`apiPricing.ts:20`），再套 10 秒地板。

[HIGH] clippy `too_many_arguments` 預設門檻是 7，CI 是 `-D warnings`（`ci.yml:53`）。`transcribe_audio`（`transcription.rs:436`）、`retranscribe_from_file`（`:471`）、`send_transcription_request`（`:293`）已經是 7 個參數。再加上 `provider` 與 `transcription_locale`（以及問題 3 的介面語言）會讓 `rust-check` 失敗。把新增欄位收進一個參結構，或在這幾個函式上允許該 lint 並寫原因。`test_whisper_connection`（`:516`）同樣要加 provider／locale／key 的規則，否則測試連線仍打 Groq。

[MED] `.claude/rules/ipc.md:49-50` 要改簽章（camelCase 參數、`no_speech_probability` 可空）。`test_whisper_connection` 目前不在表上（`:50` 下一列就是音效）。`ipc.md:10` 要求改 command 時更新此表。`docs/api-contracts-backend.md` 的 `transcribe_audio` 小節一併改，避免兩份契約分歧。

[MED] `src/lib/connectionTest.ts:43-49` 的簽章仍是 `(modelId: WhisperModelId, apiKey: string)`。`SettingsView.vue:1269` 把 `selectedWhisperModelId` 傳進去。三家共用按鈕時，Apple 不需要 Groq 模型 id；後端對非 groq 忽略 `model_id`，用量紀錄也不要寫成 `whisper-large-v3`。

[MED] 前端三條 invoke 的測試要斷言：`provider`、`transcriptionLocale`（或改後的有效 locale）、`whisperPrompt` 只在 groq、字典詞三家都傳、Apple 不因空 key 失敗、BytePlus 用 BytePlus key。Rust 測試除計畫 `:109` 已列的項目外，補：物件 `result`、HTTP 200 + `55000031` 被分成可重試、`20000003` 不重試、`Option` 的 JSON、非 macOS 的 `ProviderUnsupported`。Swift／ObjC 辨識本身不在 CI 跑（沒有麥克風）；macOS CI 只保證編過與鏈過。

[LOW] `NSSpeechRecognitionUsageDescription` 是系統對話框，只有英文（`plan-stt-providers.md:107`）。不要把它放進七語系 key 一致性測試。App 內錯誤文案仍走七語系。

[LOW] `plan-stt-providers.md:120` 寫的行號：即時 invoke 在 `useVoiceFlowStore.ts:1145`，HUD 重送 invoke 在 `:1501`，歷史在 `useHistoryStore.ts:746`。實作以符號為準。
