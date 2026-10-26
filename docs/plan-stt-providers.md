# 計畫：語音轉錄可選 Groq／macOS 內建／BytePlus

> **狀態：定稿 v2（2026-10-26），交小D 實作，小B 審查。**
> 審查：小B `docs/小B_review_plan-stt-providers.md`、小A `docs/小A_review_plan-stt-providers.md`。
> 驗證限制：本機沒有 Rust；Rust／Objective-C 只在 GitHub Actions 驗（見 §D）。

## 需求（Kevin，2026-10-26）

> 語音轉錄部分，讓用戶可以選擇：Groq／macOS 內建的語音辨識（不佔空間，但只有 Mac 版有）／字節跳動 BytePlus。無論用戶選擇哪一個都可以。

## 結果

- 設定頁「語音轉錄」卡最上方多一組「轉錄服務」選項卡：**Groq（預設）**、**macOS 內建**（只在 Mac 顯示）、**BytePlus**
- 選哪一家，即時轉錄、HUD 重送、歷史重新辨識、測試連線都走那一家
- 現有使用者升級後仍是 Groq，零變動
- 後面的 AI 整理、字典、上下文照舊

## v1 → v2 取捨

| 議題 | 小B | 小A | 採用 |
|---|---|---|---|
| macOS 沒下載語言包 | 直接報錯 | 退回 Apple 線上 | **55 秒內退回 Apple 線上；超過報錯並說明下載語言包**（Apple 線上單次約 1 分鐘上限） |
| 原生橋 | Objective-C `.m`（不要 Swift：runtime、rpath、x86_64 交叉編、LTO 都脆） | Swift 加防護 | **Objective-C** |
| 服務選擇器 | — | 比照文字整理卡的 RadioGroup 選項卡 | **照抄文字整理卡現有樣式**，不另出 demo（沿用既有版型，不是新設計；做完截圖給 Kevin） |
| 選項卡副標 | — | 「華語地表最強」等 | 只寫可查證的事實（見 §C.2） |
| BytePlus `result` | 物件為主，陣列相容 | 兩者相容 | 物件為主、陣列相容 |

## 已查證事實

### BytePlus Seed Speech ASR 極速版

來源：BytePlus 官方 GitHub `byteplus-sa/ComfyUI-BytePlus-ModelArk` commit `ccbf08b`（`nodes/constants.py`、`nodes/models_config.py`、`nodes/nodes_speech.py`、`nodes/speech_api.py`）。

- `POST https://voice.ap-southeast-1.bytepluses.com/api/v3/auc/bigmodel/recognize/flash`
- 標頭：`X-Api-Key`（Seed Speech 金鑰，**不是 ModelArk 金鑰**）、`X-Api-Resource-Id: volc.seedasr.auc_turbo`、`X-Api-Request-Id: <UUID v4>`、`X-Api-Sequence: -1`、`Content-Type: application/json`
- 本體：

```json
{
  "user": { "uid": "typek" },
  "audio": {
    "data": "<WAV base64>",
    "format": "wav", "codec": "raw", "rate": <從 WAV 讀>, "bits": 16, "channel": <從 WAV 讀>,
    "language": "<選填>"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true, "enable_punc": true, "enable_ddc": false,
    "show_utterances": false,
    "output_zh_variant": "tw",
    "corpus": { "context": "{\"hotwords\":[{\"word\":\"TypeK\"}]}" }
  }
}
```

- 狀態在**回應標頭** `X-Api-Status-Code`（HTTP 常是 200）；文字在本體 `result.text`（`result` 是物件；若收到陣列取第一個元素的 `text`）
- `output_zh_variant` 可為 `traditional`／`tw`／`hk`；熱詞只允許 `language` 省略或 `zh-CN`

## 範圍

### A. Rust 後端（`src-tauri/src/plugins/transcription.rs`）

