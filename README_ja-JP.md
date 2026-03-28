# TypeK - 音声入力ツール

[他の言語で読む: [繁體中文](README.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [简体中文](README_zh-CN.md) | [한국어](README_ko-KR.md) | [Français](README_fr-FR.md) | [Español](README_es-ES.md) | [Русский](README_ru-RU.md) | [ไทย](README_th-TH.md) | [Tiếng Việt](README_vi-VN.md) | [العربية](README_ar-SA.md)]

> 長押しして話し、離すとまったく異なる出力品質を体験 — 音声をテキストに変換するデスクトップツール。

TypeK はクロスプラットフォームのデスクトップ音声入力ツールです。任意のアプリケーションのショートカットキーを押し続けて話し、離すと Groq Whisper API を介して文字起こしを行い、Groq LLM によって話し言葉が自動的に流暢な書き言葉に変換され、カーソル位置に直接貼り付けられます。

## 特徴

- **話し言葉から書き言葉へ** — AIが自動的にフィラー表現を取り除き、文の構造を再編成し、句読点を修正し、表現を洗練させます。
- **グローバルショートカット** — どのアプリケーションからでもトリガー可能。ホールドとトグルの両方のモードをサポート。
- **低遅延** — Groq推論エンジンを搭載しており、AI変換を含めて3秒以内に完了します。
- **カスタム辞書** — 固有名詞や技術用語の文字起こしを正確に行うことができます。
- **履歴と統計** — すべての文字起こしを自動保存し、ダッシュボードで一目で利用状況を確認。
- **ミニマルな設定** — APIキーを設定するだけで始められます。

## インストール

### ダウンロード

| プラットフォーム | ダウンロードリンク |
|------|---------|
| macOS (Apple Silicon) | [TypeK_0.9.1_aarch64.dmg](https://github.com/kekukeku/TypeK/releases/download/v0.9.1/TypeK_0.9.1_aarch64.dmg) |
| Windows (x64) | [TypeK_0.9.1_x64.exe](https://github.com/kekukeku/TypeK/releases/download/v0.9.1/TypeK_0.9.1_x64.exe) |

> **⚠️ macOS インストールに関する注意（アプリが破損しているエラー）：**
> Macでアプリを開く際に「破損している」というエラーが表示される場合は、[Unlock_TypeK.command](https://raw.githubusercontent.com/kekukeku/TypeK/main/%E8%A7%A3%E9%8E%96TypeK.command) スクリプトをダウンロードして実行し、隔離制限を自動的に解除するか、ターミナルを開いて次を実行してください：`sudo xattr -cr /Applications/TypeK.app`。

### 要件

- [Groq API Key](https://console.groq.com/keys)（無料で登録・申請可能）

### クイックスタート

1. ダウンロードしてインストール。
2. TypeKを開く → 設定ページ → Groq API Keyを貼り付け。
3. 任意のアプリでショートカットキーを長押しして話し、離すとテキストが自動的に貼り付けられます。

## 技術アーキテクチャ

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │ グローバルホットキー・クリップボード   │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ 状態UI    │    │ 設定 / 履歴 / 統計 │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (音声認識) + Groq LLM (文章推敲)
- **Storage** — SQLite (履歴) + tauri-plugin-store (設定)

## 開発

### 環境要件

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### コマンド

```bash
# 依存関係のインストール
pnpm install

# 開発モード
pnpm tauri dev

# ビルド
pnpm tauri build

# テスト
pnpm test

# 型チェック
npx vue-tsc --noEmit
```

### リリース

```bash
./scripts/release.sh 0.2.0
# → 自動更新（バージョン、コミット、タグ、push）
# → GitHub ActionsでmacOS/Windowsインストーラーをビルド
# → GitHub Releasesで手動Publish
```

## 謝辞

原作者：[Jackle Chen](https://jackle.pro)
前バージョンの最適化担当：[好倫](https://bt34.cc)
最適化担当：[Kevin Kuo](https://github.com/kevin880118)

TypeK は [BTalk](https://github.com/biantai34/BTalk/) をベースにした変更バージョンであり、すべての主要機能を維持し、特定の言語ロケールの要件に合わせて適応されています。

## ライセンス

[MIT](LICENSE)
