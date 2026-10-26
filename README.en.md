# TypeK

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | **English** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Tiếng Việt](README.vi.md) | [ไทย](README.th.md)

> Hold to talk, release to paste — a desktop tool that turns speech into written text

TypeK is a desktop voice input tool. Hold a hotkey in any app and speak; when you let go, Groq Whisper transcribes your voice, and AI tidies it into clean written text — taking into account the app you're typing in and the text around your cursor — then pastes it right at the cursor.

TypeK is a fork of the open-source project [SayIt](https://github.com/chenjackle45/SayIt), modified and distributed under the [MIT License](LICENSE).

## Features

- **Speech to written text** — AI removes filler words and fixes homophones and punctuation, so the text is ready to use
- **Context-aware** (macOS) — Tidying takes the current app, window title and the text around your cursor into account, so names and terms come out right more often; password fields are never read, and you can turn this off in Settings
- **Global hotkey** — Works in any app, in Hold or Toggle mode
- **Custom dictionary** — Keeps names and technical terms transcribed correctly, and learns new words from your edits
- **History and stats** — Every transcription is saved automatically; the Dashboard shows your usage at a glance

## Installation

### Download

| Platform | Download |
|------|---------|
| macOS (Apple Silicon: M1/M2/M3/M4…) | [TypeK-mac-arm64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-arm64.dmg) |
| macOS (Intel) | [TypeK-mac-x64.dmg](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-mac-x64.dmg) |
| Windows | [TypeK-windows-x64.exe](https://github.com/kekukeku/TypeK/releases/latest/download/TypeK-windows-x64.exe) |

Not sure which Mac you have? Click  in the top-left → "About This Mac". If "Chip" starts with Apple M, pick Apple Silicon; if it says Intel, pick Intel.

### Installing on macOS

TypeK is currently **not signed or notarized by Apple**, so macOS blocks it the first time you open it. This is expected:

1. Open the downloaded `.dmg` and drag **TypeK** into the Applications folder
2. Double-click TypeK in Applications. macOS says the developer can't be verified, or that Apple could not verify TypeK is free of malware. Click "Done" or "Cancel"
3. Open "System Settings → Privacy & Security" and scroll down to "Security". Next to "TypeK was blocked", click "**Open Anyway**" and enter your password
4. From now on it opens normally without asking

If you see "TypeK is damaged and can't be opened", run this line in Terminal and open it again:

```bash
xattr -dr com.apple.quarantine /Applications/TypeK.app
```

### macOS permissions

The first time you use TypeK it asks for two permissions. Allow both:

- **Microphone**: to record what you say
- **Accessibility** (System Settings → Privacy & Security → Accessibility): to detect the hotkey, paste text at the cursor, and read the text around the cursor

Because the app is unsigned, **the Accessibility permission may stop working after you update**. If the hotkey does nothing, remove TypeK from the Accessibility list (−), then add it back (+) and switch it on.

### Updating

From 1.3.0 you can update inside the app: use "Check for Updates" in the sidebar, or wait for the automatic notification. If you're on 1.2.2 or earlier, download the new version and install it over the old one once (you don't need to delete the app first).

On macOS, TypeK must be in the Applications folder to update automatically. If the hotkey stops working after an update, go to System Settings → Privacy & Security → Accessibility, remove TypeK, then add it again and switch it on.

### Installing on Windows

If running the `.exe` shows "Windows protected your PC", click "More info" → "Run anyway".

### Requirements

- [Groq API Key](https://console.groq.com/keys) — speech transcription (free tier)
- [Gemini API Key](https://aistudio.google.com/apikey) — text tidying uses Gemini 3.1 Flash-Lite by default (free tier); you can switch to Groq, OpenAI or Anthropic in Settings

### Quick start

1. Download and install using the steps above
2. Open TypeK → Settings → paste your Groq API Key and Gemini API Key
3. In any app, hold `Fn` and speak; release, and the text is pasted automatically

## Architecture

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ Global hotkey · Clipboard · Context │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Status   │    │ Settings/History │
  │ overlay  │    │ /Stats           │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (speech to text) + Gemini/Groq/OpenAI/Anthropic (text tidying)
- **Storage** — SQLite (history) + tauri-plugin-store (settings)

## Development

### Requirements

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Commands

```bash
# Install dependencies
pnpm install

# Dev mode
pnpm tauri dev

# Build
pnpm tauri build

# Test
pnpm test

# Type check
npx vue-tsc --noEmit
```

### Releasing

Auto-update is enabled from 1.3.0: the app checks GitHub Releases for updates. See [docs/deployment-guide.md](docs/deployment-guide.md) for the signing key and release steps.

```bash
./scripts/release.sh X.Y.Z
# → bumps the version, commits, tags and pushes
# → GitHub Actions builds the macOS + Windows installers
# → the GitHub Release is published automatically once the builds succeed
```

## License

[MIT](LICENSE). TypeK is derived from SayIt and keeps the original author's copyright notice as the MIT License requires.