**A1. 參數**
- 三個指令 `transcribe_audio`、`retranscribe_from_file`、`test_whisper_connection` 各加選填參數：`provider: Option<String>`（`"groq"`／`"apple"`／`"byteplus"`，缺值或其他 = groq）、`transcription_locale: Option<String>`（`"auto"` 或七個介面語言 id）、`interface_locale: Option<String>`
- 缺 `transcription_locale` 時沿用現有 `language` 行為（舊前端相容）
- 參數超過 7 個：在這幾個函式上加 `#[allow(clippy::too_many_arguments)]`，上一行註解寫「Tauri command 參數直接對應前端 invoke 欄位」
- `api_key` 非空檢查只在 groq／byteplus 做，且在 provider 判斷**之後**；apple 不檢查

**A2. `no_speech_probability: Option<f64>`**
- 序列化保留欄位、值可為 `null`；不要加 `skip_serializing_if`
- `attempt_transcription_request`（Groq）回傳型別改 `(String, Option<f64>)`，Groq 永遠 `Some`
- `transcription.rs` 約 346 行 `{no_speech_probability:.3}` 日誌改成可處理 `None`
- 測試字面 `no_speech_probability: 0.01` 改 `Some(0.01)`；新增序列化測試：`Some` → 數字、`None` → `null`

**A3. BytePlus**
- 不加新 crate。手寫 `base64_encode(&[u8]) -> String`、`uuid_v4() -> String`（`std::time` 奈秒、`AtomicU64` 計數、`RandomState` 雜湊湊 128 bit；設 version nibble `4`、variant `10xx`；格式 8-4-4-4-12），各附單元測試
- 從 WAV `fmt ` chunk 讀 rate／channels／bits；讀不到、bits ≠ 16、channels 不是 1 或 2 → `TranscriptionError::RequestFailed("Unsupported WAV format")`；測試含 16000 與 48000
- 語言對照：

| `transcription_locale` | `audio.language` | `output_zh_variant` | 熱詞 |
|---|---|---|---|
| auto | 不帶 | `interface_locale == "zh-TW"` 時 `tw`，否則不帶 | 帶 |
| zh-TW | `zh-CN` | `tw` | 帶 |
| zh-CN | `zh-CN` | 不帶 | 帶 |
| en | `en-US` | 不帶 | 不帶 |
| ja | `ja-JP` | 不帶 | 不帶 |
| ko | `ko-KR` | 不帶 | 不帶 |
| vi | `vi-VN` | 不帶 | 不帶 |
| th | `th-TH` | 不帶 | 不帶 |

- 熱詞：字典詞清單前 50 個（`MAX_WHISPER_PROMPT_TERMS`），組 `{"hotwords":[{"word":"…"}]}` 後 `serde_json::to_string` 成字串放 `request.corpus.context`；清單空不帶 `corpus`；不自行加長度或標點限制
- `whisper_prompt` 不用
- 回應處理（先讀標頭 `X-Api-Status-Code`，記錄 `X-Tt-Logid`；不記錄金鑰）：

| 狀態 | 結果 |
|---|---|
| HTTP 401 或碼 `45000010` | `TranscriptionError::ProviderAuth("BytePlus")`，不重試 |
| `20000000` | 成功：`result.text` trim，`no_speech_probability = None` |
| `20000003`（靜音） | 空字串、`Some(1.0)`，不重試 |
| `550xxxxx`（任何 55000000–55999999） | 可重試（同 `FailureKind::ServerError`） |
| HTTP 429 | 可重試（同 Groq） |
| HTTP 5xx | 可重試 |
| 其他（含 `45000001`、`45000002`、`45000151`、`20000001`、`20000002`） | `TranscriptionError::ProviderError { provider: "BytePlus", code, message }`，不重試；`message` 取標頭 `X-Api-Message` 或本體前 300 字 |

- 檔案上限：BytePlus 100 MB；Groq 維持 25 MB；`FileTooLarge` 的顯示文字不要寫 Groq
- 測試連線：送 1 秒靜音，`20000000`、`20000003`、`45000002` 都算金鑰有效
- Rust 單元測試：請求 JSON 組裝（上表每一列）、回應解析（物件 result、陣列 result、`20000003`、`45000010`、HTTP 200＋`55000031` 歸為可重試、`45000001` 不重試）

