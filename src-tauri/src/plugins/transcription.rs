use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use tauri::{command, State};

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const BYTEPLUS_API_URL: &str =
    "https://voice.ap-southeast-1.bytepluses.com/api/v3/auc/bigmodel/recognize/flash";
const BYTEPLUS_RESOURCE_ID: &str = "volc.seedasr.auc_turbo";
const MAX_WHISPER_PROMPT_TERMS: usize = 50;
const MINIMUM_AUDIO_SIZE: usize = 1000;
/// Groq free tier 上限 25MB
const MAX_AUDIO_FILE_SIZE: usize = 25 * 1024 * 1024;
/// BytePlus Seed Speech 極速版上限 100MB
const MAX_BYTEPLUS_FILE_SIZE: usize = 100 * 1024 * 1024;
const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
const REQUEST_TIMEOUT_SECS: u64 = 120;
/// Apple 內建辨識單次最多等 30 秒（ObjC 端另有 55 秒線上辨識限制）
#[cfg(target_os = "macos")]
const APPLE_SPEECH_TIMEOUT_SECS: i32 = 30;
/// gh-10：429/5xx/連線失敗自動重試（初次 + 2 次重試）
const MAX_TRANSCRIPTION_ATTEMPTS: u32 = 3;
/// 各次重試前的固定等待秒數（無 Retry-After 提示時）
const RETRY_BACKOFF_SECS: [u64; 2] = [1, 2];
/// Retry-After 建議等待超過此上限就直接放棄——語音場景等太久不如早報錯
const MAX_RETRY_AFTER_WAIT_SECS: u64 = 10;

// ========== State ==========

pub struct TranscriptionState {
    client: reqwest::Client,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to build HTTP client");
        Self { client }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("No audio data available — call stop_recording first")]
    NoAudioData,
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("Audio file too large ({size_mb:.1} MB, limit {limit_mb} MB). Please shorten your recording.")]
    FileTooLarge { size_mb: f64, limit_mb: usize },
    #[error("API key is missing")]
    ApiKeyMissing,
    #[error("Transcription request failed: {0}")]
    RequestFailed(String),
    #[error("Groq API returned error ({0}): {1}")]
    ApiError(u16, String),
    #[error("Provider authentication failed ({0})")]
    ProviderAuth(String),
    #[error("{provider} transcription failed (code {code}): {message}")]
    ProviderError {
        provider: String,
        code: String,
        message: String,
    },
    #[error("Apple speech error ({reason})")]
    // 只有 macOS 會建立；Windows 編譯時不算 dead code
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    AppleSpeech { reason: String },
    #[error("This transcription provider is not supported on this platform")]
    ProviderUnsupported,
    #[error("Failed to parse API response: {0}")]
    ParseError(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for TranscriptionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Result Types ==========

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: Option<f64>,
    // Peak/RMS energy (0.0..=1.0) of the source audio. Populated by
    // `retranscribe_from_file` (computed from the WAV) so the frontend
    // hallucination detector can run on history retries; the live
    // transcription path leaves these at 0.0 (it derives energy from the
    // recorder's StopRecordingResult instead).
    pub peak_energy_level: f32,
    pub rms_energy_level: f32,
}

// ========== Provider ==========

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SttProvider {
    Groq,
    Apple,
    BytePlus,
}

fn parse_stt_provider(value: Option<&str>) -> SttProvider {
    match value {
        Some("apple") => SttProvider::Apple,
        Some("byteplus") => SttProvider::BytePlus,
        _ => SttProvider::Groq,
    }
}

fn provider_label(provider: SttProvider) -> &'static str {
    match provider {
        SttProvider::Groq => "groq",
        SttProvider::Apple => "apple",
        SttProvider::BytePlus => "byteplus",
    }
}

/// Provider 判斷後的前置檢查：
/// - Apple 不檢查金鑰（非 macOS 直接回 ProviderUnsupported，且不先回 ApiKeyMissing）
/// - Groq／BytePlus 才要求金鑰
fn check_provider_prerequisites(
    provider: SttProvider,
    api_key: &str,
) -> Result<(), TranscriptionError> {
    match provider {
        #[cfg(target_os = "macos")]
        SttProvider::Apple => Ok(()),
        #[cfg(not(target_os = "macos"))]
        SttProvider::Apple => Err(TranscriptionError::ProviderUnsupported),
        SttProvider::Groq | SttProvider::BytePlus => {
            if api_key.trim().is_empty() {
                Err(TranscriptionError::ApiKeyMissing)
            } else {
                Ok(())
            }
        }
    }
}

// ========== Groq API Response ==========

#[derive(serde::Deserialize)]
struct WhisperVerboseResponse {
    text: String,
    segments: Vec<WhisperSegment>,
}

#[derive(serde::Deserialize)]
struct WhisperSegment {
    no_speech_prob: f64,
}

// ========== Helpers ==========

/// `term_list` 依優先度由高到低。Whisper 的 prompt 只看尾端（OpenAI 文件：最後 224 token），
/// 前段會被捨棄，所以取完名額後反轉，讓優先度最高的詞落在尾端（#84）。
fn format_whisper_prompt(term_list: &[String]) -> String {
    let terms: Vec<&str> = term_list
        .iter()
        .take(MAX_WHISPER_PROMPT_TERMS)
        .rev()
        .map(|s| s.as_str())
        .collect();
    format!("Important Vocabulary: {}", terms.join(", "))
}

/// 前端組好的 Whisper 前置稿優先（trim 後非空才算有值）；否則沿用字典詞清單。
fn select_whisper_prompt(
    whisper_prompt: Option<&str>,
    vocabulary_term_list: Option<&[String]>,
) -> Option<String> {
    if let Some(prompt) = whisper_prompt {
        if !prompt.trim().is_empty() {
            return Some(prompt.to_string());
        }
    }

    let terms = vocabulary_term_list.filter(|terms| !terms.is_empty())?;
    Some(format_whisper_prompt(terms))
}

/// 標準 base64（RFC 4648）編碼。BytePlus 要求把 WAV 本體放進 JSON，不引入新 crate。
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

static UUID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// UUID v4 字串（8-4-4-4-12）。只用時間、計數器與 `RandomState` 湊 128 bit，
/// 不引入 uuid crate。version nibble 固定 4、variant 固定 10xx。
fn uuid_v4() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    let counter = UUID_COUNTER.fetch_add(1, Ordering::Relaxed);

    let mut first_hasher = RandomState::new().build_hasher();
    first_hasher.write_u64(nanos);
    first_hasher.write_u64(counter);
    let first = first_hasher.finish();

    let mut second_hasher = RandomState::new().build_hasher();
    second_hasher.write_u64(nanos.rotate_left(17));
    second_hasher.write_u64(counter ^ 0x9e37_79b9_7f4a_7c15);
    let second = second_hasher.finish();

    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&first.to_be_bytes());
    bytes[8..].copy_from_slice(&second.to_be_bytes());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

// ========== WAV parsing ==========

#[derive(Debug, Clone, Copy)]
struct WavFormat {
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
}

