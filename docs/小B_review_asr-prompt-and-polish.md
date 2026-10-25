我先對照規格與 `0f22367` 之後的 diff，只看小D 的改動，不改任何檔案。規格已讀完。接下來對照 `0f22367` 之後的 diff，並把小D 的改動和更早的重新命名分開。`0f22367` 之後只有 13 個檔案有 diff，範圍和計畫大致對得上。我接著逐檔讀實作與測試。審查結論：A–D 都照規格落地，沒有 HIGH 或 MED。可以合入。前置句與精簡 prompt 的文案和計畫逐字相同，三個轉錄呼叫點都傳 `whisperPrompt`，Rust 在 trim 後非空時優先使用它。

## Findings

- [LOW] `src/stores/useVoiceFlowStore.ts:1836` — 重送整理讀了 `selectedLlmModelId`，沒有寫與 `:1463` 相同的診斷日誌。失敗後重送的那一次仍看不出 provider／model。在 `enhanceText` 之前補同一行 `writeInfoLog`，只記 provider、model、promptMode、有效辨識語言、hasContext。
- [LOW] `src/lib/whisperPrompt.ts:10` — 前置句是完整口語句。純靜音會被現有幻覺偵測擋下（短於 1 秒且超過 10 字，或 peak 低於 0.01）；peak ≥ 0.03 且時長 ≥ 1 秒時，「以下是…」或「剛才提到…」仍可能被抄進逐字稿。這是規格選的前文形態，先用近靜音樣本量測，先不要改文案。
- [LOW] `src/i18n/prompts.ts:180` — 例子「太普 K」→「TypeK」是產品專名。規則已要求有依據才改、沒依據保留原文，但留在 Groq Qwen 的舊使用者仍可能把無關句子套成 TypeK。文案是規格原文；若 20 段錄音出現誤套，下一輪再拿掉專名。

## 與計畫對照

- A. 符合。`buildWhisperPrompt` 的 zh-TW／zh-CN 基本句、`剛才提到`／`刚才提到`、頓號、空字典仍送基本句、其他語系 `null`、詞段 80 字元（含「、」、`Array.from` 碼位）、由高到低放入後反轉，都與規格一致。三個呼叫點是即時 `transcribe_audio`（`:1300`）、重送 `retranscribe_from_file`（`:1775`）、歷史重轉（`useHistoryStore.ts:751`），都用該檔既有的 `getEffectiveTranscriptLocale`。`auto` 會先回到介面語言，不會把字串 `"auto"` 送進組句；`yue` 不在表內，回 `null`。Rust `select_whisper_prompt`（`transcription.rs:115`）trim 後非空才採用前端稿，否則走原 `format_whisper_prompt`。IPC 兩列已加 `whisper_prompt: Option<String>`；前端鍵名是 camelCase `whisperPrompt`，與既有 `vocabularyTermList` 相同。
- B. 符合。`MINIMAL_TEMPLATES["zh-TW"]` 與計畫程式區塊逐字相同，`${languageRule}` 仍在句尾。舊精簡文的明確句「繁體中文 zh-TW。」與自動句都進了 `isKnownDefaultPrompt`。`<vocabulary>` 說明行與規格一致，詞清單仍是逗號分隔。其他語系與積極模式未改。
- C. 符合。`allocateTermSlots` 先留 `min(10, AI 詞數, limit)`，其餘先給 manual，manual 不夠再由 AI 補到 limit；回傳 manual 在前、AI 在後。`limit` 為 0 回空陣列。`TOP_TERM_LIST_SQL` 已移除。`vocabulary.term` 有 UNIQUE，同一拼寫不會同時出現在兩邊；大小寫不同的兩個詞仍可各占一格。
- D. 符合。即時整理在取得 `llmModelId` 之後寫了 provider、model、promptMode、有效辨識語言、`hasContext`（布林），沒有逐字稿或上下文內容。重送路徑的缺口見上方 LOW。歷史「重新整理」不在本節範圍。

## 正確性

`attempt_transcription_request`、`send_transcription_request`、`transcribe_audio`、`retranscribe_from_file` 都是 7 個參數。Clippy `too_many_arguments` 的預設門檻是 7，超過才警告，這四支剛好在門檻上。diff 沒有新的 `format!`、平台 `cfg` 或未使用項。`select_whisper_prompt` 的 `if let` 加內層 `if` 與這支檔案原本的寫法相同。本機沒有 Rust 工具鏈，這段是閱讀判斷；CI 仍要跑 macOS 與 Windows 的 `cargo clippy --workspace --all-targets -- -D warnings`。

即時測試的預設是辨識語言 `auto`、介面 `zh-TW`，而且斷言了繁中前置句，所以 `auto` 的解析有被釘住。手動詞很長時，80 字預算會先吃掉名單前面的手動詞；保留的 10 個學到的詞在名單尾端，進得了整理用的 50 詞區塊，不一定進得了 Whisper 前置稿。這是「越前面越優先」的結果。

## 提示詞是否會變好

會，而且方向與先前建議一致。空字典不再完全不送；繁中口語句加上「剛才提到…」是 Whisper 會模仿的前文，不是英文指令。基本句 36 字加「剛才提到」加 80 字詞，合計約 121 字，落在尾端 224 token 以內。最高優先詞在句尾。精簡 prompt 拿掉了「不確定就不改」和「在嗎 → 怎麼」，有詞彙或上下文就必須用那些寫法，並保留有作用的「其實、然後、基本上、就是」。

## 測試有沒有釘住行為

有釘住驗收列出的案例：空字典、zh-CN、en／ja／`auto` 為 `null`、截斷後最高優先仍在、反轉後最高優先在尾端、80 字元剛好放滿、manual 占滿時 AI 仍有 10 格、AI 少於 10 時由 manual 補滿、`limit` 為 0、舊版兩個語言規則、vocabulary 說明行、Rust 前端稿優先於字典（空白字串會退回）。即時 `transcribe_audio` 的 payload 也斷言了 camelCase `whisperPrompt`。

還沒釘住的是：歷史重轉與重送轉錄的 payload、`yue`／`ko` 的 `null`（與 en 同一條查表路徑）、以及 manual 很少時 AI 是否補超過保留的 10 個。程式是補到剩餘名額，只是現有測試的 AI 詞數剛好等於保留數，看不出差別。

REVIEW-RESULT: READY