**A4. macOS 內建（Objective-C 橋）**
- 新檔 `src-tauri/native/apple_speech.m`（ARC），匯出 C 函式：
  - `int32_t typek_apple_speech_auth_status(void)`：回 `SFSpeechRecognizerAuthorizationStatus`（0 未決定、1 拒絕、2 受限、3 已授權）
  - `int32_t typek_apple_speech_request_auth(int32_t timeout_secs)`：未決定時呼叫 `requestAuthorization`，用 `dispatch_semaphore` 等結果，回最終狀態；**只能在非主執行緒呼叫**（Rust 一律從 `spawn_blocking` 呼叫）
  - `char *typek_apple_speech_transcribe(const char *wav_path, const char *locale_id, const char *contextual_terms /* \n 分隔，可 NULL */, int32_t audio_ms, int32_t timeout_secs, int32_t *out_error_code)`：成功回 `strdup` 的 UTF-8 文字；失敗回 NULL 並設錯誤碼
  - `void typek_apple_speech_free(char *ptr)`：`free()`。Rust **只能**用這個釋放，不可 `CString::from_raw`
- 辨識流程：
  1. 授權狀態不是 3 → 錯誤碼 `1 NOT_AUTHORIZED`（不在錄音流程裡跳授權對話框；授權在設定頁做，見 §C.4）
  2. `SFSpeechRecognizer initWithLocale:`；nil 或 `!isAvailable` → `2 LOCALE_UNSUPPORTED`
  3. `supportsOnDeviceRecognition` 為真 → `requiresOnDeviceRecognition = YES`
  4. 否則（沒有本機語言包）：`audio_ms > 55000` → `5 NEEDS_LANGUAGE_PACK`；否則用 Apple 線上辨識
  5. `SFSpeechURLRecognitionRequest`，`shouldReportPartialResults = NO`、`contextualStrings` = 字典詞、macOS 13+ `addsPunctuation = YES`（`@available` 判斷）
  6. `dispatch_semaphore` 等 `isFinal` 或錯誤；逾時取消 task → `4 TIMEOUT`；辨識錯誤 → `3 RECOGNITION_FAILED`
  7. 結果為空 → 回空字串（不是錯誤）
- Rust 端（全部在 `#[cfg(target_os = "macos")]` 內宣告 `extern "C"` 與呼叫）：
  - `transcribe_audio`：WAV 位元組寫到 `std::env::temp_dir()` 的唯一檔名（`typek-apple-<uuid_v4>.wav`），用實作 `Drop` 的守衛刪檔（任何返回路徑都刪）
  - `retranscribe_from_file`：直接用原檔路徑
  - `audio_ms` 由 WAV 資料長度與 fmt 算出
  - 呼叫放 `tokio::task::spawn_blocking`；逾時 30 秒
  - 結果：文字非空 → `None`；空 → 空字串、`Some(1.0)`
  - 錯誤碼對應 `TranscriptionError::AppleSpeech { code, reason }`，`reason` 為 `not_authorized`／`locale_unsupported`／`recognition_failed`／`timeout`／`needs_language_pack`
- locale：zh-TW→`zh-TW`、zh-CN→`zh-CN`、en→`en-US`、ja→`ja-JP`、ko→`ko-KR`、vi→`vi-VN`、th→`th-TH`；`auto` 用 `interface_locale` 同表對照（Apple 沒有自動偵測）
- 非 macOS：provider 為 apple → `TranscriptionError::ProviderUnsupported`（在 api_key 檢查之前回）；Windows 的 `cargo test` 要有這條測試
- 新指令（只在 macOS 有實作；非 macOS 回 `ProviderUnsupported`）：`apple_speech_auth_status() -> i32`、`apple_speech_request_auth() -> i32`（`spawn_blocking`），註冊到 `lib.rs`
- 測試連線（apple）：授權狀態必須是 3，且 locale `isAvailable`；不送音訊。為此再匯出 `int32_t typek_apple_speech_locale_available(const char *locale_id)`（1／0）

