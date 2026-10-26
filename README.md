# TypeK

**繁體中文** | [简体中文](README.zh-CN.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md) | [ไทย](README.th.md)

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

### 下載

| 平台 | 下載連結 |
|------|---------|
| macOS（Apple Silicon：M1／M2／M3／M4…） | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| macOS（Intel） | [TypeK-mac-x64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-x64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

不確定是哪一種 Mac：點左上角  →「關於這台 Mac」，「晶片」寫 Apple M 開頭就選 Apple Silicon，寫 Intel 就選 Intel。

### macOS 安裝步驟

TypeK 目前**沒有經過 Apple 簽章與公證**，第一次打開會被 macOS 擋下，這是正常的：

1. 打開下載的 `.dmg`，把 **TypeK** 拖進「應用程式」資料夾
2. 到「應用程式」資料夾雙擊 TypeK，macOS 會顯示「無法驗證開發者」或「Apple 無法確認 TypeK 不含惡意軟體」，按「完成」或「取消」
3. 打開「系統設定 → 隱私權與安全性」，往下捲到「安全性」，看到「已阻擋 TypeK」，按「**強制打開**」，再輸入密碼確認
4. 之後就能正常打開，不會再問

如果出現「TypeK 已損毀，無法打開」，在「終端機」執行下面這行再打開一次：

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### macOS 權限

TypeK 第一次使用時會請求兩項權限，都要允許：

- **麥克風**：錄下你說的話
- **輔助使用**（系統設定 → 隱私權與安全性 → 輔助使用）：偵測快捷鍵、把文字貼到游標位置、讀取輸入框前後文字

因為沒有簽章，**更新到新版本後，輔助使用權限可能會失效**。如果快捷鍵沒反應，到「輔助使用」清單把 TypeK 移除（−），再重新加入（＋）並打開。

### Windows 安裝步驟

執行 `.exe` 時若出現「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。

### 前置需求

- [Groq API Key](https://console.groq.com/keys) — 語音轉錄（免費額度）
- [Gemini API Key](https://aistudio.google.com/apikey) — 文字整理預設使用 Gemini 3.1 Flash-Lite（免費額度）；也可在設定中改用 Groq、OpenAI 或 Anthropic

### 快速開始

1. 依上方步驟下載並安裝
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
# → 打包成功後自動公開 GitHub Release
```

## License

[MIT](LICENSE)。TypeK 改作自 SayIt，依 MIT 授權保留原作者的版權聲明。
