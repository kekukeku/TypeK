# 小 B 建議：TypeK 語音轉錄要不要換供應商

查核日期：2026-10-26。只做研究，沒有改程式。價格與額度都來自當日打開的官方頁；推算的每小時價錢會註明是算術。沒有實測延遲，也沒有拿 Kevin 的台灣國語＋英文夾雜錄音做 A/B。標「未確認」的句子不要當成事實。

現況（`src-tauri/src/plugins/transcription.rs`、`src/i18n/languageConfig.ts`）：按住說話、放開後把短 WAV 以 multipart 丟到 `https://api.groq.com/openai/v1/audio/transcriptions`，模型 `whisper-large-v3`，可帶 `language` 與 `prompt`，`response_format=verbose_json`，用 `segments[].no_speech_prob` 做幻覺過濾。繁中與簡中都送 Whisper 的 `zh`（沒有 `zh-TW`）。詞彙最多 50 個、塞進 prompt 尾端（Whisper 只看最後 224 token）。後面還有 LLM（預設 Gemini 3.1 Flash-Lite）整理文字。

## 排序

1. **預設維持 Groq `whisper-large-v3`。** 以「持續免費、額度夠一個人天天聽寫、延遲、zh/en/ja/ko/vi/th、已經接好」一起看，沒有免費方案明顯全面勝出。
2. **同一個 Groq key 加上 `whisper-large-v3-turbo`，只當 429 備援。** 同一支 multipart，改模型字串即可。Groq 自己的表上它比較快、比較便宜，詞錯誤率比較差（12% 對 10.3%），而且不能做翻譯。不要拿它當準確度預設。
3. **免費實驗只做一個：Gemini `gemini-3.5-transcribe`。** 定價頁寫免費層不收費，有自訂詞彙，語言表含英文、日、韓、越、泰、簡體中文、粵語繁體。語言表沒有 `cmn-Hant-TW`。免費層的每分鐘／每日上限頁面沒寫。API 不是現在這支 multipart。過了 A/B 再考慮，不要直接換預設。
4. **願意付費時，第一個外掛用 Deepgram Nova-3 預錄。** 註冊送 $200、沒有到期日、免信用卡。預錄多語 $0.312／小時，關鍵詞另加 $0.078／小時。中英夾雜要走 `language=multi`；這份多語清單有簡體中文，沒有 `zh-TW`。單語 `zh-TW` 在 2026-03-31 的更新說明裡有。先用 $200 測「繁體字形」和「英文專有名詞」，再決定要不要留。
5. **程式改動最小的付費備案是 OpenAI `gpt-transcribe`（$0.27／小時）。** 同一個 `/audio/transcriptions` 家族，但欄位是 `languages` 與 `keywords`，而且很可能沒有現在這個 `no_speech_prob`。沒有免費層。
6. **端側先不要當預設。** 磁碟緊。`whisper.cpp` 官方模型表：`large-v3` 2.9 GiB、`large-v3-q5_0` 1.1 GiB、`large-v3-turbo` 1.5 GiB、`large-v3-turbo-q5_0` 547 MiB。準確度不會高過雲端同一套 Whisper，Windows CPU 還會更慢。macOS 26 的 `SpeechAnalyzer` 不必自帶數 GB 模型，但只有 Mac、越南文／泰文覆蓋未確認，也不能服務 Windows 使用者。

## 免費

### Groq（基準，建議繼續當預設）

官方文件（2026-10-26 打開）：

| 項目 | `whisper-large-v3` | `whisper-large-v3-turbo` |
| --- | --- | --- |
| 付費單價 | $0.111／音訊小時 | $0.04／音訊小時 |
| 官方詞錯誤率 | 10.3% | 12% |
| 官方即時速度倍數 | 189 | 216 |
| 翻譯成英文 | 可以 | 不行 |
| 語言 | 多語；`language` 用 ISO-639-1，例如 `zh`、`en`、`ja`、`ko`、`vi`、`th` | 同左 |
| 詞彙 | `prompt`，最多 224 token，官方說是風格與拼字引導，不是硬性關鍵詞 | 同左 |
| 回應 | `json`、`verbose_json`、`text`；`verbose_json` 有 `no_speech_prob` | 同左 |