**A5. 建置（`src-tauri/build.rs`）**
- 只在 `env::var("CARGO_CFG_TARGET_OS") == "macos"`（不是 `#[cfg]`）：
  - `arch`：`CARGO_CFG_TARGET_ARCH` `aarch64`→`arm64`、`x86_64`→`x86_64`
  - `xcrun --sdk macosx clang -c -fobjc-arc -arch <arch> -mmacosx-version-min=10.15 -O2 native/apple_speech.m -o $OUT_DIR/apple_speech.o`
  - `xcrun libtool -static -o $OUT_DIR/libtypek_apple_speech.a $OUT_DIR/apple_speech.o`
  - `cargo:rustc-link-search=native=$OUT_DIR`、`cargo:rustc-link-lib=static=typek_apple_speech`、`cargo:rustc-link-lib=framework=Foundation`、`cargo:rustc-link-arg=-Wl,-weak_framework,Speech`（弱連結：舊 macOS 沒有 Speech 也能啟動）
  - `cargo:rerun-if-changed=native/apple_speech.m`
  - 指令失敗就 `panic!` 並印出 stderr
- 保留現有 `CoreAudio` 連結與 `tauri_build::build()`
- `src-tauri/Info.plist` 加 `NSSpeechRecognitionUsageDescription`：「TypeK uses speech recognition to transcribe your voice when you choose macOS built-in transcription.」（系統對話框只有英文，不進七語系）

**A6. 錯誤型別**
- `TranscriptionError` 新增 `ProviderUnsupported`、`ProviderAuth(String)`、`ProviderError { provider, code, message }`、`AppleSpeech { code, reason }`，Display 使用固定英文字樣，讓前端 `errorUtils` 能辨認（例如 `ProviderAuth` → `"Provider authentication failed (BytePlus)"`、`AppleSpeech` → `"Apple speech error (needs_language_pack)"`）
- 現有 `ApiError` 的 Display 只用在 Groq

### B. 前端資料層

1. `src/lib/modelRegistry.ts`：`SttProviderId = "groq" | "apple" | "byteplus"`；`STT_PROVIDER_LIST`（apple `macOnly: true`）；`DEFAULT_STT_PROVIDER_ID = "groq"`；`STT_PROVIDER_USAGE_MODEL_ID`：apple `"apple-speech"`、byteplus `"seed-asr-fast"`
2. `useSettingsStore`：
   - `selectedSttProviderId`（store 鍵 `sttProviderId`；缺值／非法 = groq；非 Mac 讀到 apple → groq 並寫回，寫回用 `store.set`＋`store.save`，不 emit）
   - `byteplusApiKey`（store 鍵 `byteplusApiKey`，只存 tauri-plugin-store）、`saveByteplusApiKey`、`deleteByteplusApiKey`
   - `saveSttProvider(id)`
   - `getSttApiKey()`：groq→Groq 金鑰、byteplus→BytePlus 金鑰、apple→`""`
   - `hasSttCredential`（computed）：groq→有 Groq 金鑰、byteplus→有 BytePlus 金鑰、apple→`true`
   - `refreshSttApiKey()`：依目前 provider 重讀對應鍵（groq 沿用 `refreshApiKey`）
   - `loadSettings` 與 `refreshCrossWindowSettings` 都讀 `sttProviderId`、`byteplusApiKey`
   - `hasApiKey`／`getApiKey` 意義不變（仍是 Groq 金鑰，LLM 用 groq 時要用）
3. `src/types/events.ts` 的 `SettingsKey` 加 `"sttProvider"`、`"byteplusApiKey"`；存檔後 emit `SETTINGS_UPDATED`
4. 三條轉錄路徑（`useVoiceFlowStore.ts` 即時 `transcribe_audio`、HUD 重送 `retranscribe_from_file`；`useHistoryStore.ts` 歷史 `retranscribe_from_file`）：
   - 缺金鑰閘門改用 `hasSttCredential`；記憶體缺金鑰時呼叫 `refreshSttApiKey()`
   - invoke 多傳 `provider`、`transcriptionLocale`（`selectedTranscriptionLocale`，可為 `"auto"`）、`interfaceLocale`（`selectedLocale`）；`apiKey: getSttApiKey()`
   - `whisperPrompt` 只在 groq 傳；字典詞三家都傳；`modelId` 只在 groq 傳
   - `applyTranscriptTextTransforms`（簡轉繁）只在 provider 為 groq 時套用