/// 從 RIFF/WAVE 的 `fmt ` chunk 讀取取樣率、聲道數與位元深度。
fn parse_wav_format(wav_data: &[u8]) -> Option<WavFormat> {
    if wav_data.len() < 12 || &wav_data[0..4] != b"RIFF" || &wav_data[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12;
    while pos + 8 <= wav_data.len() {
        let chunk_id = &wav_data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            wav_data[pos + 4],
            wav_data[pos + 5],
            wav_data[pos + 6],
            wav_data[pos + 7],
        ]) as usize;
        let body = pos + 8;
        if chunk_id == b"fmt " {
            if body + 16 > wav_data.len() {
                return None;
            }
            let channels = u16::from_le_bytes([wav_data[body + 2], wav_data[body + 3]]);
            let sample_rate = u32::from_le_bytes([
                wav_data[body + 4],
                wav_data[body + 5],
                wav_data[body + 6],
                wav_data[body + 7],
            ]);
            let bits_per_sample =
                u16::from_le_bytes([wav_data[body + 14], wav_data[body + 15]]);
            return Some(WavFormat {
                sample_rate,
                channels,
                bits_per_sample,
            });
        }
        pos = body + chunk_size + (chunk_size & 1);
    }
    None
}

/// 由 WAV data chunk 的長度與 fmt 推算音訊毫秒數（只有 macOS 內建辨識用）。
#[cfg(any(target_os = "macos", test))]
fn wav_audio_duration_ms(wav_data: &[u8], format: &WavFormat) -> i32 {
    let data_offset = find_wav_data_offset(wav_data).unwrap_or(wav_data.len());
    let data_len = wav_data.len().saturating_sub(data_offset);
    let bytes_per_frame = format.channels as usize * (format.bits_per_sample as usize / 8);
    if bytes_per_frame == 0 || format.sample_rate == 0 {
        return 0;
    }
    let frame_count = data_len / bytes_per_frame;
    (frame_count * 1000 / format.sample_rate as usize) as i32
}

// ========== BytePlus request/response ==========

struct BytePlusLanguageConfig {
    audio_language: Option<&'static str>,
    zh_variant: Option<&'static str>,
    include_hotwords: bool,
}

/// 依 §A3 語言對照表決定 `audio.language`、`output_zh_variant` 與是否帶熱詞。
/// `transcription_locale` 缺值時視為 auto（舊前端只會送 Groq，不影響）。
fn byteplus_language_config(
    transcription_locale: Option<&str>,
    interface_locale: Option<&str>,
) -> BytePlusLanguageConfig {
    match transcription_locale.unwrap_or("auto") {
        "zh-TW" => BytePlusLanguageConfig {
            audio_language: Some("zh-CN"),
            zh_variant: Some("tw"),
            include_hotwords: true,
        },
        "zh-CN" => BytePlusLanguageConfig {
            audio_language: Some("zh-CN"),
            zh_variant: None,
            include_hotwords: true,
        },
        "en" => BytePlusLanguageConfig {
            audio_language: Some("en-US"),
            zh_variant: None,
            include_hotwords: false,
        },
        "ja" => BytePlusLanguageConfig {
            audio_language: Some("ja-JP"),
            zh_variant: None,
            include_hotwords: false,
        },
        "ko" => BytePlusLanguageConfig {
            audio_language: Some("ko-KR"),
            zh_variant: None,
            include_hotwords: false,
        },
        "vi" => BytePlusLanguageConfig {
            audio_language: Some("vi-VN"),
            zh_variant: None,
            include_hotwords: false,
        },
        "th" => BytePlusLanguageConfig {
            audio_language: Some("th-TH"),
            zh_variant: None,
            include_hotwords: false,
        },
        _ => BytePlusLanguageConfig {
            audio_language: None,
            zh_variant: if interface_locale == Some("zh-TW") {
                Some("tw")
            } else {
                None
            },
            include_hotwords: true,
        },
    }
}

/// 組 BytePlus Seed Speech 極速版請求 JSON。
fn build_byteplus_request(
    wav_data: &[u8],
    vocabulary_term_list: Option<&[String]>,
    transcription_locale: Option<&str>,
    interface_locale: Option<&str>,
) -> Result<serde_json::Value, TranscriptionError> {
    let format = parse_wav_format(wav_data)
        .ok_or_else(|| TranscriptionError::RequestFailed("Unsupported WAV format".into()))?;
    if format.bits_per_sample != 16 || !matches!(format.channels, 1 | 2) {
        return Err(TranscriptionError::RequestFailed(
            "Unsupported WAV format".into(),
        ));
    }

    let language_config = byteplus_language_config(transcription_locale, interface_locale);

    let mut audio = serde_json::Map::new();
    audio.insert(
        "data".to_string(),
        serde_json::Value::String(base64_encode(wav_data)),
    );
    audio.insert(
        "format".to_string(),
        serde_json::Value::String("wav".to_string()),
    );
    audio.insert(
        "codec".to_string(),
        serde_json::Value::String("raw".to_string()),
    );
    audio.insert(
        "rate".to_string(),
        serde_json::Value::from(format.sample_rate),
    );
    audio.insert("bits".to_string(), serde_json::Value::from(16));
    audio.insert(
        "channel".to_string(),
        serde_json::Value::from(format.channels),
    );
    if let Some(language) = language_config.audio_language {
        audio.insert(
            "language".to_string(),
            serde_json::Value::String(language.to_string()),
        );
    }

    let mut request = serde_json::Map::new();
    request.insert(
        "model_name".to_string(),
        serde_json::Value::String("bigmodel".to_string()),
    );
    request.insert("enable_itn".to_string(), serde_json::Value::Bool(true));
    request.insert("enable_punc".to_string(), serde_json::Value::Bool(true));
    request.insert("enable_ddc".to_string(), serde_json::Value::Bool(false));
    request.insert(
        "show_utterances".to_string(),
        serde_json::Value::Bool(false),
    );
    if let Some(variant) = language_config.zh_variant {
        request.insert(
            "output_zh_variant".to_string(),
            serde_json::Value::String(variant.to_string()),
        );
    }

    if let Some(terms) = vocabulary_term_list
        .filter(|terms| language_config.include_hotwords && !terms.is_empty())
    {
        let hotword_list: Vec<serde_json::Value> = terms
            .iter()
            .take(MAX_WHISPER_PROMPT_TERMS)
            .map(|word| serde_json::json!({ "word": word }))
            .collect();
        let context = serde_json::json!({ "hotwords": hotword_list });
        let context_string =
            serde_json::to_string(&context).expect("hotword context serialization cannot fail");
        request.insert(
            "corpus".to_string(),
            serde_json::json!({ "context": context_string }),
        );
    }

    Ok(serde_json::json!({
        "user": { "uid": "typek" },
        "audio": audio,
        "request": request,
    }))
}

/// 從 `result`（物件或陣列）取文字；空字串代表沒有辨識結果。
fn byteplus_result_text(body: &str) -> Result<String, TranscriptionError> {
    let json: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| TranscriptionError::ParseError(e.to_string()))?;
    let result = &json["result"];
    let text = if let Some(array) = result.as_array() {
        array
            .first()
            .and_then(|item| item.get("text"))
            .and_then(|value| value.as_str())
    } else {
        result.get("text").and_then(|value| value.as_str())
    };
    Ok(text.unwrap_or("").trim().to_string())
}

fn truncate_message(message: &str) -> String {
    message.chars().take(300).collect()
}

