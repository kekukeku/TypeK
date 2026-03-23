# TypeK - Voice Input Tool

[Read in other languages: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> Hold to speak, release to experience completely different output quality — a voice-to-text desktop tool.

TypeK is a cross-platform desktop voice input tool. Hold the shortcut key to speak in any application, release to transcribe via Groq Whisper API, and then Groq LLM automatically transforms your spoken language into fluent, written text and pastes it directly at your cursor—like having an invisible editing assistant fixing your speech into formal writing.

## Features

- **Spoken to Written** — AI automatically removes filler words, reorganizes sentence structure, fixes punctuation, and refines wording. Ready to use immediately.
- **Global Shortcut Keys** — Trigger in any application, supporting both Hold / Toggle modes.
- **Low Latency** — Powered by the Groq inference engine, end-to-end within 3 seconds (including AI processing).
- **Custom Vocabulary** — Ensures accurate transcription of proper nouns and technical terms.
- **History & Statistics** — Automatically saves all transcriptions, with a Dashboard to view usage at a glance.
- **Minimal Setup** — Just configure an API Key to get started.

## Installation

### Download

| Platform | Download Link |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.0_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.0/TypeK_0.9.0_aarch64.dmg) |

### Requirements

- [Groq API Key](https://console.groq.com/keys) (Register and apply for free)

### Quick Start

1. Download and install.
2. Open TypeK → Settings Page → Paste your Groq API Key.
3. Hold the shortcut key in any application to speak, and release to have the text automatically pasted.

## Technical Architecture

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ Global Hotkeys · Clipboard · Vol │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Status   │    │ Settings/History │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (Speech-to-Text) + Groq LLM (Text Refinement)
- **Storage** — SQLite (History) + tauri-plugin-store (Settings)

## Development

### Environment Requirements

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Commands

```bash
# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Build
pnpm tauri build

# Test
pnpm test

# Type checking
npx vue-tsc --noEmit
```

### Release

```bash
./scripts/release.sh 0.2.0
# → Automatically updates version, commit, tag, push
# → GitHub Actions builds macOS + Windows installers
# → Go to GitHub Releases to manually Publish
```

## Acknowledgments

Original Author: [Jackle Chen](https://jackle.pro)
Previous Version Optimizer: [好倫](https://bt34.cc)
Optimizer: [Kevin Kuo](https://github.com/kevin880118)

TypeK is a modified version based on [BTalk](https://github.com/biantai34/BTalk/), preserving all core features and adapted for specific language locale requirements.

## License

[MIT](LICENSE)
