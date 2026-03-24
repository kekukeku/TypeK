# TypeK - 語音輸入法

[閱讀其他語言版本: [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]
> 按住就說話，放開感受截然不同的輸出品質 — 語音轉書面語桌面工具

TypeK 是一款跨平台桌面語音輸入工具。在任何應用程式中按住快捷鍵說話，放開後語音經 Groq Whisper API 轉錄，再由 Groq LLM 自動將口語轉為通順的繁體中文書面語，直接貼入游標位置 — 就像有個隱形的文字秘書幫用戶把口語改成書面語一樣。

## 特色

- **口語到書面語** — AI 自動去除贅詞冗字、重組句構、修正標點、美化修辭，說完即可用。
- **全域快捷鍵** — 在任何應用程式中觸發，支援 Hold / Toggle 雙模式。
- **低延遲** — 基於 Groq 推論引擎，端到端 3 秒內（含 AI 整理）。
- **自訂詞彙字典** — 確保專有名詞、技術術語正確轉錄。
- **歷史記錄與統計** — 自動保存所有轉錄，Dashboard 一覽使用狀況。
- **極簡設定** — 只需設定 API Key 即可使用。

## 安裝

### 下載

| 平臺 | 下載連結 |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.0_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_x64.exe) |

### 前置需求

- [Groq API Key](https://console.groq.com/keys)（自行註冊免費申請）

### 快速開始

1. 下載並安裝
2. 開啟 TypeK → 設定頁面 → 貼上 Groq API Key
3. 在任何應用程式中按住快捷鍵說話，放開後文字自動貼上。

## 技術架構

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  全域熱鍵 · 剪貼簿 · 音量控制        │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 狀態浮窗  │    │ 設定/歷史/統計     │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (語音轉文字) + Groq LLM (文字整理)
- **Storage** — SQLite (歷史記錄) + tauri-plugin-store (設定)

## 開發

### 環境需求

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### 指令

```bash
# 安裝依賴
pnpm install

# 開發模式
pnpm tauri dev

# 建構
pnpm tauri build

# 測試
pnpm test

# 型別檢查
npx vue-tsc --noEmit
```

### 發版

```bash
./scripts/release.sh 0.2.0
# → 自動更新版本號、commit、tag、push
# → GitHub Actions 建構 macOS + Windows 安裝檔
# → 到 GitHub Releases 手動 Publish
```

## 致謝

原作者：[Jackle Chen](https://jackle.pro)
前版本優化者：[好倫](https://bt34.cc)
優化者：[Kevin Kuo](https://github.com/kevin880118)

TypeK 是基於 [BTalk](https://github.com/biantai34/BTalk/) 的修改版本，保留了所有精華功能，並適應不同語系的特別需求。

## License

[MIT](LICENSE)