/// 依 HTTP 狀態、`X-Api-Status-Code` 與本體分類 BytePlus 結果。
fn parse_byteplus_response(
    http_status: u16,
    api_status_code: Option<&str>,
    api_message: Option<&str>,
    body: &str,
) -> Result<(String, Option<f64>), AttemptFailure> {
    let no_retry = |error: TranscriptionError| AttemptFailure {
        error,
        kind: FailureKind::NoRetry,
    };
    let code = api_status_code.unwrap_or("");

    if http_status == 401 || code == "45000010" {
        return Err(no_retry(TranscriptionError::ProviderAuth(
            "BytePlus".to_string(),
        )));
    }

    if code == "20000000" {
        let text = byteplus_result_text(body).map_err(no_retry)?;
        return Ok((text, None));
    }

    if code == "20000003" {
        return Ok((String::new(), Some(1.0)));
    }

    if code
        .parse::<u32>()
        .is_ok_and(|numeric_code| (55_000_000..=55_999_999).contains(&numeric_code))
    {
        return Err(AttemptFailure {
            error: TranscriptionError::ProviderError {
                provider: "BytePlus".to_string(),
                code: code.to_string(),
                message: api_message
                    .map(truncate_message)
                    .unwrap_or_else(|| truncate_message(body)),
            },
            kind: FailureKind::ServerError,
        });
    }

    if http_status == 429 {
        return Err(AttemptFailure {
            error: TranscriptionError::ProviderError {
                provider: "BytePlus".to_string(),
                code: if code.is_empty() {
                    "429".to_string()
                } else {
                    code.to_string()
                },
                message: api_message
                    .map(truncate_message)
                    .unwrap_or_else(|| truncate_message(body)),
            },
            kind: FailureKind::RateLimited {
                retry_after_secs: None,
            },
        });
    }

    if (500..=599).contains(&http_status) {
        return Err(AttemptFailure {
            error: TranscriptionError::ProviderError {
                provider: "BytePlus".to_string(),
                code: if code.is_empty() {
                    http_status.to_string()
                } else {
                    code.to_string()
                },
                message: api_message
                    .map(truncate_message)
                    .unwrap_or_else(|| truncate_message(body)),
            },
            kind: FailureKind::ServerError,
        });
    }

    let message = api_message
        .map(truncate_message)
        .unwrap_or_else(|| truncate_message(body));
    Err(no_retry(TranscriptionError::ProviderError {
        provider: "BytePlus".to_string(),
        code: if code.is_empty() {
            format!("HTTP {http_status}")
        } else {
            code.to_string()
        },
        message,
    }))
}

// ========== Retry Classification (gh-10) ==========

/// 單次嘗試的失敗分類——決定要不要重試
#[derive(Debug)]
enum FailureKind {
    /// HTTP 429，帶 Retry-After 建議秒數（若可解析）
    RateLimited { retry_after_secs: Option<u64> },
    /// HTTP 5xx
    ServerError,
    /// 連線建立失敗（fail-fast 型，重試便宜）
    Connect,
    /// 4xx／timeout／parse 等——重試無意義或代價過高
    NoRetry,
}

#[derive(Debug)]
struct AttemptFailure {
    error: TranscriptionError,
    kind: FailureKind,
}

fn failure_kind_label(kind: &FailureKind) -> &'static str {
    match kind {
        FailureKind::RateLimited { .. } => "rate-limited",
        FailureKind::ServerError => "server-error",
        FailureKind::Connect => "connect-failed",
        FailureKind::NoRetry => "no-retry",
    }
}

/// 只支援 Retry-After 的秒數格式；HTTP-date 格式解析失敗回 None（退回固定 backoff）
fn parse_retry_after_secs(value: Option<&str>) -> Option<u64> {
    value?.trim().parse::<u64>().ok()
}

/// 回傳 Some(等待秒數) = 該重試；None = 直接放棄。attempt 為剛失敗的嘗試序號（1-based）
fn retry_wait_secs(kind: &FailureKind, attempt: u32) -> Option<u64> {
    let backoff_index = (attempt as usize)
        .saturating_sub(1)
        .min(RETRY_BACKOFF_SECS.len() - 1);
    let backoff = RETRY_BACKOFF_SECS[backoff_index];
    match kind {
        FailureKind::RateLimited { retry_after_secs } => {
            let wait = retry_after_secs.unwrap_or(backoff);
            if wait > MAX_RETRY_AFTER_WAIT_SECS {
                None
            } else {
                Some(wait)
            }
        }
        FailureKind::ServerError | FailureKind::Connect => Some(backoff),
        FailureKind::NoRetry => None,
    }
}

// ========== Shared Transcription Logic ==========

struct TranscriptionParams {
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    whisper_prompt: Option<String>,
    model_id: Option<String>,
    language: Option<String>,
    provider: SttProvider,
    transcription_locale: Option<String>,
    interface_locale: Option<String>,
}

/// Groq 單次 API 嘗試：建 form → 送出 → 解析。回傳 (raw_text, no_speech_probability)
async fn attempt_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    api_key: &str,
    vocabulary_term_list: Option<&[String]>,
    whisper_prompt: Option<&str>,
    model: &str,
    language: Option<&str>,
) -> Result<(String, Option<f64>), AttemptFailure> {
    let no_retry = |error: TranscriptionError| AttemptFailure {
        error,
        kind: FailureKind::NoRetry,
    };

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| no_retry(TranscriptionError::RequestFailed(e.to_string())))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string())
        .text("response_format", "verbose_json");

    // Conditionally add language — None means auto-detect
    if let Some(lang) = language {
        form = form.text("language", lang.to_string());
    }

    if let Some(prompt) = select_whisper_prompt(whisper_prompt, vocabulary_term_list) {
        form = form.text("prompt", prompt);
    }

    // Send request (reuse shared client for connection pooling)
    let response = match transcription_state
        .client
        .post(GROQ_API_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            // timeout 不重試：120 秒才超時的請求再試兩次是災難
            let kind = if e.is_connect() {
                FailureKind::Connect
            } else {
                FailureKind::NoRetry
            };
            return Err(AttemptFailure {
                error: TranscriptionError::RequestFailed(e.to_string()),
                kind,
            });
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let retry_after_secs = parse_retry_after_secs(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        );
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        let kind = match status {
            429 => FailureKind::RateLimited { retry_after_secs },
            // 5xx 刻意不採用 Retry-After，固定短 backoff 即可
            500..=599 => FailureKind::ServerError,
            _ => FailureKind::NoRetry,
        };
        return Err(AttemptFailure {
            error: TranscriptionError::ApiError(status, body),
            kind,
        });
    }

    // Parse response
    let json: WhisperVerboseResponse = response
        .json()
        .await
        .map_err(|e| no_retry(TranscriptionError::ParseError(e.to_string())))?;

    let raw_text = json.text.trim().to_string();
    // Use MIN: if any segment detects speech (low NSP), trust it — real speech
    // always produces at least one low-NSP segment, while pure noise/hallucination
    // keeps all segments high.
    let no_speech_probability = json
        .segments
        .iter()
        .map(|s| s.no_speech_prob)
        .fold(1.0_f64, f64::min);
    // If no segments, treat as full silence
    let no_speech_probability = if json.segments.is_empty() {
        1.0
    } else {
        no_speech_probability
    };

    Ok((raw_text, Some(no_speech_probability)))
}

