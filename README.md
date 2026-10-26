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

| 平臺 | 下載連結 |
|------|---------|
| macOS（Apple Silicon：M1／M2／M3／M4…） | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

macOS 版只支援 Apple Silicon（M1／M2／M3／M4…）；Intel Mac 從 1.3.3 起不再提供。

### macOS 安裝步驟

TypeK 用自簽憑證「TypeK Code Signing」簽章，但**沒有 Apple Developer ID、也沒有經過公證**，所以第一次打開會被 macOS 擋下，這是正常的，只需要處理一次：

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

1.3.3 起每一版都用同一張憑證簽章，**App 內更新後會保留這兩項權限，不用重新授權**。從 1.3.1 以前的版本更新上來時，需要最後一次到「輔助使用」清單把 TypeK 移除（−），再重新加入（＋）並打開。

如果快捷鍵還是沒反應（系統設定顯示開著、實際卻沒作用），先結束 TypeK，在「終端機」執行下面這行：它會清掉 TypeK 舊的輔助使用授權並打開設定頁，再把 TypeK 加回清單打開、重新啟動 App 即可。這行只重設 TypeK，不會動到其他 App。

```bash
tccutil reset Accessibility com.kekukeku.typek && open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

### 更新

1.3.0 起可以直接在 App 內更新：側邊欄的「檢查更新」，或等 App 自動通知。1.2.2 以前的使用者請下載新版覆蓋安裝一次（不用先刪除 App）。

macOS：TypeK 要放在「應用程式」資料夾才能自動更新。更新後權限會保留；若快捷鍵沒反應，見上方「macOS 權限」的故障排除。

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

自動更新已啟用（1.3.0 起）：App 會從 GitHub Releases 檢查更新；金鑰與發版步驟見 [docs/deployment-guide.md](docs/deployment-guide.md)。

```bash
./scripts/release.sh X.Y.Z
# → 自動更新版本號、commit、tag、push
# → GitHub Actions 建構 macOS + Windows 安裝檔
# → 打包成功後自動公開 GitHub Release
```

## License

[MIT](LICENSE)。TypeK 改作自 SayIt，依 MIT 授權保留原作者的版權聲明。