額度：本次打開的 [rate limits](https://console.groq.com/docs/rate-limits) 只呈現一組數字，whisper 兩型都是 **20 RPM、2,000 RPD、每小時 7,200 音訊秒、每天 28,800 音訊秒**（7,200 秒＝2 小時音訊／時鐘小時；28,800 秒＝8 小時音訊／日）。同頁正文寫「下表是 Developer 方案的基礎額度」，又寫升級 Developer 可以拿到更高額度。第三方於 2026-10-17 對照分頁，把這組數字標成免費方案，並寫 Developer 的 `whisper-large-v3` 是 300 RPM／200K RPD／每小時 200K 音訊秒／每天 4M 音訊秒（[GrabAICredits](https://grabaicredits.com/en/deals/groq-api-free-tier)）。**兩份來源衝突。付費能不能解開 429，要看 `console.groq.com/settings/limits`，未確認。** 檔案上限：免費 25 MB、Developer 100 MB。付費最短計費 10 秒，短於 10 秒仍算 10 秒。

對 TypeK：一個人聽寫，8 小時音訊／日遠大於實際用量。會痛的是 20 RPM（放開按鍵太密，再加上現有的 429 重試）以及 Whisper 的老問題：`zh` 不分台灣／大陸，prompt 不是真的關鍵詞加權，中英夾雜時英文專名會掉或被寫成近音漢字。這些後面的 LLM 已經在補。換一顆「也是 Whisper、額度更小」的免費 API，不會比這顆好。

### 同一個 Groq key 的 turbo，只當備援

429 時改打 `whisper-large-v3-turbo`。請求形狀不變。它不是準確度升級。Groq 公布的詞錯誤率沒有標測試集，更沒有台灣國語分數。

### Gemini `gemini-3.5-transcribe`（唯一值得花時間試的免費雲端）

[定價頁](https://ai.google.dev/gemini-api/docs/pricing)（頁尾更新 2026-10-22，2026-10-26 打開）：檔案轉錄免費層「Free of charge」。付費估算混合價約 **$0.005／分鐘（算術 $0.30／小時）**。即時版 `gemini-3.5-transcribe-live` 免費層同樣不收費，付費估算約 $0.009／分鐘（$0.54／小時）；按住說話用不到 WebSocket。免費層「會用來改進產品」；付費層標 No。

[模型頁](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe)（2026-10-26 搜尋語言表）：自動語言偵測、句中換語、自訂詞彙。有 `vi-VN`、`th-TH`、`ja-JP`、`ko-KR`、`cmn-Hans-CN`、`yue-Hant-HK`、英文。**搜尋 `Taiwan`／`Hant` 沒有 `cmn-Hant-TW`。** 免費層的 RPM、每日音訊上限，定價頁沒寫。API 是上傳檔案再 `generateContent`，不是現在的 multipart，也沒有 `no_speech_prob`。

不要把「ASR＋潤稿」合成一次 Gemini 呼叫。靜音／噴麥時，一般生成模型容易回一句閒聊；TypeK 現在靠 `no_speech_prob` 丟掉這類片段。若要試，試的是專用轉錄模型，潤稿步驟留著。

### 額度不夠當預設的免費或試用

| 方案 | 官方寫的免費量 | 為什麼不當預設 |
| --- | --- | --- |
| Azure Speech F0 | 語音轉文字標準＋自訂合計每月 5 音訊小時，同時 1 連線，批次不支援。[定價頁](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) 2026-10-26 | 比 Groq 的每天 8 小時少一個數量級。付費美元數字在英文頁呈現為 `$-`，本次沒有看到具體單價，不引用 |
| Google Cloud Speech-to-Text V1 | 標準模型每月 60 分鐘（有／無資料記錄各一列）。[定價頁](https://cloud.google.com/speech-to-text/pricing) | V2 標準辨識表從 $0.016／分鐘起，沒有 $0 級距。新帳號 $300 點數是整個 GCP，不是每月重置的 STT 額度 |
| ElevenLabs Scribe v2 | API 定價頁 Scribe v2 **$0.22／小時**，keyterm 另 **$0.05／小時**；內含時數最左一欄是 4 小時 30 分。[API pricing](https://elevenlabs.io/pricing/api) | 4.5 小時只夠 A/B。即時版 $0.39／小時。語言是否有台灣繁體代碼，這次定價頁沒列出 |
| Deepgram | 新帳號 **$200**，免信用卡、定價頁寫沒有到期日。[pricing](https://deepgram.com/pricing) | 這是點數，不是每月免費。$200 ÷ $0.312／小時 ≈ 641 小時預錄多語，夠測很久，測完就要付錢 |
| AssemblyAI | 定價頁 FAQ：免信用卡，預錄最多 185 小時、串流最多 333 小時。[pricing](https://www.assemblyai.com/pricing/) | 有沒有每月重置，FAQ 沒寫。較早文件寫 $50 點數。旗艦 Universal-3 Pro 語言是英、西、德、法、義、葡，**沒有中文**。有中文的是 Universal-2，$0.15／小時，含 `zh`、`ja`、`ko`、`th`、`vi`。準確度相對 Groq large-v3 未確認 |
| 阿里雲百煉 `qwen3-asr-flash` | 新加坡：`$0.000035／秒`（算術 **$0.126／小時**），免費 36,000 秒（10 小時），自開通或模型發布起 90 天，其他地域沒有這份免費額度。[model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) | 不是持續免費。即時版新加坡 `$0.000090／秒`（$0.324／小時），同樣 10 小時／90 天 |

Cloudflare Workers AI 的 Whisper、Gladia、Hugging Face 無伺服器推理：這次沒有打開足以引用額度的官方頁，不列入。它們就算能跑，模型仍是 Whisper 家族，不會在準確度上超過 Groq large-v3。

### 端側

**先不要預設下載模型。** 磁碟緊，而且 TypeK 要同時給 macOS 與 Windows。

`whisper.cpp` 模型表（[GitHub models/README](https://github.com/ggml-org/whisper.cpp/tree/master/models)，2026-10-26 搜尋結果中的表格）：

| 檔案 | 磁碟 |
| --- | --- |
| `large-v3` | 2.9 GiB |
| `large-v3-q5_0` | 1.1 GiB |
| `large-v3-turbo` | 1.5 GiB |
| `large-v3-turbo-q5_0` | 547 MiB |

這是同一套 Whisper。雲端 Groq 已經在跑 large-v3，本機不會更準，只換到離線與隱私。短句在 Apple Silicon 上通常仍快於即時；Windows 沒有 GPU 時，large-v3 可能慢於即時。未在這台機器實測。若以後要離線選項，只讓使用者自願下載 `large-v3-turbo-q5_0`（547 MiB），不要綁進安裝包。

**macOS 26 `SpeechAnalyzer`／`SpeechTranscriber`：** 系統語言包，不必在 App 裡塞 3 GB。只有 macOS 26 以後，Windows 沒有。第三方在 FLEURS 朗讀集上測到中文字錯誤率約 8%，和 Whisper turbo 接近（[Whisper Notes，2026-09-01，10-17 更新](https://whispernotes.app/blog/apple-speech-vs-whisper)）；那不是台灣國語＋英文夾雜，也不是蘋果公布的數字。同一篇文章的語言清單有中文、粵語、日、韓，沒有越南文、泰文。自訂詞彙有沒有對等 API，未確認。要接進現在的 Rust plugin，得做 Swift bridge。適合當「Mac、離線、系統已下載語言包」的可選路徑，不適合換掉 Groq。

**Qwen3-ASR 1.7B／0.6B（本機權重）：** 官方 README 寫 30 種語言加 22 種漢語方言，含中文、英文、粵語、日、韓、越、泰，並在自家表上多個中文集低於 Whisper large-v3（[QwenLM/Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)）。權重不是現在這個 Rust HTTP plugin 能直接呼叫的；要另帶推論執行環境。檔案大小官方 README 沒有寫死，第三方量化約 1 GB 級，未確認。磁碟緊就不要預設下載。

## 付費

短句聽寫要看「最短計費」。Groq 付費不足 10 秒仍算 10 秒。若平均一句 4 秒，計費時數是實際說話的 2.5 倍：large-v3 實際說話約 $0.28／小時，turbo 約 $0.10／小時（算術，不是帳單）。Deepgram、OpenAI、Gemini、阿里雲這次打開的頁面是按秒或按分鐘估算，沒有看到 10 秒最低消費；未確認它們是否另有最短計費。

| 方案 | 約每小時 | 對 TypeK 的理由 | 接進現有 plugin |
| --- | --- | --- | --- |
| Groq large-v3 付費 | $0.111，短句會被 10 秒地板放大 | 買的是額度，不是另一顆模型。Developer 的 RPM 是否高於 20，未確認 | 已接好 |
| Groq turbo 付費 | $0.04，同樣有 10 秒地板 | 更便宜、官方詞錯誤率較差 | 改模型字串 |
| 阿里雲 `qwen3-asr-flash`（新加坡） | $0.126 | 官方開放權重的中文分數好看；API 是百煉，不是 OpenAI 語音格式。熱詞參數這次定價頁沒寫 | 中高。另一套 HTTP |
| ElevenLabs Scribe v2 | $0.22，keyterm +$0.05 | 有真的 keyterm。倉庫已有 `docs/plan-elevenlabs-stt-provider.md`。4.5 小時免費可當對照組 | 中。欄位不同，仍是檔案上傳 |
| OpenAI `gpt-transcribe` | $0.27（$0.0045／分鐘） | 官方寫支援 `prompt`、`keywords`、多個 `languages`，給中英夾雜。`whisper-1` 與 `gpt-4o-transcribe` 系列 2027-02-26 下線。沒有免費層。繁中準確度未確認 | 小到中。URL 家族相同，回應格式與幻覺欄位要重接 |
| Deepgram Nova-3 預錄單語 | $0.258（$0.0043／分鐘） | 2026-03-31 更新說明有 `zh-TW`、`zh-Hant`。單語模型不適合句中中英切換 | 中。`POST /v1/listen`，body 是音訊本身 |
| Deepgram Nova-3 預錄多語 | $0.312（$0.0052／分鐘） | 55 語、句中換語、`language_hint`。清單含 `zh`／簡體、`zh-HK` 粵語、`en`、`ja`、`ko`、`vi`、`th`。**沒有 `zh-TW`** | 同上 |
| Deepgram keyterm | 另加 $0.078（$0.0013／分鐘） | 純詞，不吃舊的 `詞:權重`。多語 Nova-3 可用。上限文件寫約 100 個詞，另有 500 token 上限的說明，以 [keyterm 頁](https://developers.deepgram.com/docs/keyterm) 為準 | 查詢參數，加在同一條 POST |
| Gemini 3.5 Transcribe 付費 | 約 $0.30 | 見上。付費後資料不拿去改進產品 | 中。`generateContent` |
| Google Chirp 3 | 標準辨識 $0.016／分鐘＝$0.96／小時；註腳把 chirp 列在 V2 標準模型。**沒有單獨的 chirp_3 價目** | `cmn-Hant-TW` 仍是 Preview，有模型調適（片語）。貴，而且 gRPC／JSON recognizer，不是 multipart。區域多在 us／eu，從台灣過去的延遲未測 | 高 |

串流價不要拿來估 TypeK。Deepgram 串流 Nova-3 有限時促銷（多語現價 $0.0058／分鐘、原價 $0.0092）；預錄沒有這段促銷。TypeK 是放開按鍵後送一段 WAV，走預錄。

Deepgram 的 $200 是測試預算，不是「它比較準」的證據。要測的三件事：`language=zh-TW` 單語是否輸出繁體、`language=multi&language_hint=zh&language_hint=en` 是否仍輸出繁體、keyterm 能否稳住產品名。多語清單把中文標成簡體，字形風險是真的。

OpenAI 沒有寫台灣繁體代碼。`gpt-transcribe` 的 `languages` 是語言提示清單。檔案轉錄指南寫：只改模型 ID，不會保留舊模型的每一個能力。TypeK 依賴的 `verbose_json`／`no_speech_prob` 屬於這種能力，遷移前要對一份回應。

阿里雲單價低、中文是他們的主場，但音訊會進百煉。國際區用新加坡端點。不適合在沒做繁體與夾雜 A/B 之前就換預設。

這次沒有核到可引用單價、因此不進排序的：BytePlus／豆包、訊飛、Speechmatics、Soniox、Gladia、Cartesia。缺價格不等於它們比較差。

## 和現在這支 Rust plugin 的距離

現在的契約是：multipart 欄位 `file`、`model`、`response_format=verbose_json`、可選 `language`、可選 `prompt`；解析 `text` 與 `no_speech_prob`；429／5xx 有限次重試。

| 改動 | 難度 | 會破什麼 |
| --- | --- | --- |
| Groq turbo 備援 | 小。模型字串 | 準確度可能下降；翻譯端點不能用 turbo |
| OpenAI `gpt-transcribe` | 小到中 | `language` 改 `languages`；詞彙改 `keywords`；`no_speech_prob` 可能消失，幻覺過濾要改用別的訊號 |
| Deepgram 預錄 | 中。新的 URL、`Token` 標頭、raw body、查詢參數 | 沒有 `no_speech_prob`，有 `confidence`。不要為了短句去開 WebSocket |
| ElevenLabs Scribe v2 | 中 | 另一份 JSON。倉庫裡已有接入計畫，沿那份，不要平行再設計一次 |
| Gemini 3.5 Transcribe | 中 | 檔案上傳＋`generateContent`。靜音過濾要另做 |
| 百煉 Qwen3-ASR | 中高 | 他們的 HTTP／即時 WebSocket。即時對這款聽寫是多餘的 |
| Chirp 3 | 高 | recognizer、區域、Preview 語言 |
| `whisper.cpp` | 高，再加上磁碟與 Windows CPU | 模型下載、記憶體、與雲端路徑並存 |
| `SpeechAnalyzer` | 高，而且只有 macOS 26 | Swift bridge；Windows 仍走 Groq |

付費路線不必先上串流。使用者等的是放開按鍵之後的整段結果，預錄 HTTP 和現在的流程同一形狀。串流要改錄音狀態機，收益要另測。

## 建議的下一步（仍不寫程式）

1. 預設不動。Groq large-v3 繼續當唯一預設。
2. 若 429 常出現，先看帳號 Limits 頁上 large-v3 的 RPM／ASH 是不是真的 20 與 7,200。是的話，turbo 備援比先辦 Developer 方案便宜，而且不依賴那組互相矛盾的額度表。
3. 免費準確度實驗只排 Gemini 3.5 Transcribe：同一批台灣國語＋英文專名短句，比對字形、英文專名、延遲、靜音誤觸。免費層額度一 429 就停，不要為了實驗去刷。
4. 付費實驗用 Deepgram 的 $200，預錄、兩條語言設定都跑（`zh-TW` 與 `multi`＋`zh`／`en`），詞彙走 `keyterm`，不要用 `詞:2`。贏了再加 provider，輸了就停。
5. 想少改解析器時，第二條付費線才是 OpenAI `gpt-transcribe`。先打一通，確認回應裡還有沒有可用來替代 `no_speech_prob` 的欄位。
6. 不要為了離線把 2.9 GiB 模型放進預設安裝。

## 來源

2026-10-26 打開或搜尋：

- Groq 語音轉文字：<https://console.groq.com/docs/speech-to-text>
- Groq 額度：<https://console.groq.com/docs/rate-limits>
- OpenAI 定價（轉錄表）：<https://developers.openai.com/api/docs/pricing>
- OpenAI 轉錄指南：<https://developers.openai.com/api/docs/guides/transcription>
- Deepgram 定價：<https://deepgram.com/pricing>
- Deepgram 多語提示（含語言表）：<https://developers.deepgram.com/docs/nova-3-language-prompting>
- Deepgram keyterm：<https://developers.deepgram.com/docs/keyterm>
- Deepgram 2026-03-31 更新（`zh-TW`）：<https://developers.deepgram.com/changelog/2026/3/31>
- Deepgram 2026-10-23 更新（55 語）：<https://developers.deepgram.com/changelog/2026/10/23>
- Gemini 定價：<https://ai.google.dev/gemini-api/docs/pricing>
- Gemini 3.5 Transcribe：<https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe>
- Google Cloud Speech-to-Text 定價：<https://cloud.google.com/speech-to-text/pricing>
- Chirp 3 語言（`cmn-Hant-TW` Preview）：<https://cloud.google.com/speech-to-text/v2/docs/chirp_3-model>
- Azure Speech 定價：<https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/>
- ElevenLabs API 定價：<https://elevenlabs.io/pricing/api>
- AssemblyAI 定價：<https://www.assemblyai.com/pricing/>
- AssemblyAI 模型與語言：<https://www.assemblyai.com/docs/getting-started/models>
- 百煉定價：<https://www.alibabacloud.com/help/en/model-studio/model-pricing>
- Qwen3-ASR：<https://github.com/QwenLM/Qwen3-ASR>
- whisper.cpp 模型大小：<https://github.com/ggml-org/whisper.cpp/tree/master/models>

額度衝突的二手對照（不當成官方）：<https://grabaicredits.com/en/deals/groq-api-free-tier>（寫明 2026-10-17 對照 Groq Free Plan Limits 分頁）。

中文端側分數的二手對照（不當成官方）：<https://whispernotes.app/blog/apple-speech-vs-whisper>。

## 未確認

- Groq Developer 方案的 whisper RPM／每日音訊秒，官方頁表格與正文互相矛盾。
- 任一供應商在「台灣國語＋英文專名、短句、筆電麥克風」上的詞錯誤率。上面的 10.3%／12% 是 Groq 公布的數字，測試集未說明。
- Deepgram `language=multi` 遇到台灣國語時，輸出是繁體還是簡體。
- Gemini 3.5 Transcribe 免費層的 RPM／每日上限，以及它會不會把台灣國語寫成繁體。
- OpenAI `gpt-transcribe` 的檔案回應有沒有可替代 `no_speech_prob` 的欄位。
- ElevenLabs、Deepgram、OpenAI、Gemini、百煉對「短於數秒」是否另有最低計費。
- Azure 付費的美元單價（英文定價頁本次是佔位符）。
- `SpeechAnalyzer` 是否含 `zh-TW`、`vi`、`th`，以及語言包的磁碟大小。蘋果文件要在執行期問 `supportedLocales`。
- Qwen3-ASR 1.7B 量化後的實際檔案大小，以及百煉 flash API 的熱詞參數名稱。
- AssemblyAI 那 185 小時是一次性還是每月重置。