5. `src/main-window.ts` 約 70 行啟動導向：改看 `hasSttCredential`
6. `noSpeechProbability: number | null`：`src/types/audio.ts`、`useVoiceFlowStore` 兩處 `toFixed()` 日誌（null 印 `n/a`）、`hallucinationDetector` Layer 2b 在 null 時跳過、HUD 重送與歷史路徑的參數型別；搜尋 `noSpeechProbability` 所有用處一併處理
7. 用量（不加 DB migration；`api_type` 仍寫 `whisper`）：
   - 即時（`useVoiceFlowStore` 約 846–861 行）與歷史重轉（`useHistoryStore` `recordWhisperUsage`）寫入的 model：groq 照舊；apple `apple-speech`；byteplus `seed-asr-fast`
   - `apiPricing.ts`：這兩個 id 成本 0，不套 10 秒地板
   - `DAILY_QUOTA_USAGE_SQL`（`useHistoryStore` 約 142 行）只加總 Groq Whisper 模型 id（`whisper-large-v3`、`whisper-large-v3-turbo`）
   - `DashboardView.vue` 約 86–100 行的 Groq 額度卡：provider 不是 groq 時隱藏
8. `src/lib/connectionTest.ts`：簽章改 `(provider, apiKey, modelId?)`；apple 呼叫授權狀態＋locale 檢查（後端 `test_whisper_connection` 帶 provider）
9. `errorUtils.ts` 新增轉譯（七語系文案）：
   - `ProviderAuth (BytePlus)` → 「BytePlus 金鑰無效，請確認是 Seed Speech 的 API Key（不是 ModelArk 金鑰）」
   - `ProviderError (BytePlus)` → 「BytePlus 轉錄失敗（錯誤碼 {code}）」
   - `Apple speech error (not_authorized)` → 「TypeK 沒有語音辨識權限，請到設定頁授權」
   - `(locale_unsupported)` → 「macOS 內建語音辨識不支援這個語言，請改用 Groq 或 BytePlus」
   - `(needs_language_pack)` → 「這段錄音超過 55 秒，需要先下載聽寫語言包：系統設定 → 鍵盤 → 聽寫」
   - `(timeout)` → 「macOS 語音辨識逾時，請重試或改用 Groq」
   - `(recognition_failed)` → 「macOS 語音辨識失敗，請重試」
   - `ProviderUnsupported` → 「這台電腦不支援 macOS 內建語音辨識」
   - 現有 `FileTooLarge` 文案移除「Groq」字樣

### C. 設定頁（`SettingsView.vue`，用既有 shadcn-vue 元件）

1. 「語音轉錄」卡最上方：**照抄「文字整理」卡的 provider RadioGroup 樣式**（同 class、同選中樣式）。Mac 三格 `grid-cols-3`、Windows 兩格 `grid-cols-2`
2. 每格名稱下一行小字副標（七語系）：
   - Groq：「免費額度 · 需金鑰」
   - macOS 內建：「免金鑰 · 只限 Mac」
   - BytePlus：「付費 · 可輸出台灣繁體」