/// BytePlus 單次 API 嘗試。狀態在回應標頭，HTTP 常是 200。
async fn attempt_byteplus_request(
    wav_data: &[u8],
    transcription_state: &TranscriptionState,
    params: &TranscriptionParams,
) -> Result<(String, Option<f64>), AttemptFailure> {
    let no_retry = |error: TranscriptionError| AttemptFailure {
        error,
        kind: FailureKind::NoRetry,
    };

    let payload = build_byteplus_request(
        wav_data,
        params.vocabulary_term_list.as_deref(),
        params.transcription_locale.as_deref(),
        params.interface_locale.as_deref(),
    )
    .map_err(no_retry)?;

    let response = match transcription_state
        .client
        .post(BYTEPLUS_API_URL)
        .header("X-Api-Key", params.api_key.as_str())
        .header("X-Api-Resource-Id", BYTEPLUS_RESOURCE_ID)
        .header("X-Api-Request-Id", uuid_v4())
        .header("X-Api-Sequence", "-1")
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            let kind = if e.is_connect() {
                FailureKind::Connect
            } else {
                FailureKind::NoRetry
            };
            return Err(AttemptFailure {
                error: TranscriptionError::RequestFailed(e.to_string()),
                kind,
            });
        }
    };

    let http_status = response.status().as_u16();
    let header_value = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let api_status_code = header_value("x-api-status-code");
    let api_message = header_value("x-api-message");
    if let Some(log_id) = header_value("x-tt-logid") {
        log::info!("[transcription] BytePlus request logid={log_id}");
    }

    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "Failed to read response body".to_string());

    parse_byteplus_response(
        http_status,
        api_status_code.as_deref(),
        api_message.as_deref(),
        &body,
    )
}

async fn attempt_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    params: &TranscriptionParams,
    model: &str,
) -> Result<(String, Option<f64>), AttemptFailure> {
    match params.provider {
        SttProvider::Groq => {
            attempt_transcription_request(
                wav_data,
                transcription_state,
                &params.api_key,
                params.vocabulary_term_list.as_deref(),
                params.whisper_prompt.as_deref(),
                model,
                params.language.as_deref(),
            )
            .await
        }
        SttProvider::BytePlus => {
            attempt_byteplus_request(&wav_data, transcription_state, params).await
        }
        SttProvider::Apple => unreachable!("Apple requests never use the HTTP path"),
    }
}

async fn send_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    params: &TranscriptionParams,
) -> Result<TranscriptionResult, TranscriptionError> {
    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(TranscriptionError::AudioTooSmall(wav_data.len()));
    }

    let file_size_limit = match params.provider {
        SttProvider::BytePlus => MAX_BYTEPLUS_FILE_SIZE,
        SttProvider::Groq | SttProvider::Apple => MAX_AUDIO_FILE_SIZE,
    };
    if wav_data.len() > file_size_limit {
        let size_mb = wav_data.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = file_size_limit / (1024 * 1024);
        return Err(TranscriptionError::FileTooLarge { size_mb, limit_mb });
    }

    let model = params
        .model_id
        .clone()
        .unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    log::info!(
        "[transcription] Sending {} bytes WAV to {} (model={})",
        wav_data.len(),
        provider_label(params.provider),
        model
    );

    // 計時涵蓋重試等待——維持「使用者感受時長」語意
    let start_time = Instant::now();
    let mut wav_data = Some(wav_data);

    for attempt in 1..=MAX_TRANSCRIPTION_ATTEMPTS {
        // 最後一次嘗試 move 原始資料，clone 只發生在還有重試機會時
        let data = if attempt < MAX_TRANSCRIPTION_ATTEMPTS {
            wav_data
                .as_ref()
                .expect("wav_data taken early")
                .clone()
        } else {
            wav_data.take().expect("wav_data taken early")
        };

        match attempt_request(data, transcription_state, params, &model).await {
            Ok((raw_text, no_speech_probability)) => {
                let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
                let no_speech_display = no_speech_probability
                    .map(|value| format!("{value:.3}"))
                    .unwrap_or_else(|| "n/a".to_string());
                log::info!(
                    "[transcription] Response in {transcription_duration_ms:.0}ms (attempt {attempt}): \"{raw_text}\" (noSpeechProb={no_speech_display})"
                );
                return Ok(TranscriptionResult {
                    raw_text,
                    transcription_duration_ms,
                    no_speech_probability,
                    // Live path doesn't compute energy here; retranscribe_from_file fills these in.
                    peak_energy_level: 0.0,
                    rms_energy_level: 0.0,
                });
            }
            Err(failure) => {
                if attempt < MAX_TRANSCRIPTION_ATTEMPTS {
                    if let Some(wait) = retry_wait_secs(&failure.kind, attempt) {
                        log::warn!(
                            "[transcription] Attempt {attempt} failed ({}): {}; retrying in {wait}s",
                            failure_kind_label(&failure.kind),
                            failure.error
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                        continue;
                    }
                }
                log::error!(
                    "[transcription] Attempt {attempt} failed ({}), giving up: {}",
                    failure_kind_label(&failure.kind),
                    failure.error
                );
                return Err(failure.error);
            }
        }
    }

    unreachable!("retry loop always returns within MAX_TRANSCRIPTION_ATTEMPTS")
}

/// Locate the byte offset of the PCM samples (start of the "data" sub-chunk body)
/// in a RIFF/WAVE buffer. Returns None if the buffer is not a recognizable WAV.
fn find_wav_data_offset(wav_data: &[u8]) -> Option<usize> {
    if wav_data.len() < 12 || &wav_data[0..4] != b"RIFF" || &wav_data[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12;
    while pos + 8 <= wav_data.len() {
        let chunk_id = &wav_data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            wav_data[pos + 4],
            wav_data[pos + 5],
            wav_data[pos + 6],
            wav_data[pos + 7],
        ]) as usize;
        let body = pos + 8;
        if chunk_id == b"data" {
            return Some(body);
        }
        // Sub-chunks are word-aligned (padded to an even byte count).
        pos = body + chunk_size + (chunk_size & 1);
    }
    None
}

/// Compute peak & RMS energy (0.0..=1.0) from a 16-bit mono PCM WAV byte buffer.
/// Mirrors the live-recording formula in `audio_recorder.rs` so the hallucination
/// detector can run on re-transcribed history recordings.
fn compute_wav_energy(wav_data: &[u8]) -> (f32, f32) {
    let data_offset = find_wav_data_offset(wav_data).unwrap_or(44);
    let pcm = match wav_data.get(data_offset..) {
        Some(slice) => slice,
        None => return (0.0, 0.0),
    };
    let sample_count = pcm.len() / 2;
    if sample_count == 0 {
        return (0.0, 0.0);
    }
    let mut peak = 0.0_f32;
    let mut sum_squares = 0.0_f64;
    for frame in pcm.as_chunks::<2>().0 {
        let s = i16::from_le_bytes(*frame);
        let abs_normalized = (s as f32).abs() / i16::MAX as f32;
        peak = peak.max(abs_normalized);
        let norm_f64 = s as f64 / i16::MAX as f64;
        sum_squares += norm_f64 * norm_f64;
    }
    let rms = (sum_squares / sample_count as f64).sqrt() as f32;
    (peak, rms)
}

// ========== Apple Speech (macOS only) ==========

/// Apple 沒有自動偵測，`auto` 用介面語言對照。
#[cfg(target_os = "macos")]
fn apple_locale_for(
    transcription_locale: Option<&str>,
    interface_locale: Option<&str>,
) -> &'static str {
    let locale = match transcription_locale.unwrap_or("auto") {
        "auto" => interface_locale.unwrap_or("zh-TW"),
        other => other,
    };
    match locale {
        "zh-TW" => "zh-TW",
        "zh-CN" => "zh-CN",
        "en" => "en-US",
        "ja" => "ja-JP",
        "ko" => "ko-KR",
        "vi" => "vi-VN",
        "th" => "th-TH",
        _ => "zh-TW",
    }
}

