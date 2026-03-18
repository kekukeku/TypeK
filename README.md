# BTalk - 變態輸入法

> 按住就說話，放開感受變態般的輸出速度 — 語音轉書面語桌面工具（科科）

BTalk 是一款跨平台桌面語音輸入工具的魔改版本呵呵。在任何應用程式中按住快捷鍵說話，放開後語音經 Groq Whisper API 轉錄，再由 Groq LLM 自動將口語轉為通順的繁體中文書面語，直接貼入游標位置 — 就像有個隱形的秘書替你把廢話改成文言文一樣 😏

## 特色

- **口語到書面語** — AI 自動去除贅詞、重組句構、修正標點，說完即可用。放心，再亂講的話 AI 都能幫你圓場（科科）
- **全域快捷鍵** — 在任何應用程式中觸發，支援 Hold / Toggle 雙模式。想在任何地方偷偷說話？沒問題呵呵
- **低延遲** — 基於 Groq 推論引擎，端到端 < 3 秒（含 AI 整理）。快到你根本來不及反悔
- **自訂詞彙字典** — 確保專有名詞、技術術語正確轉錄。讓 AI 認識你的黑話（開玩笑啦）
- **歷史記錄與統計** — 自動保存所有轉錄，Dashboard 一覽使用狀況。看看自己一天廢話幾百句 😅
- **極簡設定** — 只需設定 API Key 即可使用。簡單到不行，根本沒有託詞說不會用

## 安裝

### 下載

| 平台 | 下載連結 |
|------|---------|
| macOS (Apple Silicon) | [BTalk_0.8.7_aarch64.dmg](https://github.com/biantai34/BTalk/releases/download/v0.8.7/BTalk_0.8.7_aarch64.dmg) |

### 前置需求

- [Groq API Key](https://console.groq.com/keys)（免費申請，真的免費喔科科）

### 快速開始

1. 下載並安裝
2. 開啟 BTalk → 設定頁面 → 貼上 Groq API Key
3. 在任何應用程式中按住快捷鍵說話，放開後文字自動貼上（魔法就此發生）

## 技術架構

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  全域熱鍵 · 剪貼簿 · 音量控制    │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 狀態浮窗  │    │ 設定/歷史/統計   │
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
負優化者：[好倫](https://bt34.cc)

BTalk 是基於 [SayIt](https://github.com/chenjackle45/SayIt) 的魔改版本，保留了所有精華功能，加上了一點點變態的個性呵呵

## License

[MIT](LICENSE)
