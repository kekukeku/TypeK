# TypeK

> 按住說話，放開貼上 — 語音轉書面語桌面工具

TypeK 是一款桌面語音輸入工具。在任何應用程式中按住快捷鍵說話，放開後語音經 Groq Whisper 轉錄，再由 AI 依你正在輸入的 App 與游標前後文字，整理成通順的書面語，直接貼入游標位置。

TypeK 是開源專案 [SayIt](https://github.com/chenjackle45/SayIt) 的 fork，依 [MIT 授權](LICENSE)改作與散布。

## 特色

- **口語到書面語** — AI 自動去除贅詞、修正同音字與標點，說完即可用
- **上下文感知**（macOS）— 整理時參考目前的 App、視窗標題與游標前後文字，專有名詞更容易修對；密碼欄不讀取，可在設定中關閉
- **全域快捷鍵** — 在任何應用程式中觸發，支援 Hold / Toggle 雙模式
- **自訂詞彙字典** — 確保專有名詞、技術術語正確轉錄，並從你的修改中學習新詞
- **歷史記錄與統計** — 自動保存所有轉錄，Dashboard 一覽使用狀況

## 安裝

TypeK 尚未發布正式安裝檔，目前請依下方「開發」一節自行建置。

### 前置需求

- [Groq API Key](https://console.groq.com/keys) — 語音轉錄（免費額度）
- [Gemini API Key](https://aistudio.google.com/apikey) — 文字整理預設使用 Gemini 3.1 Flash-Lite（免費額度）；也可在設定中改用 Groq、OpenAI 或 Anthropic

### 快速開始

1. 建置並安裝
2. 開啟 TypeK → 設定頁面 → 貼上 Groq API Key 與 Gemini API Key
3. 在任何應用程式中按住 `Fn` 鍵說話，放開後文字自動貼上

## 技術架構

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  全域熱鍵 · 剪貼簿 · 輸入上下文  │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 狀態浮窗  │    │ 設定/歷史/統計   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper（語音轉文字）+ Gemini／Groq／OpenAI／Anthropic（文字整理）
- **Storage** — SQLite（歷史記錄）+ tauri-plugin-store（設定）

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

自動更新目前關閉：TypeK 還沒有自己的 updater 簽章金鑰，啟用步驟見 [docs/deployment-guide.md](docs/deployment-guide.md)。

```bash
./scripts/release.sh X.Y.Z
# → 自動更新版本號、commit、tag、push
# → GitHub Actions 建構 macOS + Windows 安裝檔
# → 到 GitHub Releases 手動 Publish
```

## License

[MIT](LICENSE)。TypeK 改作自 SayIt，依 MIT 授權保留原作者的版權聲明。