#[cfg(target_os = "macos")]
fn apple_error_from_code(code: i32) -> TranscriptionError {
    let reason = match code {
        1 => "not_authorized",
        2 => "locale_unsupported",
        3 => "recognition_failed",
        4 => "timeout",
        5 => "needs_language_pack",
        _ => "recognition_failed",
    };
    TranscriptionError::AppleSpeech {
        reason: reason.to_string(),
    }
}

#[cfg(target_os = "macos")]
mod apple_speech {
    use super::{apple_error_from_code, TranscriptionError};
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    extern "C" {
        fn typek_apple_speech_auth_status() -> i32;
        fn typek_apple_speech_request_auth(timeout_secs: i32) -> i32;
        fn typek_apple_speech_transcribe(
            wav_path: *const c_char,
            locale_id: *const c_char,
            contextual_terms: *const c_char,
            audio_ms: i32,
            timeout_secs: i32,
            out_error_code: *mut i32,
        ) -> *mut c_char;
        fn typek_apple_speech_free(ptr: *mut c_char);
        fn typek_apple_speech_locale_available(locale_id: *const c_char) -> i32;
    }

    pub fn auth_status() -> i32 {
        unsafe { typek_apple_speech_auth_status() }
    }

    pub fn request_auth(timeout_secs: i32) -> i32 {
        unsafe { typek_apple_speech_request_auth(timeout_secs) }
    }

    fn recognition_failed() -> TranscriptionError {
        apple_error_from_code(3)
    }

    pub fn locale_available(locale_id: &str) -> bool {
        let Ok(c_locale) = CString::new(locale_id) else {
            return false;
        };
        unsafe { typek_apple_speech_locale_available(c_locale.as_ptr()) == 1 }
    }

    pub fn transcribe(
        wav_path: &str,
        locale_id: &str,
        contextual_terms: Option<&str>,
        audio_ms: i32,
        timeout_secs: i32,
    ) -> Result<String, TranscriptionError> {
        let c_path = CString::new(wav_path).map_err(|_| recognition_failed())?;
        let c_locale = CString::new(locale_id).map_err(|_| recognition_failed())?;
        let c_terms = match contextual_terms {
            Some(terms) => Some(CString::new(terms).map_err(|_| recognition_failed())?),
            None => None,
        };
        let terms_ptr = c_terms
            .as_ref()
            .map(|terms| terms.as_ptr())
            .unwrap_or(std::ptr::null());

        let mut error_code: i32 = 0;
        let text_ptr = unsafe {
            typek_apple_speech_transcribe(
                c_path.as_ptr(),
                c_locale.as_ptr(),
                terms_ptr,
                audio_ms,
                timeout_secs,
                &mut error_code,
            )
        };

        if text_ptr.is_null() {
            return Err(apple_error_from_code(error_code));
        }

        // 只透過 Objective-C 匯出的 free 釋放（不可用 CString::from_raw）。
        let text = unsafe { CStr::from_ptr(text_ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { typek_apple_speech_free(text_ptr) };
        Ok(text)
    }
}

#[cfg(target_os = "macos")]
struct TempWavFile {
    path: std::path::PathBuf,
}

#[cfg(target_os = "macos")]
impl TempWavFile {
    fn create(wav_data: &[u8]) -> Result<Self, TranscriptionError> {
        let path = std::env::temp_dir().join(format!("typek-apple-{}.wav", uuid_v4()));
        std::fs::write(&path, wav_data).map_err(|e| {
            TranscriptionError::RequestFailed(format!("Failed to write temporary WAV: {e}"))
        })?;
        Ok(Self { path })
    }

    fn path_string(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

#[cfg(target_os = "macos")]
impl Drop for TempWavFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "macos")]
async fn run_apple_transcription(
    wav_path: String,
    locale_id: String,
    vocabulary_term_list: Option<Vec<String>>,
    audio_ms: i32,
) -> Result<TranscriptionResult, TranscriptionError> {
    let start_time = Instant::now();
    let contextual_terms = vocabulary_term_list.map(|terms| terms.join("\n"));

    let text = tauri::async_runtime::spawn_blocking(move || {
        apple_speech::transcribe(
            &wav_path,
            &locale_id,
            contextual_terms.as_deref(),
            audio_ms,
            APPLE_SPEECH_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| TranscriptionError::RequestFailed(format!("Apple speech task failed: {e}")))??;

    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
    let no_speech_probability = if text.trim().is_empty() {
        Some(1.0)
    } else {
        None
    };

    Ok(TranscriptionResult {
        raw_text: text,
        transcription_duration_ms,
        no_speech_probability,
        peak_energy_level: 0.0,
        rms_energy_level: 0.0,
    })
}

#[cfg(target_os = "macos")]
async fn transcribe_audio_apple(
    wav_data: &[u8],
    params: &TranscriptionParams,
) -> Result<TranscriptionResult, TranscriptionError> {
    let format = parse_wav_format(wav_data)
        .ok_or_else(|| TranscriptionError::RequestFailed("Unsupported WAV format".into()))?;
    let audio_ms = wav_audio_duration_ms(wav_data, &format);
    let temp_file = TempWavFile::create(wav_data)?;
    run_apple_transcription(
        temp_file.path_string(),
        apple_locale_for(
            params.transcription_locale.as_deref(),
            params.interface_locale.as_deref(),
        )
        .to_string(),
        params.vocabulary_term_list.clone(),
        audio_ms,
    )
    .await
}

#[cfg(target_os = "macos")]
async fn retranscribe_apple(
    file_path: String,
    wav_data: &[u8],
    params: &TranscriptionParams,
) -> Result<TranscriptionResult, TranscriptionError> {
    let format = parse_wav_format(wav_data)
        .ok_or_else(|| TranscriptionError::RequestFailed("Unsupported WAV format".into()))?;
    let audio_ms = wav_audio_duration_ms(wav_data, &format);
    run_apple_transcription(
        file_path,
        apple_locale_for(
            params.transcription_locale.as_deref(),
            params.interface_locale.as_deref(),
        )
        .to_string(),
        params.vocabulary_term_list.clone(),
        audio_ms,
    )
    .await
}

// ========== Commands ==========

/// Tauri command 參數直接對應前端 invoke 欄位
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn transcribe_audio(
    state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    whisper_prompt: Option<String>,
    model_id: Option<String>,
    language: Option<String>,
    provider: Option<String>,
    transcription_locale: Option<String>,
    interface_locale: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    let provider = parse_stt_provider(provider.as_deref());
    check_provider_prerequisites(provider, &api_key)?;

    let params = TranscriptionParams {
        api_key,
        vocabulary_term_list,
        whisper_prompt,
        model_id,
        language,
        provider,
        transcription_locale,
        interface_locale,
    };

    #[cfg(target_os = "macos")]
    if provider == SttProvider::Apple {
        let wav_data = {
            let mut guard = state
                .wav_buffer
                .lock()
                .map_err(|_| TranscriptionError::LockPoisoned)?;
            guard.take().ok_or(TranscriptionError::NoAudioData)?
        };
        // 即時路徑的能量由前端錄音器提供，這裡維持 0
        return transcribe_audio_apple(&wav_data, &params).await;
    }

    #[cfg(not(target_os = "macos"))]
    if provider == SttProvider::Apple {
        return Err(TranscriptionError::ProviderUnsupported);
    }

    // Take WAV data from shared state (consume it)
    let wav_data = {
        let mut guard = state
            .wav_buffer
            .lock()
            .map_err(|_| TranscriptionError::LockPoisoned)?;
        guard.take().ok_or(TranscriptionError::NoAudioData)?
    };

    send_transcription_request(wav_data, &transcription_state, &params).await
}

/// Tauri command 參數直接對應前端 invoke 欄位
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn retranscribe_from_file(
    transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    whisper_prompt: Option<String>,
    model_id: Option<String>,
    language: Option<String>,
    provider: Option<String>,
    transcription_locale: Option<String>,
    interface_locale: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    let provider = parse_stt_provider(provider.as_deref());
    check_provider_prerequisites(provider, &api_key)?;

    let params = TranscriptionParams {
        api_key,
        vocabulary_term_list,
        whisper_prompt,
        model_id,
        language,
        provider,
        transcription_locale,
        interface_locale,
    };

    // 注意：std::fs::read 是同步 I/O，但 WAV 檔案通常很小（< 1MB），
    // 在 Tauri command 的 async context 中可接受。
    let wav_data = std::fs::read(&file_path).map_err(|e| {
        TranscriptionError::RequestFailed(format!("Failed to read WAV file: {e}"))
    })?;

    log::info!(
        "[transcription] Retranscribing from file: {} ({} bytes, provider={})",
        file_path,
        wav_data.len(),
        provider_label(provider)
    );

    // 歷史重新辨識沒有錄音器能量，三家都從 WAV 算，讓前端幻聽守衛的 Layer 2a 不誤判
    let (peak_energy_level, rms_energy_level) = compute_wav_energy(&wav_data);

    #[cfg(target_os = "macos")]
    if provider == SttProvider::Apple {
        let mut result = retranscribe_apple(file_path, &wav_data, &params).await?;
        result.peak_energy_level = peak_energy_level;
        result.rms_energy_level = rms_energy_level;
        return Ok(result);
    }

    #[cfg(not(target_os = "macos"))]
    if provider == SttProvider::Apple {
        return Err(TranscriptionError::ProviderUnsupported);
    }

    let mut result = send_transcription_request(wav_data, &transcription_state, &params).await?;
    result.peak_energy_level = peak_energy_level;
    result.rms_energy_level = rms_energy_level;
    Ok(result)
}

/// Apple 授權狀態：0 未決定、1 拒絕、2 受限、3 已授權。
#[command]
pub fn apple_speech_auth_status() -> Result<i32, TranscriptionError> {
    #[cfg(target_os = "macos")]
    {
        Ok(apple_speech::auth_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(TranscriptionError::ProviderUnsupported)
    }
}

/// 請求 Apple 語音辨識授權（未決定時才會跳系統對話框）。
#[command]
pub async fn apple_speech_request_auth() -> Result<i32, TranscriptionError> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| apple_speech::request_auth(60))
            .await
            .map_err(|e| {
                TranscriptionError::RequestFailed(format!("Apple speech auth task failed: {e}"))
            })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(TranscriptionError::ProviderUnsupported)
    }
}

/// Tauri command 參數直接對應前端 invoke 欄位
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn test_whisper_connection(
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    model_id: Option<String>,
    provider: Option<String>,
    transcription_locale: Option<String>,
    interface_locale: Option<String>,
) -> Result<(), TranscriptionError> {
    let provider = parse_stt_provider(provider.as_deref());
    check_provider_prerequisites(provider, &api_key)?;

    if provider == SttProvider::Apple {
        #[cfg(target_os = "macos")]
        {
            let locale_id = apple_locale_for(
                transcription_locale.as_deref(),
                interface_locale.as_deref(),
            );
            return tauri::async_runtime::spawn_blocking(move || {
                if apple_speech::auth_status() != 3 {
                    return Err(apple_error_from_code(1));
                }
                if !apple_speech::locale_available(locale_id) {
                    return Err(apple_error_from_code(2));
                }
                Ok(())
            })
            .await
            .map_err(|e| {
                TranscriptionError::RequestFailed(format!("Apple speech task failed: {e}"))
            })?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(TranscriptionError::ProviderUnsupported);
        }
    }

    // 1 秒 16kHz silence ≈ 32044 bytes，遠超過 MINIMUM_AUDIO_SIZE 的 1000 byte 下限。
    let silence_samples = vec![0i16; 16_000];
    let wav_data = super::audio_recorder::encode_wav(&silence_samples, 16_000)
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let params = TranscriptionParams {
        api_key,
        vocabulary_term_list: None,
        whisper_prompt: None,
        model_id,
        language: None,
        provider,
        transcription_locale,
        interface_locale,
    };

    let model = params
        .model_id
        .clone()
        .unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    // 連線測試走單次嘗試——要的就是即時真實結果，不重試
    match attempt_request(wav_data, &transcription_state, &params, &model).await {
        Ok(_) => Ok(()),
        Err(failure) => {
            // BytePlus 45000002 代表音訊無效，但金鑰本身有效。
            if provider == SttProvider::BytePlus {
                if let TranscriptionError::ProviderError { code, .. } = &failure.error {
                    if code == "45000002" {
                        return Ok(());
                    }
                }
            }
            Err(failure.error)
        }
    }
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_whisper_prompt_basic() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string(), "Vue".to_string()];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: Vue, Rust, Tauri");
    }