3. 選中後顯示：
   - **Groq**：現有金鑰欄＋模型選單（不變）
   - **BytePlus**：金鑰欄（顯示／隱藏、儲存、刪除，行為照 Gemini 金鑰欄）；說明「請到 BytePlus Seed Speech 主控台建立 API Key（不是 ModelArk 金鑰）」＋連結 `https://console.byteplus.com/voice/new/setting/apikeys`；「錄音會上傳到 BytePlus 新加坡伺服器轉錄。」
   - **macOS 內建**：授權狀態列（進入此選項與按「測試連線」時呼叫 `apple_speech_auth_status`）：
     - 未決定：按鈕「授權語音辨識」→ `apple_speech_request_auth`
     - 已拒絕／受限：警示＋按鈕「打開系統設定」→ 開 `x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition`（用專案既有開外部連結的方式）
     - 已授權：「已授權」
     - 說明：「免金鑰、免費。已下載聽寫語言包的語言在本機辨識；沒有語言包時改由 Apple 線上辨識（錄音會上傳到 Apple，單次最多 55 秒）。語言包在 系統設定 → 鍵盤 → 聽寫 下載。」
4. 模型｜語言雙欄維持不變：非 groq 時左欄改成唯讀資訊（BytePlus「Seed ASR 極速版」、macOS「Apple 語音辨識」），右欄仍是轉錄語言選單，避免版面跳動
5. 卡片狀態徽章依 provider：groq／byteplus 看各自金鑰（已設定／未設定）；apple 看授權（已授權／需授權）
6. 首次使用的 Groq 申請引導（`shouldShowOnboardingHint`）只在 provider 為 groq 且沒有 Groq 金鑰時顯示
7. 「測試連線」按鈕：`disabled` 改看 `hasSttCredential`；傳 provider 與對應金鑰
8. **「文字整理」卡**：LLM 選 groq 且轉錄服務不是 groq 時，原本「使用語音轉錄的 Groq API Key」提示改成**完整 Groq 金鑰欄**（重用轉錄卡同一組儲存／刪除／顯示處理）
9. 七語系文案；`zh-TW` 為準

### D. CI 與文件

1. `.github/workflows/ci.yml`：
   - `push.branches` 改 `[main, "feat/**"]`
   - macOS 的 `rust-check` 在現有步驟後加：`rustup target add x86_64-apple-darwin` 與 `cargo clippy --target x86_64-apple-darwin --workspace --all-targets -- -D warnings`
2. `.claude/rules/ipc.md` 契約表：三個指令的新參數、`no_speech_probability` 可空、兩個新 Apple 指令；`docs/api-contracts-backend.md` 同步

### E. 測試

- Rust：§A2、§A3 列的全部；非 macOS 的 apple → `ProviderUnsupported`（且不先回 `ApiKeyMissing`）；provider 字串解析；WAV fmt 解析；`uuid_v4` 格式與 version／variant；`base64_encode` 對照已知值
- 前端：
  - store：預設 groq、非法值、非 Mac 讀到 apple、`getSttApiKey`、`hasSttCredential`、跨視窗刷新讀新鍵
  - 三條路徑：`provider`、`transcriptionLocale`、`interfaceLocale` 正確；`whisperPrompt` 與 `modelId` 只在 groq；字典詞三家都傳；apple 不因空金鑰被擋；byteplus 用 BytePlus 金鑰；非 groq 不套簡轉繁
  - 幻聽守衛：`noSpeechProbability: null` 不觸發 Layer 2b、不丟例外
  - 用量：apple／byteplus 不計入 Groq 每日額度、成本 0
  - `connectionTest` 三家
  - 設定頁：轉錄非 groq 且 LLM 為 groq 時，文字整理卡出現 Groq 金鑰欄
  - errorUtils 新轉譯
  - 七語系 key 一致性（既有測試）

## 不做

- macOS 26 `SpeechAnalyzer`、Swift 橋
- BytePlus 標準版（submit／query）、串流
- Windows 本機辨識
- 價格數字文案、新 DB migration
- 另出 HTML demo（沿用文字整理卡既有樣式）

## 驗收

1. 前端：`npx vue-tsc --noEmit`、eslint、`npx vitest run` 全綠；`jq -e .` 七語系
2. Rust＋Objective-C：推到 `feat/stt-providers` 分支後 CI 全綠（macOS host、macOS x86_64 clippy、Windows）——**推分支需 Kevin 授權**
3. 實機（Kevin，裝測試版）：BytePlus 繁中與熱詞、macOS 授權流程與本機／線上辨識、三條路徑切換、Groq 照舊
