# TypeK - 语音输入法

[阅读其他语言: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> 按住就说话，松开感受截然不同的输出质量 — 语音转书面语桌面工具

TypeK 是一款跨平台桌面语音输入工具。在任何应用程序中按住快捷键说话，松开后语音经 Groq Whisper API 转录，再由 Groq LLM 自动将口语转为通顺的书面语，直接贴入光标位置 — 就像有个隐形的文字秘书帮用户把口语改成书面语一样。

## 特色

- **口语到书面语** — AI 自动去除赘词冗字、重组句构、修正标点、美化修辞，说完即可用。
- **全局快捷键** — 在任何应用程序中触发，支持 Hold / Toggle 双模式。
- **低延迟** — 基于 Groq 推理引擎，端到端 3 秒内（含 AI 整理）。
- **自定义词汇字典** — 确保专有名词、技术术语正确转录。
- **历史记录与统计** — 自动保存所有转录，Dashboard 一览使用状况。
- **极简设置** — 只需设置 API Key 即可使用。

## 安装

### 下载

| 平台 | 下载链接 |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.0_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_x64.exe) |

### 前置条件

- [Groq API Key](https://console.groq.com/keys)（自行注册免费申请）

### 快速开始

1. 下载并安装
2. 打开 TypeK → 设置页面 → 粘贴 Groq API Key
3. 在任何应用程序中按住快捷键说话，松开后文字自动粘贴。

## 技术架构

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │    全局热键 · 剪贴板 · 音量控制    │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 状态浮窗  │    │ 设置/历史/统计   │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (语音转文字) + Groq LLM (文字整理)
- **Storage** — SQLite (历史记录) + tauri-plugin-store (设置)

## 开发

### 环境要求

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### 命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建
pnpm tauri build

# 测试
pnpm test

# 类型检查
npx vue-tsc --noEmit
```

### 发布

```bash
./scripts/release.sh 0.2.0
# → 自动更新版本号、commit、tag、push
# → GitHub Actions 构建 macOS + Windows 安装包
# → 到 GitHub Releases 手动 Publish
```

## 致谢

原作者：[Jackle Chen](https://jackle.pro)
前版本优化者：[好伦](https://bt34.cc)
优化者：[Kevin Kuo](https://github.com/kevin880118)

TypeK 是基于 [BTalk](https://github.com/biantai34/BTalk/) 的修改版本，保留了所有精华功能，并适应不同语系的特别需求。

## License

[MIT](LICENSE)