    #[test]
    fn test_format_whisper_prompt_empty() {
        let terms: Vec<String> = vec![];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: ");
    }

    #[test]
    fn test_format_whisper_prompt_exceeds_max() {
        let terms: Vec<String> = (0..100).map(|i| format!("term{i}")).collect();
        let result = format_whisper_prompt(&terms);
        // 只取優先度最高的前 MAX 個，反轉後最高優先度在尾端
        let parts: Vec<&str> = result
            .strip_prefix("Important Vocabulary: ")
            .unwrap()
            .split(", ")
            .collect();
        assert_eq!(parts.len(), MAX_WHISPER_PROMPT_TERMS);
        assert_eq!(parts[0], format!("term{}", MAX_WHISPER_PROMPT_TERMS - 1));
        assert_eq!(parts[MAX_WHISPER_PROMPT_TERMS - 1], "term0");
    }

    #[test]
    fn test_select_whisper_prompt_prefers_frontend_prompt() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string()];
        assert_eq!(
            select_whisper_prompt(Some("以下是台灣繁體中文的語音逐字稿。"), Some(&terms))
                .as_deref(),
            Some("以下是台灣繁體中文的語音逐字稿。")
        );
    }

    #[test]
    fn test_select_whisper_prompt_falls_back_to_vocabulary() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string()];
        assert_eq!(
            select_whisper_prompt(Some("   "), Some(&terms)).as_deref(),
            Some("Important Vocabulary: Rust, Tauri")
        );
    }

    #[test]
    fn test_select_whisper_prompt_none_when_both_absent() {
        let empty_terms: Vec<String> = vec![];
        assert_eq!(select_whisper_prompt(None, None), None);
        assert_eq!(select_whisper_prompt(Some(""), Some(&empty_terms)), None);
    }

    #[test]
    fn test_transcription_result_serialization() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: Some(0.01),
            peak_energy_level: 0.5,
            rms_energy_level: 0.1,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\":0.01"));
        assert!(json.contains("\"peakEnergyLevel\""));
        assert!(json.contains("\"rmsEnergyLevel\""));
    }

    #[test]
    fn test_transcription_result_serializes_none_no_speech_probability_as_null() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: None,
            peak_energy_level: 0.5,
            rms_energy_level: 0.1,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"noSpeechProbability\":null"));
    }

    #[test]
    fn test_parse_stt_provider() {
        assert_eq!(parse_stt_provider(Some("groq")), SttProvider::Groq);
        assert_eq!(parse_stt_provider(Some("apple")), SttProvider::Apple);
        assert_eq!(
            parse_stt_provider(Some("byteplus")),
            SttProvider::BytePlus
        );
        assert_eq!(parse_stt_provider(Some("other")), SttProvider::Groq);
        assert_eq!(parse_stt_provider(None), SttProvider::Groq);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn test_apple_provider_unsupported_before_api_key_check() {
        let result = check_provider_prerequisites(SttProvider::Apple, "");
        assert!(matches!(
            result,
            Err(TranscriptionError::ProviderUnsupported)
        ));
    }

    #[test]
    fn test_empty_api_key_still_rejected_for_http_providers() {
        assert!(matches!(
            check_provider_prerequisites(SttProvider::Groq, "  "),
            Err(TranscriptionError::ApiKeyMissing)
        ));
        assert!(matches!(
            check_provider_prerequisites(SttProvider::BytePlus, ""),
            Err(TranscriptionError::ApiKeyMissing)
        ));
    }

    #[test]
    fn test_base64_encode_known_values() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0, 1, 2, 3]), "AAECAw==");
    }

    #[test]
    fn test_uuid_v4_format_and_version_variant() {
        let uuid = uuid_v4();
        assert_eq!(uuid.len(), 36);
        let segments: Vec<&str> = uuid.split('-').collect();
        assert_eq!(segments.len(), 5);
        assert_eq!(
            segments.iter().map(|segment| segment.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(uuid.chars().all(|ch| ch == '-' || ch.is_ascii_hexdigit()));
        assert_eq!(segments[2].chars().next(), Some('4'));
        assert!(matches!(
            segments[3].chars().next(),
            Some('8' | '9' | 'a' | 'b')
        ));
        assert_ne!(uuid_v4(), uuid_v4());
    }

    #[test]
    fn test_byteplus_language_config_table() {
        let zh_tw = byteplus_language_config(Some("zh-TW"), Some("en"));
        assert_eq!(zh_tw.audio_language, Some("zh-CN"));
        assert_eq!(zh_tw.zh_variant, Some("tw"));
        assert!(zh_tw.include_hotwords);

        let zh_cn = byteplus_language_config(Some("zh-CN"), Some("zh-TW"));
        assert_eq!(zh_cn.audio_language, Some("zh-CN"));
        assert_eq!(zh_cn.zh_variant, None);
        assert!(zh_cn.include_hotwords);

        let en = byteplus_language_config(Some("en"), Some("zh-TW"));
        assert_eq!(en.audio_language, Some("en-US"));
        assert_eq!(en.zh_variant, None);
        assert!(!en.include_hotwords);

        let auto_tw = byteplus_language_config(Some("auto"), Some("zh-TW"));
        assert_eq!(auto_tw.audio_language, None);
        assert_eq!(auto_tw.zh_variant, Some("tw"));
        assert!(auto_tw.include_hotwords);

        let auto_en = byteplus_language_config(None, Some("en"));
        assert_eq!(auto_en.audio_language, None);
        assert_eq!(auto_en.zh_variant, None);
        assert!(auto_en.include_hotwords);

        for (locale, expected) in [
            ("ja", "ja-JP"),
            ("ko", "ko-KR"),
            ("vi", "vi-VN"),
            ("th", "th-TH"),
        ] {
            assert_eq!(
                byteplus_language_config(Some(locale), Some("zh-TW")).audio_language,
                Some(expected)
            );
        }
    }

    #[test]
    fn test_build_byteplus_request_zh_tw_with_hotwords() {
        let terms = vec!["TypeK".to_string(), "Tauri".to_string()];
        let wav = make_test_wav_with_format(&[0i16; 160], 16_000, 1, 16);
        let json = build_byteplus_request(&wav, Some(&terms), Some("zh-TW"), Some("zh-TW"))
            .expect("request builds");

        assert_eq!(json["user"]["uid"], "typek");
        assert_eq!(json["audio"]["format"], "wav");
        assert_eq!(json["audio"]["codec"], "raw");
        assert_eq!(json["audio"]["rate"], 16_000);
        assert_eq!(json["audio"]["bits"], 16);
        assert_eq!(json["audio"]["channel"], 1);
        assert_eq!(json["audio"]["language"], "zh-CN");
        assert!(json["audio"]["data"].as_str().unwrap().starts_with("UklGR"));
        assert_eq!(json["request"]["model_name"], "bigmodel");
        assert_eq!(json["request"]["output_zh_variant"], "tw");
        assert_eq!(
            json["request"]["corpus"]["context"],
            "{\"hotwords\":[{\"word\":\"TypeK\"},{\"word\":\"Tauri\"}]}"
        );
    }

    #[test]
    fn test_build_byteplus_request_en_uses_language_without_hotwords() {
        let terms = vec!["TypeK".to_string()];
        let wav = make_test_wav_with_format(&[0i16; 160], 16_000, 1, 16);
        let json = build_byteplus_request(&wav, Some(&terms), Some("en"), Some("zh-TW"))
            .expect("request builds");

        assert_eq!(json["audio"]["language"], "en-US");
        assert!(json["request"].get("output_zh_variant").is_none());
        assert!(json["request"].get("corpus").is_none());
    }

    #[test]
    fn test_build_byteplus_request_auto_interface_variant() {
        let wav = make_test_wav_with_format(&[0i16; 160], 16_000, 1, 16);
        let json = build_byteplus_request(&wav, None, Some("auto"), Some("zh-TW"))
            .expect("request builds");
        assert!(json["audio"].get("language").is_none());
        assert_eq!(json["request"]["output_zh_variant"], "tw");
        assert!(json["request"].get("corpus").is_none());
    }

    #[test]
    fn test_build_byteplus_request_rejects_unsupported_wav() {
        let err = build_byteplus_request(&[1u8, 2, 3], None, Some("auto"), Some("zh-TW"))
            .expect_err("must fail");
        assert!(err.to_string().contains("Unsupported WAV format"));

        let eight_bit = make_test_wav_with_format(&[0i16; 160], 16_000, 1, 8);
        assert!(build_byteplus_request(&eight_bit, None, Some("auto"), Some("zh-TW")).is_err());
    }

    #[test]
    fn test_parse_wav_format_reads_rate_channels_bits() {
        let wav = make_test_wav_with_format(&[0i16; 320], 48_000, 2, 16);
        let format = parse_wav_format(&wav).expect("fmt parsed");
        assert_eq!(format.sample_rate, 48_000);
        assert_eq!(format.channels, 2);
        assert_eq!(format.bits_per_sample, 16);
        assert_eq!(wav_audio_duration_ms(&wav, &format), 3);
    }

    #[test]
    fn test_parse_wav_format_16000() {
        let wav = make_test_wav_with_format(&[0i16; 16_000], 16_000, 1, 16);
        let format = parse_wav_format(&wav).expect("fmt parsed");
        assert_eq!(format.sample_rate, 16_000);
        assert_eq!(wav_audio_duration_ms(&wav, &format), 1000);
    }

    #[test]
    fn test_parse_byteplus_response_success_object() {
        let (text, nsp) = parse_byteplus_response(
            200,
            Some("20000000"),
            None,
            "{\"result\":{\"text\":\" 你好 \"}}",
        )
        .expect("success");
        assert_eq!(text, "你好");
        assert_eq!(nsp, None);
    }

    #[test]
    fn test_parse_byteplus_response_success_array() {
        let (text, nsp) = parse_byteplus_response(
            200,
            Some("20000000"),
            None,
            "{\"result\":[{\"text\":\"第一段\"},{\"text\":\"第二段\"}]}",
        )
        .expect("success");
        assert_eq!(text, "第一段");
        assert_eq!(nsp, None);
    }

    #[test]
    fn test_parse_byteplus_response_silence() {
        let (text, nsp) =
            parse_byteplus_response(200, Some("20000003"), None, "{}").expect("silence");
        assert_eq!(text, "");
        assert_eq!(nsp, Some(1.0));
    }

    #[test]
    fn test_parse_byteplus_response_auth_failure_no_retry() {
        let failure =
            parse_byteplus_response(401, None, None, "{}").expect_err("auth failure");
        assert!(matches!(
            failure.error,
            TranscriptionError::ProviderAuth(ref provider) if provider == "BytePlus"
        ));
        assert!(matches!(failure.kind, FailureKind::NoRetry));

        let failure =
            parse_byteplus_response(200, Some("45000010"), None, "{}").expect_err("auth failure");
        assert!(matches!(failure.error, TranscriptionError::ProviderAuth(_)));
    }

    #[test]
    fn test_parse_byteplus_response_550_is_retryable_server_error() {
        let failure = parse_byteplus_response(200, Some("55000031"), None, "{}")
            .expect_err("server error");
        assert!(matches!(failure.kind, FailureKind::ServerError));
        assert!(matches!(
            failure.error,
            TranscriptionError::ProviderError { .. }
        ));
    }

    #[test]
    fn test_parse_byteplus_response_45000001_not_retryable() {
        let failure =
            parse_byteplus_response(200, Some("45000001"), None, "bad request")
                .expect_err("provider error");
        assert!(matches!(failure.kind, FailureKind::NoRetry));
        assert!(matches!(
            failure.error,
            TranscriptionError::ProviderError {
                ref provider,
                ref code,
                ..
            } if provider == "BytePlus" && code == "45000001"
        ));
    }

    #[test]
    fn test_parse_byteplus_response_http_429_is_retryable() {
        let failure =
            parse_byteplus_response(429, None, None, "too many").expect_err("rate limited");
        assert!(matches!(failure.kind, FailureKind::RateLimited { .. }));
    }

    #[test]
    fn test_parse_byteplus_response_truncates_body_to_300_chars() {
        let body = "錯".repeat(400);
        let failure =
            parse_byteplus_response(200, Some("45000001"), None, &body).expect_err("error");
        match failure.error {
            TranscriptionError::ProviderError { message, .. } => {
                assert_eq!(message.chars().count(), 300);
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    /// Build a minimal PCM WAV around the given samples.
    fn make_test_wav(samples: &[i16]) -> Vec<u8> {
        make_test_wav_with_format(samples, 16_000, 1, 16)
    }

    /// Build a minimal PCM WAV with the given format fields.
    fn make_test_wav_with_format(
        samples: &[i16],
        sample_rate: u32,
        channels: u16,
        bits_per_sample: u16,
    ) -> Vec<u8> {
        let bytes_per_sample = bits_per_sample as usize / 8;
        let block_align = channels as u16 * bytes_per_sample as u16;
        let data_len = samples.len() * bytes_per_sample;
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&0u32.to_le_bytes()); // chunk size (ignored by parser)
        v.extend_from_slice(b"WAVE");
        v.extend_from_slice(b"fmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes()); // PCM
        v.extend_from_slice(&channels.to_le_bytes());
        v.extend_from_slice(&sample_rate.to_le_bytes());
        v.extend_from_slice(&(sample_rate * block_align as u32).to_le_bytes()); // byte rate
        v.extend_from_slice(&block_align.to_le_bytes());
        v.extend_from_slice(&bits_per_sample.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&(data_len as u32).to_le_bytes());
        for &s in samples {
            v.extend_from_slice(&s.to_le_bytes());
        }
        v
    }

    #[test]
    fn test_compute_wav_energy() {
        // Silence → (0, 0)
        let (peak, rms) = compute_wav_energy(&make_test_wav(&[0i16; 8]));
        assert!(peak < 1e-6, "peak={peak}");
        assert!(rms < 1e-6, "rms={rms}");

        // Full-scale square wave → peak ≈ 1.0, rms ≈ 1.0
        let (peak, rms) = compute_wav_energy(&make_test_wav(&[
            i16::MAX,
            -i16::MAX,
            i16::MAX,
            -i16::MAX,
        ]));
        assert!((peak - 1.0).abs() < 1e-3, "peak={peak}");
        assert!(rms > 0.9, "rms={rms}");

        // Empty data chunk → (0, 0), no panic
        let (peak, rms) = compute_wav_energy(&make_test_wav(&[]));
        assert_eq!(peak, 0.0);
        assert_eq!(rms, 0.0);

        // Non-WAV / too short → (0, 0), no panic
        let (peak, rms) = compute_wav_energy(&[1u8, 2, 3]);
        assert_eq!(peak, 0.0);
        assert_eq!(rms, 0.0);
    }

    // ========== Retry classification (gh-10) ==========

    #[test]
    fn test_parse_retry_after_secs() {
        assert_eq!(parse_retry_after_secs(Some("3")), Some(3));
        assert_eq!(parse_retry_after_secs(Some(" 5 ")), Some(5));
        assert_eq!(parse_retry_after_secs(Some("0")), Some(0));
        // HTTP-date 格式不支援 → 退回固定 backoff
        assert_eq!(
            parse_retry_after_secs(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
        assert_eq!(parse_retry_after_secs(None), None);
    }

    #[test]
    fn test_retry_wait_rate_limited_honors_retry_after() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: Some(3),
        };
        assert_eq!(retry_wait_secs(&kind, 1), Some(3));
    }

    #[test]
    fn test_retry_wait_rate_limited_over_cap_gives_up() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: Some(MAX_RETRY_AFTER_WAIT_SECS + 1),
        };
        assert_eq!(retry_wait_secs(&kind, 1), None);
    }

    #[test]
    fn test_retry_wait_rate_limited_without_hint_uses_backoff() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: None,
        };
        assert_eq!(retry_wait_secs(&kind, 1), Some(RETRY_BACKOFF_SECS[0]));
        assert_eq!(retry_wait_secs(&kind, 2), Some(RETRY_BACKOFF_SECS[1]));
    }

    #[test]
    fn test_retry_wait_server_error_and_connect_use_backoff() {
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 1),
            Some(RETRY_BACKOFF_SECS[0])
        );
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 2),
            Some(RETRY_BACKOFF_SECS[1])
        );
        assert_eq!(
            retry_wait_secs(&FailureKind::Connect, 1),
            Some(RETRY_BACKOFF_SECS[0])
        );
    }

    #[test]
    fn test_retry_wait_no_retry_kind_gives_up() {
        assert_eq!(retry_wait_secs(&FailureKind::NoRetry, 1), None);
    }

    #[test]
    fn test_retry_wait_attempt_beyond_backoff_table_clamps() {
        // 防未來調大 MAX_TRANSCRIPTION_ATTEMPTS 時越界
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 99),
            Some(RETRY_BACKOFF_SECS[RETRY_BACKOFF_SECS.len() - 1])
        );
    }
}
